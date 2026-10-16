import { test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTeam } from '../lib/team.mjs';
import { appendEvent, readEvents } from '../lib/events.mjs';
import { buildState } from '../lib/state.mjs';
import { rotateIfNeeded } from '../lib/rotate.mjs';

const team = loadTeam(fileURLToPath(new URL('./fixtures/team-web.json', import.meta.url))).team;
const T0 = Date.parse('2026-10-05T12:00:00Z');
const now = new Date(T0 + 60_000);
let dir;
let log;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotate test '));
  log = path.join(dir, '.team', 'events.jsonl');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function seed() {
  const at = (i) => new Date(T0 + i * 1000);
  appendEvent(log, { type: 'task', source: 'cli', id: 'T-1', title: 'Pricing', owner: 'backend', state: 'in_progress' }, at(1));
  appendEvent(log, { type: 'agent_start', source: 'hook', agent: 'backend', task: 'T-1' }, at(2));
  appendEvent(log, { type: 'status', source: 'cli', agent: 'backend', status: 'working', progress: 40, task: 'T-1', nextStep: 'Write tests' }, at(3));
  appendEvent(log, { type: 'approval_requested', source: 'cli', id: 'A-1', summary: 'Work order for T-1' }, at(4));
  appendEvent(log, { type: 'tool_use', source: 'hook', agent: 'tester', action: 'Ran the unit tests' }, at(5));
}
const strip = (s) => ({ ...s, updatedAt: undefined });

test('does nothing under the threshold', () => {
  seed();
  const before = fs.readFileSync(log, 'utf8');
  expect(rotateIfNeeded(log, team, now, 1_000_000)).toEqual({ rotated: false });
  expect(fs.readFileSync(log, 'utf8')).toBe(before);
});

test('missing log is not rotated', () => {
  expect(rotateIfNeeded(log, team, now, 200)).toEqual({ rotated: false });
});

test('rotates over the threshold into a dated archive and starts with a snapshot', () => {
  seed();
  const original = fs.readFileSync(log, 'utf8');
  const res = rotateIfNeeded(log, team, now, 200);
  expect(res).toEqual({ rotated: true, archivePath: path.join(dir, '.team', 'events-2026-10-05.jsonl') });
  expect(fs.readFileSync(res.archivePath, 'utf8')).toBe(original);
  const { events, warnings } = readEvents(log);
  expect(warnings).toEqual([]);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: 'snapshot', source: 'server', time: now.toISOString() });
  expect(events[0].state.agents).toBeDefined();
  expect(events[0].state.updatedAt).toBeUndefined();
});

test('state is unchanged by rotation, and survives appends afterwards', () => {
  seed();
  const oldEvents = readEvents(log).events;
  rotateIfNeeded(log, team, now, 200);
  const newEvents = readEvents(log).events;
  expect(strip(buildState(newEvents, team, now))).toEqual(strip(buildState(oldEvents, team, now)));
  const more = { type: 'status', source: 'cli', agent: 'backend', status: 'working', progress: 80 };
  appendEvent(log, more, new Date(T0 + 90_000));
  expect(buildState(readEvents(log).events, team, now).agents.find((a) => a.name === 'Backend').progress).toBe(80);
});

test('a second rotation the same day uses the -2 suffix, then -3', () => {
  seed();
  const first = rotateIfNeeded(log, team, now, 200);
  appendEvent(log, { type: 'tool_use', source: 'hook', agent: 'tester', action: 'x'.repeat(300) }, now);
  const before = strip(buildState(readEvents(log).events, team, now));
  const second = rotateIfNeeded(log, team, now, 200);
  expect(second.archivePath).toBe(path.join(dir, '.team', 'events-2026-10-05-2.jsonl'));
  expect(first.archivePath).not.toBe(second.archivePath);
  expect(strip(buildState(readEvents(log).events, team, now))).toEqual(before);
  appendEvent(log, { type: 'tool_use', source: 'hook', agent: 'tester', action: 'y'.repeat(300) }, now);
  expect(rotateIfNeeded(log, team, now, 200).archivePath).toBe(path.join(dir, '.team', 'events-2026-10-05-3.jsonl'));
});

test('archive date is the UTC date of now', () => {
  seed();
  const lateUtc = new Date('2026-10-05T23:30:00Z');
  expect(path.basename(rotateIfNeeded(log, team, lateUtc, 200).archivePath)).toBe('events-2026-10-05.jsonl');
});

test('default threshold is 5 MB', () => {
  seed();
  expect(rotateIfNeeded(log, team, now)).toEqual({ rotated: false });
});

test('a fold failure throws and leaves the log untouched', () => {
  seed();
  const before = fs.readFileSync(log, 'utf8');
  expect(() => rotateIfNeeded(log, null, now, 200)).toThrow();
  expect(fs.readFileSync(log, 'utf8')).toBe(before);
  expect(fs.readdirSync(path.join(dir, '.team'))).toEqual(['events.jsonl']);
});
