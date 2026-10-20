import { test, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadTeam } from '../lib/team.mjs';
import { buildState, foldEvents } from '../lib/state.mjs';

const loaded = loadTeam(fileURLToPath(new URL('./fixtures/team-web.json', import.meta.url)));
const team = loaded.team;
const T0 = Date.parse('2026-10-05T12:00:00Z');
let tick = 0;
const ev = (type, fields = {}) => ({ type, source: 'cli', time: new Date(T0 + tick++ * 1000).toISOString(), ...fields });
const lastTime = () => T0 + (tick - 1) * 1000;
const now = new Date(T0 + 60_000);
const agent = (s, name) => s.agents.find((a) => a.name.toLowerCase() === name);
const build = (events, at = now) => buildState(events, team, at);

test('initial state lists members idle, then approver', () => {
  const s = build([]);
  expect(s.agents.map((a) => a.status)).toEqual(Array(6).fill('idle'));
  expect(s.agents.map((a) => a.name)).toEqual(['Planner', 'Backend', 'Frontend', 'Tester', 'Reviewer', 'Jimmy']);
  expect(s.agents.at(-1).isApprover).toBe(true);
  expect(s.agents[0]).toMatchObject({ currentTask: null, progress: 0, updatedAt: null, stale: false, isVisitor: false });
  expect(s.updatedAt).toBe(now.toISOString());
  expect(s.project).toBe('CookNeighbour');
});

test('start → status → stop keeps facts over story', () => {
  const s = build([ev('agent_start', { agent: 'backend', task: 'T-004' }), ev('status', { agent: 'backend', status: 'working', progress: 60 }), ev('agent_stop', { agent: 'backend' })]);
  expect(agent(s, 'backend')).toMatchObject({ status: 'done', stoppedAtProgress: 60, currentTask: 'T-004' });
  const s2 = build([ev('status', { agent: 'backend', status: 'working', progress: 100 }), ev('agent_stop', { agent: 'backend' })]);
  expect(agent(s2, 'backend').stoppedAtProgress).toBeNull();
  const s3 = build([ev('status', { agent: 'backend', status: 'working', progress: 30 }), ev('agent_stop', { agent: 'backend' }), ev('agent_start', { agent: 'backend' })]);
  expect(agent(s3, 'backend')).toMatchObject({ status: 'working', stoppedAtProgress: null });
});

test('status sets every field present and clears a stale blocked reason', () => {
  const s = build([ev('status', { agent: 'tester', status: 'blocked', reason: 'Checks failing', task: 'T-9', nextStep: 'Retry' }), ev('status', { agent: 'tester', status: 'working' })]);
  expect(agent(s, 'tester')).toMatchObject({ status: 'working', reason: null, currentTask: 'T-9', nextStep: 'Retry' });
});

test('tool_use sets lastAction and revives idle agent', () => {
  const s = build([ev('tool_use', { agent: 'backend', action: 'Editing pricing.ts', source: 'hook' })]);
  expect(agent(s, 'backend')).toMatchObject({ lastAction: 'Editing pricing.ts', status: 'working' });
  const s2 = build([ev('status', { agent: 'backend', status: 'blocked', reason: 'x' }), ev('tool_use', { agent: 'backend', action: 'Bash' })]);
  expect(agent(s2, 'backend').status).toBe('blocked');
});

test('closing the task moves a done owner to idle', () => {
  const base = [ev('task', { id: 'T-004', title: 'Pricing', owner: 'backend', state: 'in_progress' }), ev('agent_start', { agent: 'backend', task: 'T-004' }), ev('agent_stop', { agent: 'backend' })];
  expect(agent(build(base), 'backend').status).toBe('done');
  const closed = build([...base, ev('task', { id: 'T-004', title: 'Pricing', owner: 'backend', state: 'done' })]);
  expect(agent(closed, 'backend').status).toBe('idle');
  expect(closed.tasks).toEqual([{ id: 'T-004', title: 'Pricing', owner: 'backend', state: 'done', notes: '', progress: 100, stage: 'Done' }]);
});

test('stale after 5 minutes of silence while working', () => {
  const events = [ev('agent_start', { agent: 'backend' })];
  const last = lastTime();
  expect(agent(build(events, new Date(last + 6 * 60_000)), 'backend').stale).toBe(true);
  expect(agent(build(events, new Date(last + 4 * 60_000)), 'backend').stale).toBe(false);
  const stopped = [...events, ev('agent_stop', { agent: 'backend' })];
  expect(agent(build(stopped, new Date(lastTime() + 60 * 60_000)), 'backend').stale).toBe(false);
});

test('approver awaiting while an approval is pending, idle after decision', () => {
  const req = ev('approval_requested', { id: 'WO-1', summary: 'Build it', agents: ['backend'] });
  const s = build([req]);
  expect(agent(s, 'jimmy')).toMatchObject({ status: 'awaiting_approval', currentTask: '1 decision waiting' });
  const s2 = build([req, ev('approval_decided', { id: 'WO-1', state: 'approved', note: 'go' })]);
  expect(agent(s2, 'jimmy')).toMatchObject({ status: 'idle', currentTask: null });
  expect(s2.approvals[0]).toMatchObject({ id: 'WO-1', state: 'approved', note: 'go', requestedBy: 'planner' });
  expect(s2.approvals[0].decidedAt).not.toBeNull();
});

test('approver waits whenever anything needs him', () => {
  const blocked = ev('status', { agent: 'reviewer', status: 'blocked', reason: 'Checks failing' });
  const esc = ev('escalation', { task: 'T-1', summary: 'Failed twice' });
  const req = ev('approval_requested', { id: 'WO-1', summary: 'Plan' });
  expect(agent(build([blocked]), 'jimmy')).toMatchObject({ status: 'awaiting_approval', currentTask: '1 thing needs you' });
  expect(agent(build([esc]), 'jimmy')).toMatchObject({ status: 'awaiting_approval', currentTask: '1 thing needs you' });
  expect(agent(build([blocked, esc]), 'jimmy')).toMatchObject({ status: 'awaiting_approval', currentTask: '2 things need you' });
  expect(agent(build([req, blocked]), 'jimmy')).toMatchObject({ status: 'awaiting_approval', currentTask: '1 decision waiting' });
  expect(agent(build([]), 'jimmy')).toMatchObject({ status: 'idle', currentTask: null });
});

test('approval puts listed non-working agents in awaiting_approval', () => {
  const req = ev('approval_requested', { id: 'WO-1', summary: 'S', agents: ['Backend', 'frontend'] });
  const s = build([ev('agent_start', { agent: 'frontend' }), req]);
  expect(agent(s, 'backend').status).toBe('awaiting_approval');
  expect(agent(s, 'frontend').status).toBe('working');
  const d = build([ev('agent_start', { agent: 'frontend' }), req, ev('approval_decided', { id: 'WO-1', state: 'rejected' })]);
  expect(agent(d, 'backend').status).toBe('idle');
  expect(agent(d, 'frontend').status).toBe('working');
});

test('needsYou order: approvals, blocked, escalations', () => {
  const s = build([
    ev('escalation', { task: 'T-1', summary: 'Failed twice' }),
    ev('status', { agent: 'reviewer', status: 'blocked', reason: 'Checks failing' }),
    ev('approval_requested', { id: 'WO-1', summary: 'Plan' }),
  ]);
  expect(s.needsYou).toEqual([
    { kind: 'approval', id: 'WO-1', summary: 'Plan' },
    { kind: 'blocked', id: 'reviewer', summary: 'Checks failing' },
    { kind: 'escalation', id: 'T-1', summary: 'Failed twice' },
  ]);
});

test('escalation clears on next task event for that task', () => {
  const esc = ev('escalation', { task: 'T-1', summary: 'Failed twice' });
  expect(build([esc]).needsYou).toHaveLength(1);
  expect(build([esc, ev('task', { id: 'T-2', title: 'x', owner: 'backend', state: 'todo' })]).needsYou).toHaveLength(1);
  expect(build([esc, ev('task', { id: 'T-1', title: 'x', owner: 'backend', state: 'todo' })]).needsYou).toHaveLength(0);
});

test('unknown agent becomes a visitor', () => {
  const s = build([ev('agent_start', { agent: 'Explore' }), ev('agent_start', { agent: 'plan' })]);
  expect(s.agents.slice(-2)).toMatchObject([
    { name: 'explore', role: 'Visitor', color: '#d9d9e3', isVisitor: true, status: 'working' },
    { name: 'plan', isVisitor: true },
  ]);
  expect(s.agents).toHaveLength(8);
});

test('agent ids match case-insensitively', () => expect(agent(buildState([ev('agent_start', { agent: ' Backend ' })], team, now), 'backend').status).toBe('working'));

test('team activity only logs overall', () => {
  const s = build([ev('tool_use', { agent: 'team', action: 'Editing a.ts', source: 'hook' })]);
  expect(s.agents).toHaveLength(6);
  expect(s.log).toMatchObject([{ agent: 'team', event: 'Editing a.ts' }]);
  expect(s.agentLogs).toEqual({});
});

test('file order wins over timestamps', () => {
  const later = ev('status', { agent: 'backend', status: 'working' });
  const earlier = { ...ev('status', { agent: 'backend', status: 'blocked', reason: 'Oops' }), time: '2000-01-01T00:00:00.000Z' };
  expect(agent(build([later, earlier]), 'backend').status).toBe('blocked');
});

test('log lines are human readable', () => {
  const s = build([ev('agent_start', { agent: 'backend', task: 'T-004' }), ev('tool_use', { agent: 'backend', action: 'Editing pricing.ts' }),
    ev('status', { agent: 'reviewer', status: 'blocked', reason: 'Checks failing' }), ev('handoff', { from: 'backend', to: 'tester', task: 'T-004' })]);
  expect(s.log.map((l) => l.event)).toEqual(['Started T-004', 'Editing pricing.ts', 'Stuck: Checks failing', 'Handed T-004 to tester']);
  expect(s.agentLogs.backend.map((l) => l.event)).toEqual(['Started T-004', 'Editing pricing.ts', 'Handed T-004 to tester']);
  expect(s.handoffs).toMatchObject([{ from: 'backend', to: 'tester', task: 'T-004' }]);
  expect(agent(s, 'backend').updatedAt).toBe(new Date(T0 + (tick - 1) * 1000).toISOString());
});

test('agentLogs capped at 20, log at 100, handoffs at 20', () => {
  const events = [];
  for (let i = 0; i < 130; i++) events.push(ev('tool_use', { agent: 'backend', action: `Edit ${i}` }));
  for (let i = 0; i < 25; i++) events.push(ev('handoff', { from: 'planner', to: 'backend', task: `T-${i}` }));
  const s = build(events);
  expect(s.log).toHaveLength(100);
  expect(s.agentLogs.backend).toHaveLength(20);
  expect(s.agentLogs.backend.at(-1).event).toBe('Edit 129');
  expect(s.handoffs).toHaveLength(20);
  expect(s.handoffs.at(-1).task).toBe('T-24');
});

test('snapshot replaces prior state', () => {
  const prior = [ev('agent_start', { agent: 'tester' }), ev('task', { id: 'T-1', title: 't', owner: 'tester', state: 'todo' })];
  const snap = ev('snapshot', { state: foldEvents([ev('agent_start', { agent: 'backend', task: 'T-9' })], team) });
  const s = build([...prior, snap, ev('tool_use', { agent: 'backend', action: 'Bash' })]);
  expect(agent(s, 'tester').status).toBe('idle');
  expect(s.tasks).toEqual([]);
  expect(agent(s, 'backend')).toMatchObject({ status: 'working', currentTask: 'T-9', lastAction: 'Bash' });
});

test('snapshot round-trip equals the original', () => {
  const events = [
    ev('task', { id: 'T-1', title: 't', owner: 'backend', state: 'in_progress' }),
    ev('agent_start', { agent: 'backend', task: 'T-1' }), ev('agent_start', { agent: 'Explore' }),
    ev('status', { agent: 'reviewer', status: 'blocked', reason: 'Nope' }),
    ev('approval_requested', { id: 'WO-1', summary: 'S', agents: ['tester'] }),
    ev('handoff', { from: 'backend', to: 'tester', task: 'T-1' }),
    ev('escalation', { task: 'T-7', summary: 'Help' }),
    ev('tool_use', { agent: 'team', action: 'x', source: 'hook' }),
  ];
  const snap = { type: 'snapshot', source: 'cli', time: new Date(T0).toISOString(), state: JSON.parse(JSON.stringify(foldEvents(events, team))) };
  expect(buildState([snap], team, now)).toEqual(buildState(events, team, now));
});

test('snapshot with missing fields does not break later events', () => {
  const s = build([ev('snapshot', { state: {} }), ev('agent_start', { agent: 'backend' }), ev('tool_use', { agent: 'backend', action: 'x' })]);
  expect(agent(s, 'backend').status).toBe('working');
  expect(s.log).toHaveLength(2);
});

test('approver updatedAt is the latest approval request or decision', () => {
  expect(agent(build([]), 'jimmy').updatedAt).toBeNull();
  const req = ev('approval_requested', { id: 'WO-1', summary: 'S' });
  expect(agent(build([req]), 'jimmy').updatedAt).toBe(req.time);
  const dec = ev('approval_decided', { id: 'WO-1', state: 'approved' });
  expect(agent(build([req, dec]), 'jimmy').updatedAt).toBe(dec.time);
});

test('approval does not move a blocked agent to awaiting_approval', () => {
  const s = build([ev('status', { agent: 'backend', status: 'blocked', reason: 'Stuck' }), ev('approval_requested', { id: 'WO-1', summary: 'S', agents: ['backend'] })]);
  expect(agent(s, 'backend').status).toBe('blocked');
  expect(s.needsYou.map((n) => n.kind)).toEqual(['approval', 'blocked']);
});

test('agent stays awaiting while another pending approval lists it', () => {
  const a = ev('approval_requested', { id: 'WO-1', summary: 'A', agents: ['backend'] });
  const b = ev('approval_requested', { id: 'WO-2', summary: 'B', agents: ['backend'] });
  const s1 = build([a, b, ev('approval_decided', { id: 'WO-1', state: 'approved' })]);
  expect(agent(s1, 'backend').status).toBe('awaiting_approval');
  const s2 = build([a, b, ev('approval_decided', { id: 'WO-1', state: 'approved' }), ev('approval_decided', { id: 'WO-2', state: 'approved' })]);
  expect(agent(s2, 'backend').status).toBe('idle');
});

test('task and escalation events without agent are attributed to planner', () => {
  const t = ev('task', { id: 'T-1', title: 't', owner: 'backend', state: 'todo' });
  const e = ev('escalation', { task: 'T-1', summary: 'Help' });
  const s = build([t, e]);
  expect(s.agentLogs.planner).toHaveLength(2);
  expect(agent(s, 'planner').updatedAt).toBe(e.time);
});

test('every agent carries its normalized id, including approver and visitors', () => {
  const s = build([ev('status', { agent: ' Guest ', status: 'working' })]);
  expect(s.agents.map((a) => a.id)).toEqual(['planner', 'backend', 'frontend', 'tester', 'reviewer', 'jimmy', 'guest']);
  expect(s.agents.at(-1).isVisitor).toBe(true);
});

test('agent_stop keeps a blocked or waiting agent in that state', () => {
  const s = build([ev('agent_start', { agent: 'backend', task: 'T-4' }), ev('status', { agent: 'backend', status: 'blocked', reason: 'CI failing', progress: 40 }), ev('agent_stop', { agent: 'backend', source: 'hook' })]);
  expect(agent(s, 'backend')).toMatchObject({ status: 'blocked', reason: 'CI failing', stoppedAtProgress: 40 });
  expect(s.needsYou).toEqual([{ kind: 'blocked', id: 'backend', summary: 'CI failing' }]);
  const w = build([ev('agent_start', { agent: 'tester' }), ev('status', { agent: 'tester', status: 'awaiting_approval' }), ev('agent_stop', { agent: 'tester' })]);
  expect(agent(w, 'tester').status).toBe('awaiting_approval');
  const again = build([ev('status', { agent: 'backend', status: 'blocked', reason: 'CI failing' }), ev('agent_stop', { agent: 'backend' }), ev('agent_start', { agent: 'backend' })]);
  expect(agent(again, 'backend')).toMatchObject({ status: 'working', reason: null });
  expect(again.needsYou).toEqual([]);
});

test('hook-sourced planner idle applies only while the planner is working', () => {
  const idle = ev('status', { agent: 'planner', status: 'idle', source: 'hook' });
  const working = build([ev('status', { agent: 'planner', status: 'working', task: 'WO-2' }), idle]);
  expect(agent(working, 'planner').status).toBe('idle');
  for (const before of [
    ev('status', { agent: 'planner', status: 'blocked', reason: 'Need Jimmy' }),
    ev('status', { agent: 'planner', status: 'awaiting_approval' }),
    ev('status', { agent: 'planner', status: 'done' }),
  ]) {
    const s = build([before, { ...idle, time: new Date(lastTime() + 500).toISOString() }]);
    expect(agent(s, 'planner').status).toBe(before.status);
  }
  const untouched = build([idle]);
  expect(agent(untouched, 'planner')).toMatchObject({ status: 'idle', updatedAt: null });
  expect(untouched.log).toEqual([]);
  const cli = build([ev('status', { agent: 'planner', status: 'blocked', reason: 'x' }), ev('status', { agent: 'planner', status: 'idle' })]);
  expect(agent(cli, 'planner').status).toBe('idle');
});

test('visitors appear only while active or recently updated', () => {
  const events = [ev('agent_start', { agent: 'explore' }), ev('agent_stop', { agent: 'explore' })];
  const stopped = lastTime();
  expect(build(events, new Date(stopped + 4 * 60_000)).agents.map((a) => a.id)).toContain('explore');
  expect(build(events, new Date(stopped + 6 * 60_000)).agents.map((a) => a.id)).not.toContain('explore');
  const working = [ev('agent_start', { agent: 'plan' })];
  expect(build(working, new Date(lastTime() + 60 * 60_000)).agents.map((a) => a.id)).toContain('plan');
  const blocked = [ev('status', { agent: 'guest', status: 'blocked', reason: 'x' })];
  expect(build(blocked, new Date(lastTime() + 60 * 60_000)).agents.map((a) => a.id)).toContain('guest');
  const waiting = [ev('status', { agent: 'guest', status: 'awaiting_approval' })];
  expect(build(waiting, new Date(lastTime() + 60 * 60_000)).agents.map((a) => a.id)).toContain('guest');
  const idle = [ev('status', { agent: 'guest', status: 'idle' })];
  expect(build(idle, new Date(lastTime() + 60 * 60_000)).agents.map((a) => a.id)).not.toContain('guest');
});

test('agent_start resets progress, next step and reason', () => {
  const s = build([ev('status', { agent: 'backend', status: 'working', task: 'T-1', progress: 80, nextStep: 'Ship' }), ev('agent_stop', { agent: 'backend' }), ev('agent_start', { agent: 'backend', task: 'T-2' })]);
  expect(agent(s, 'backend')).toMatchObject({ status: 'working', currentTask: 'T-2', progress: 0, nextStep: null, reason: null });
  const noTask = build([ev('status', { agent: 'backend', status: 'working', task: 'T-1' }), ev('agent_start', { agent: 'backend' })]);
  expect(agent(noTask, 'backend').currentTask).toBeNull();
});
