import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  EVENT_TYPES, AGENT_STATUSES, TASK_STATES, APPROVAL_STATES,
  validateEvent, appendEvent, readEvents,
} from '../lib/events.mjs';

const tmpLog = (...extra) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atk-'));
  return path.join(dir, ...extra, '.team', 'events.jsonl');
};
const base = { source: 'cli' };
const ok = (e) => validateEvent({ ...base, ...e }).ok;

test('exports constants', () => {
  expect(EVENT_TYPES).toEqual(['agent_start', 'agent_stop', 'tool_use', 'status', 'task',
    'approval_requested', 'approval_decided', 'handoff', 'escalation', 'snapshot',
    'deploy', 'release', 'released', 'guard_blocked']);
  expect(AGENT_STATUSES).toEqual(['idle', 'working', 'blocked', 'awaiting_approval', 'done']);
  expect(TASK_STATES).toEqual(['todo', 'in_progress', 'in_review', 'done']);
  expect(APPROVAL_STATES).toEqual(['pending', 'approved', 'rejected', 'changes_requested']);
});

test('validates required fields per type', () => {
  expect(validateEvent({ type: 'status', agent: 'backend', source: 'cli', status: 'working' }).ok).toBe(true);
  expect(validateEvent({ type: 'status', agent: 'backend', source: 'cli', status: 'sleeping' })).toEqual({ ok: false, error: expect.stringContaining('status') });
  expect(validateEvent({ type: 'status', agent: 'backend', source: 'cli', status: 'blocked' }).ok).toBe(false);
  expect(validateEvent({ type: 'status', agent: 'b', source: 'cli', status: 'working', progress: 101 }).ok).toBe(false);
  expect(validateEvent({ type: 'nope', agent: 'b', source: 'cli' }).ok).toBe(false);
});

test('status: blocked with reason ok; progress must be integer 0-100', () => {
  expect(ok({ type: 'status', agent: 'b', status: 'blocked', reason: 'waiting' })).toBe(true);
  expect(ok({ type: 'status', agent: 'b', status: 'working', progress: 0 })).toBe(true);
  expect(ok({ type: 'status', agent: 'b', status: 'working', progress: 100 })).toBe(true);
  expect(ok({ type: 'status', agent: 'b', status: 'working', progress: -1 })).toBe(false);
  expect(ok({ type: 'status', agent: 'b', status: 'working', progress: 5.5 })).toBe(false);
  expect(ok({ type: 'status', agent: 'b', status: 'working', progress: '5' })).toBe(false);
  expect(ok({ type: 'status', status: 'working' })).toBe(false);
});

test('agent_start / agent_stop need agent', () => {
  for (const type of ['agent_start', 'agent_stop']) {
    expect(ok({ type, agent: 'a' })).toBe(true);
    expect(ok({ type })).toBe(false);
    expect(ok({ type, agent: '' })).toBe(false);
  }
});

test('tool_use needs agent and action', () => {
  expect(ok({ type: 'tool_use', agent: 'a', action: 'Edit' })).toBe(true);
  expect(ok({ type: 'tool_use', agent: 'a' })).toBe(false);
  expect(ok({ type: 'tool_use', action: 'Edit' })).toBe(false);
});

test('task needs id, title, owner, valid state', () => {
  const t = { type: 'task', id: 'T-1', title: 'x', owner: 'backend', state: 'todo' };
  expect(ok(t)).toBe(true);
  expect(ok({ ...t, state: 'finished' })).toBe(false);
  expect(ok({ ...t, owner: undefined })).toBe(false);
  expect(ok({ ...t, title: undefined })).toBe(false);
  expect(ok({ ...t, id: undefined })).toBe(false);
});

test('approval_requested needs id and summary', () => {
  expect(ok({ type: 'approval_requested', id: 'A-1', summary: 's' })).toBe(true);
  expect(ok({ type: 'approval_requested', id: 'A-1' })).toBe(false);
  expect(ok({ type: 'approval_requested', summary: 's' })).toBe(false);
});

test('approval_decided needs id and a non-pending valid state', () => {
  expect(ok({ type: 'approval_decided', id: 'A-1', state: 'approved' })).toBe(true);
  expect(ok({ type: 'approval_decided', id: 'A-1', state: 'pending' })).toBe(false);
  expect(ok({ type: 'approval_decided', id: 'A-1', state: 'maybe' })).toBe(false);
  expect(ok({ type: 'approval_decided', state: 'approved' })).toBe(false);
});

test('handoff needs from, to, task', () => {
  expect(ok({ type: 'handoff', from: 'a', to: 'b', task: 'T-1' })).toBe(true);
  expect(ok({ type: 'handoff', from: 'a', to: 'b' })).toBe(false);
  expect(ok({ type: 'handoff', from: 'a', task: 'T-1' })).toBe(false);
});

test('escalation needs task and summary', () => {
  expect(ok({ type: 'escalation', task: 'T-1', summary: 's' })).toBe(true);
  expect(ok({ type: 'escalation', task: 'T-1' })).toBe(false);
});

test('snapshot needs state object', () => {
  expect(ok({ type: 'snapshot', state: { agents: [] } })).toBe(true);
  expect(ok({ type: 'snapshot' })).toBe(false);
  expect(ok({ type: 'snapshot', state: 'x' })).toBe(false);
  expect(ok({ type: 'snapshot', state: null })).toBe(false);
});

test('source must be hook, cli or server', () => {
  for (const source of ['hook', 'cli', 'server']) expect(validateEvent({ type: 'agent_start', agent: 'a', source }).ok).toBe(true);
  expect(validateEvent({ type: 'agent_start', agent: 'a', source: 'web' }).ok).toBe(false);
  expect(validateEvent({ type: 'agent_start', agent: 'a' }).ok).toBe(false);
});

test('rejects non-object input', () => {
  expect(validateEvent(null).ok).toBe(false);
  expect(validateEvent('x').ok).toBe(false);
  expect(validateEvent([]).ok).toBe(false);
});

test('append then read round-trips and adds time', () => {
  const p = tmpLog();
  appendEvent(p, { type: 'agent_start', agent: 'backend', source: 'hook' }, new Date('2026-10-05T10:00:00Z'));
  const { events, warnings } = readEvents(p);
  expect(events[0].time).toBe('2026-10-05T10:00:00.000Z');
  expect(events[0].agent).toBe('backend');
  expect(warnings).toEqual([]);
});

test('append keeps an existing time and does not mutate the input', () => {
  const p = tmpLog();
  const e = { type: 'agent_start', agent: 'a', source: 'hook', time: '2026-01-01T00:00:00.000Z' };
  appendEvent(p, e);
  expect(readEvents(p).events[0].time).toBe('2026-01-01T00:00:00.000Z');
  const e2 = { type: 'agent_start', agent: 'a', source: 'hook' };
  appendEvent(p, e2);
  expect(e2.time).toBeUndefined();
});

test('append throws and writes nothing on invalid input', () => {
  const p = tmpLog();
  expect(() => appendEvent(p, { type: 'status', agent: 'a', source: 'cli', status: 'sleeping' })).toThrow(/status/);
  expect(fs.existsSync(p)).toBe(false);
  appendEvent(p, { type: 'agent_start', agent: 'a', source: 'hook' });
  const before = fs.readFileSync(p, 'utf8');
  expect(() => appendEvent(p, { type: 'nope', source: 'cli' })).toThrow(Error);
  expect(fs.readFileSync(p, 'utf8')).toBe(before);
});

test('append writes one JSON line ending in newline and creates .team/', () => {
  const p = tmpLog();
  appendEvent(p, { type: 'agent_start', agent: 'a', source: 'hook' });
  const raw = fs.readFileSync(p, 'utf8');
  expect(raw.endsWith('\n')).toBe(true);
  expect(raw.trim().split('\n')).toHaveLength(1);
});

test('missing file reads as empty', () => {
  expect(readEvents(tmpLog())).toEqual({ events: [], warnings: [] });
});

test('malformed complete line is skipped with a warning', () => {
  const p = tmpLog();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '{"type":"agent_start","agent":"a","source":"hook","time":"2026-10-05T10:00:00.000Z"}\nnot json\n');
  const r = readEvents(p);
  expect(r.events).toHaveLength(1);
  expect(r.warnings).toHaveLength(1);
});

test('complete line that is valid JSON but not an object/valid event is skipped with a warning; empty lines silently', () => {
  const p = tmpLog();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '[1]\n{"type":"nope","source":"cli"}\n\n');
  const r = readEvents(p);
  expect(r.events).toHaveLength(0);
  expect(r.warnings).toHaveLength(2); // array, unknown type (empty line is silent)
});

test('trailing line without newline is ignored silently (write in progress)', () => {
  const p = tmpLog();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '{"type":"agent_start","agent":"a","source":"hook","time":"2026-10-05T10:00:00.000Z"}\n{"type":"agent_st');
  const r = readEvents(p);
  expect(r.events).toHaveLength(1);
  expect(r.warnings).toHaveLength(0);
});

test('many sequential appends all parse', () => {
  const p = tmpLog();
  for (let i = 0; i < 50; i++) appendEvent(p, { type: 'tool_use', agent: `a${i}`, action: 'Edit', source: 'hook' });
  const r = readEvents(p);
  expect(r.events).toHaveLength(50);
  expect(r.warnings).toEqual([]);
});

test('works in a directory with spaces', () => {
  const p = tmpLog('Claude projects', 'My App');
  appendEvent(p, { type: 'agent_start', agent: 'a', source: 'hook' });
  expect(readEvents(p).events).toHaveLength(1);
  expect(p).toContain('Claude projects');
});

test('concurrent processes appending to one log all land as parseable lines', async () => {
  const p = tmpLog('Claude projects', 'concurrent');
  const mod = pathToFileURL(path.resolve('lib/events.mjs')).href;
  const script = `import(${JSON.stringify(mod)}).then(({appendEvent})=>{
    for (let i=0;i<50;i++) appendEvent(process.argv[1],{type:'tool_use',agent:'p'+process.argv[2],action:'Edit '+'x'.repeat(2000),source:'hook'});
  })`;
  const run = (n) => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['-e', script, p, String(n)], { stdio: 'inherit' });
    c.on('error', reject);
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`child ${n} exited ${code}`))));
  });
  await Promise.all([0, 1, 2, 3].map(run));
  const r = readEvents(p);
  expect(r.warnings).toEqual([]);
  expect(r.events).toHaveLength(200);
}, 30000);

test('append after a crashed writer fragment keeps the new event intact', () => {
  const p = tmpLog();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '{"type":"agent_st');
  appendEvent(p, { type: 'agent_start', agent: 'a', source: 'hook' });
  const r = readEvents(p);
  expect(r.events).toHaveLength(1);
  expect(r.events[0].agent).toBe('a');
  expect(r.warnings).toHaveLength(1);
});

test('time, when present, must be a parseable date string', () => {
  expect(ok({ type: 'agent_start', agent: 'a', time: '2026-10-05T10:00:00.000Z' })).toBe(true);
  expect(ok({ type: 'agent_start', agent: 'a', time: 'yesterday-ish' })).toBe(false);
  expect(ok({ type: 'agent_start', agent: 'a', time: 12345 })).toBe(false);
  expect(() => appendEvent(tmpLog(), { type: 'agent_start', agent: 'a', source: 'hook', time: 'nope' })).toThrow(/time/);
});
