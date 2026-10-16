import { test, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../cli/team-status.mjs';

const SCRIPT = fileURLToPath(new URL('../cli/team-status.mjs', import.meta.url));
const NOW = new Date('2026-10-05T12:00:00.000Z');

/** @type {string} */ let root;
/** @type {string[]} */ let errs;
const log = () => path.join(root, '.team', 'events.jsonl');
const lines = () => (fs.existsSync(log()) ? fs.readFileSync(log(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const run = (argv, env = { CLAUDE_PROJECT_DIR: root }, cwd = root) =>
  main(argv, { cwd, env, now: NOW, stderr: (s) => errs.push(s) });

beforeEach(() => {
  root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atk-')), 'My Project');
  fs.mkdirSync(path.join(root, '.team'), { recursive: true });
  errs = [];
});

test('status writes one event with mapped fields and numeric progress', () => {
  expect(run(['status', '--agent', 'backend', '--status', 'working', '--task', 'T-004', '--progress', '40', '--next', 'Write tests'])).toBe(0);
  expect(lines()).toEqual([{ type: 'status', source: 'cli', agent: 'backend', status: 'working', task: 'T-004', progress: 40, nextStep: 'Write tests', time: NOW.toISOString() }]);
});

test('status omits optional fields not passed', () => {
  run(['status', '--agent', 'backend', '--status', 'idle']);
  expect(Object.keys(lines()[0]).sort()).toEqual(['agent', 'source', 'status', 'time', 'type']);
});

test('status blocked without reason exits 2 and writes nothing', () => {
  expect(run(['status', '--agent', 'reviewer', '--status', 'blocked'])).toBe(2);
  expect(lines()).toEqual([]);
  expect(errs.join('')).toMatch(/reason/);
  expect(errs.join('')).toMatch(/Usage/i);
  expect(errs.join('').trim().split('\n')).toHaveLength(1);
});

test('status blocked with reason is stored', () => {
  expect(run(['status', '--agent', 'reviewer', '--status', 'blocked', '--reason', 'Checks failing'])).toBe(0);
  expect(lines()[0].reason).toBe('Checks failing');
});

test('non-numeric, fractional or out-of-range progress exits 2', () => {
  for (const p of ['abc', '4.5', '101', '-1', '']) {
    expect(run(['status', '--agent', 'a', '--status', 'working', '--progress', p])).toBe(2);
  }
  expect(lines()).toEqual([]);
});

test('task is written by planner', () => {
  expect(run(['task', '--id', 'T-004', '--title', 'Pricing', '--owner', 'backend', '--state', 'in_progress', '--notes', 'n'])).toBe(0);
  expect(lines()[0]).toMatchObject({ type: 'task', source: 'cli', agent: 'planner', id: 'T-004', title: 'Pricing', owner: 'backend', state: 'in_progress', notes: 'n' });
});

test('task with a bad state exits 2', () => {
  expect(run(['task', '--id', 'T', '--title', 'x', '--owner', 'b', '--state', 'nope'])).toBe(2);
  expect(lines()).toEqual([]);
});

test('approval splits --agents into a trimmed array', () => {
  expect(run(['approval', '--id', 'WO-3', '--summary', 'S', '--agents', 'backend, frontend,,'])).toBe(0);
  expect(lines()[0]).toMatchObject({ type: 'approval_requested', agent: 'planner', id: 'WO-3', summary: 'S', agents: ['backend', 'frontend'] });
});

test('approval without --agents omits the field', () => {
  run(['approval', '--id', 'WO-3', '--summary', 'S']);
  expect('agents' in lines()[0]).toBe(false);
});

test('decide writes approval_decided; pending is rejected', () => {
  expect(run(['decide', '--id', 'WO-3', '--state', 'approved', '--note', 'ok'])).toBe(0);
  expect(lines()[0]).toMatchObject({ type: 'approval_decided', agent: 'planner', id: 'WO-3', state: 'approved', note: 'ok' });
  expect(run(['decide', '--id', 'WO-3', '--state', 'pending'])).toBe(2);
  expect(lines()).toHaveLength(1);
});

test('handoff defaults file to <task>-<from>.md and uses from as agent', () => {
  expect(run(['handoff', '--from', 'backend', '--to', 'tester', '--task', 'T-004'])).toBe(0);
  expect(lines()[0]).toMatchObject({ type: 'handoff', agent: 'backend', from: 'backend', to: 'tester', task: 'T-004', file: '.team/handoffs/T-004-backend.md' });
  run(['handoff', '--from', 'a', '--to', 'b', '--task', 'T', '--file', 'x.md']);
  expect(lines()[1].file).toBe('x.md');
});

test('handoff default file uses the normalized from id', () => {
  expect(run(['handoff', '--from', ' Tester ', '--to', 'reviewer', '--task', 'T-004'])).toBe(0);
  expect(lines()[0].file).toBe('.team/handoffs/T-004-tester.md');
});

const writeTeam = () => fs.copyFileSync(fileURLToPath(new URL('./fixtures/team-web.json', import.meta.url)), path.join(root, '.team', 'team.json'));

test('unknown agent ids warn once on stderr but still write and exit 0', () => {
  writeTeam();
  expect(run(['status', '--agent', 'bakend', '--status', 'working'])).toBe(0);
  expect(errs).toHaveLength(1);
  expect(errs[0]).toMatch(/^Warning: .*bakend.*\n$/);
  expect(errs[0].trim().split('\n')).toHaveLength(1);
  errs = [];
  expect(run(['approval', '--id', 'WO-1', '--summary', 'S', '--agents', 'backend,ghost,phantom'])).toBe(0);
  expect(errs).toHaveLength(1);
  expect(errs[0]).toMatch(/ghost/);
  expect(errs[0]).toMatch(/phantom/);
  errs = [];
  expect(run(['handoff', '--from', 'backend', '--to', 'nobody', '--task', 'T-1'])).toBe(0);
  expect(run(['task', '--id', 'T-1', '--title', 't', '--owner', 'someone', '--state', 'todo'])).toBe(0);
  expect(errs).toHaveLength(2);
  expect(lines()).toHaveLength(4);
});

test('member and approver ids match case-insensitively without a warning', () => {
  writeTeam();
  expect(run(['status', '--agent', ' Backend ', '--status', 'working'])).toBe(0);
  expect(run(['handoff', '--from', 'Tester', '--to', 'REVIEWER', '--task', 'T-1'])).toBe(0);
  expect(run(['approval', '--id', 'WO-1', '--summary', 'S', '--agents', 'backend, Jimmy'])).toBe(0);
  expect(errs).toEqual([]);
});

test('no or invalid team.json means no warning', () => {
  expect(run(['status', '--agent', 'anyone', '--status', 'working'])).toBe(0);
  fs.writeFileSync(path.join(root, '.team', 'team.json'), '{ nope');
  expect(run(['status', '--agent', 'anyone', '--status', 'working'])).toBe(0);
  expect(errs).toEqual([]);
});

test('escalate writes an escalation by planner', () => {
  expect(run(['escalate', '--task', 'T-004', '--summary', 'Failed twice'])).toBe(0);
  expect(lines()[0]).toMatchObject({ type: 'escalation', agent: 'planner', task: 'T-004', summary: 'Failed twice' });
});

test('unknown subcommand, missing subcommand, missing flag, unknown flag exit 2', () => {
  expect(run(['bogus'])).toBe(2);
  expect(run([])).toBe(2);
  expect(run(['escalate', '--task', 'T'])).toBe(2);
  expect(run(['escalate', '--task', 'T', '--summary', 's', '--wat', '1'])).toBe(2);
  expect(lines()).toEqual([]);
  expect(errs.length).toBe(4);
});

test('root found through a nested cwd', () => {
  const deep = path.join(root, 'a', 'b');
  fs.mkdirSync(deep, { recursive: true });
  expect(run(['escalate', '--task', 'T', '--summary', 's'], {}, deep)).toBe(0);
  expect(lines()).toHaveLength(1);
});

test('no .team folder exits 2 with the installer message', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'atk-bare-'));
  expect(run(['escalate', '--task', 'T', '--summary', 's'], {}, bare)).toBe(2);
  expect(errs.join('')).toContain('No .team folder found. Run the installer first.');
  const bare2 = fs.mkdtempSync(path.join(os.tmpdir(), 'atk-bare-'));
  errs = [];
  expect(run(['escalate', '--task', 'T', '--summary', 's'], { CLAUDE_PROJECT_DIR: bare2 })).toBe(2);
  expect(errs.join('')).toContain('No .team folder found');
  expect(fs.existsSync(path.join(bare2, '.team'))).toBe(false);
});

test('real script runs from a root containing a space', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'status', '--agent', 'backend', '--status', 'working'], {
    cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: '' }, encoding: 'utf8',
  });
  expect(r.status).toBe(0);
  expect(lines()).toHaveLength(1);
  const bad = spawnSync(process.execPath, [SCRIPT, 'nope'], { cwd: root, encoding: 'utf8' });
  expect(bad.status).toBe(2);
  expect(bad.stderr).toMatch(/Usage/i);
});
