import { test, expect } from 'vitest';
import { buildState, foldEvents, GUARD_CAP } from '../lib/state.mjs';

const team = {
  project: 'P', staleAfterMinutes: 5, orgSkill: null, orgs: { sandbox: ['uat'] },
  approver: { id: 'jimmy', name: 'Jimmy', role: 'Approver', color: '#ffb900' },
  members: ['planner', 'analyst', 'admin', 'developer', 'qa', 'reviewer'].map((id) => ({ id, name: id, role: id, color: '#aabbcc' })),
};
const now = new Date('2026-10-15T18:00:00Z');
let n = 0;
const ev = (e) => ({ source: 'cli', time: new Date(Date.UTC(2026, 9, 15, 9, n++)).toISOString(), ...e });
const state = (events) => buildState(events, team, now);
const task = (state_ = 'in_progress') => ev({ type: 'task', agent: 'planner', id: 'T-012', title: 'Discount', owner: 'admin', state: state_ });

test('deploys keep the latest result per org and log a line', () => {
  const s = state([
    ev({ type: 'deploy', agent: 'admin', org: 'uat', result: 'failed' }),
    ev({ type: 'deploy', agent: 'developer', org: 'uat', result: 'passed', tests: '38/38', coverage: 92, task: 'T-012' }),
    ev({ type: 'deploy', agent: 'admin', org: 'dev', result: 'passed' }),
  ]);
  expect(s.deploys.map((d) => [d.org, d.agent, d.result])).toEqual([['uat', 'developer', 'passed'], ['dev', 'admin', 'passed']]);
  expect(s.deploys[0]).toMatchObject({ tests: '38/38', coverage: 92, task: 'T-012' });
  expect(s.agentLogs.developer.at(-1).event).toBe('Deployed to uat: passed, 38/38 tests, 92% coverage');
});

test('release then released', () => {
  const s1 = state([task(), ev({ type: 'release', agent: 'planner', task: 'T-012', components: 9, file: 'docs/release/T-012-changeset.md' })]);
  expect(s1.releases).toEqual([expect.objectContaining({ task: 'T-012', state: 'ready', components: 9, file: 'docs/release/T-012-changeset.md' })]);
  expect(s1.tasks[0]).toMatchObject({ progress: 95, stage: 'Change set ready' });
  const s2 = state([task(), ev({ type: 'release', agent: 'planner', task: 'T-012', components: 9 }), ev({ type: 'released', agent: 'planner', task: 'T-012' })]);
  expect(s2.releases[0].state).toBe('released');
  expect(s2.tasks[0]).toMatchObject({ progress: 100, stage: 'Released' });
});

test('guard blocks keep the last GUARD_CAP entries', () => {
  const events = Array.from({ length: GUARD_CAP + 3 }, (_, i) =>
    ev({ type: 'guard_blocked', agent: 'developer', command: `Running sf ${i}`, reason: `r${i}`, source: 'hook' }));
  const s = state(events);
  expect(s.guardBlocks).toHaveLength(GUARD_CAP);
  expect(s.guardBlocks.at(-1)).toMatchObject({ agent: 'developer', command: `Running sf ${GUARD_CAP + 2}`, reason: `r${GUARD_CAP + 2}` });
  expect(s.agentLogs.developer.at(-1).event).toBe(`Guard blocked: r${GUARD_CAP + 2}`);
});

test('approvals record their task', () => {
  const s = state([ev({ type: 'approval_requested', agent: 'planner', id: 'WO-7-admin', summary: 'Flow', agents: ['admin'], task: 'T-012' })]);
  expect(s.approvals[0].task).toBe('T-012');
});

test('progress follows the pipeline, including a QA bounce-back', () => {
  const base = [
    task(),
    ev({ type: 'approval_requested', agent: 'planner', id: 'WO-7-admin', summary: 'Flow', agents: ['admin'], task: 'T-012' }),
  ];
  expect(state(base).tasks[0]).toMatchObject({ progress: 20, stage: 'Waiting for approval' });
  const approvedEvents = [...base, ev({ type: 'approval_decided', agent: 'planner', id: 'WO-7-admin', state: 'approved' }),
    ev({ type: 'status', agent: 'admin', status: 'working', task: 'T-012', progress: 50 })];
  expect(state(approvedEvents).tasks[0]).toMatchObject({ progress: 45, stage: 'Building' });
  const deployed = [...approvedEvents, ev({ type: 'deploy', agent: 'admin', org: 'uat', result: 'passed', task: 'T-012' })];
  expect(state(deployed).tasks[0]).toMatchObject({ progress: 65, stage: 'In sandbox' });
  const bounced = [...deployed, ev({ type: 'handoff', agent: 'qa', from: 'qa', to: 'admin', task: 'T-012' })];
  expect(state(bounced).tasks[0]).toMatchObject({ progress: 45, stage: 'Back to build' });
  const passed = [...bounced, ev({ type: 'deploy', agent: 'admin', org: 'uat', result: 'passed', task: 'T-012' }),
    ev({ type: 'handoff', agent: 'qa', from: 'qa', to: 'reviewer', task: 'T-012' })];
  expect(state(passed).tasks[0]).toMatchObject({ progress: 80, stage: 'QA passed' });
  const reviewed = [...passed, ev({ type: 'handoff', agent: 'reviewer', from: 'reviewer', to: 'planner', task: 'T-012' })];
  expect(state(reviewed).tasks[0]).toMatchObject({ progress: 90, stage: 'Review passed' });
});

test('a failed deploy does not move progress', () => {
  const s = state([task(), ev({ type: 'deploy', agent: 'admin', org: 'uat', result: 'failed', task: 'T-012' })]);
  expect(s.tasks[0]).toMatchObject({ progress: 5, stage: 'To do' });
});

test('a snapshot keeps the new folded fields', () => {
  const events = [
    task(),
    ev({ type: 'deploy', agent: 'admin', org: 'uat', result: 'passed', task: 'T-012' }),
    ev({ type: 'release', agent: 'planner', task: 'T-012', components: 3 }),
    ev({ type: 'guard_blocked', agent: 'developer', reason: 'r', source: 'hook' }),
  ];
  const snap = { type: 'snapshot', source: 'server', time: now.toISOString(), state: foldEvents(events, team) };
  const fromSnap = buildState([snap], team, now);
  expect(fromSnap).toEqual(state(events));
  expect(fromSnap.deploys).toHaveLength(1);
  expect(fromSnap.tasks[0].stage).toBe('Change set ready');
});
