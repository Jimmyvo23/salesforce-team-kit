import { test, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../cli/team-status.mjs';

const NOW = new Date('2026-10-15T12:00:00.000Z');
let root;
let errs;
const lines = () => {
  const f = path.join(root, '.team', 'events.jsonl');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const run = (argv) => main(argv, { cwd: root, env: { CLAUDE_PROJECT_DIR: root }, now: NOW, stderr: (s) => errs.push(s) });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sftk-cli-'));
  fs.mkdirSync(path.join(root, '.team'));
  errs = [];
});

test('deploy writes the event with numeric coverage', () => {
  expect(run(['deploy', '--agent', 'developer', '--org', 'uat', '--result', 'passed', '--tests', '38/38', '--coverage', '92', '--task', 'T-012'])).toBe(0);
  expect(lines()).toEqual([{ type: 'deploy', source: 'cli', agent: 'developer', org: 'uat', result: 'passed', tests: '38/38', coverage: 92, task: 'T-012', time: NOW.toISOString() }]);
});

test('deploy rejects a bad result, bad coverage and bad tests', () => {
  expect(run(['deploy', '--agent', 'admin', '--org', 'uat', '--result', 'ok'])).toBe(2);
  expect(run(['deploy', '--agent', 'admin', '--org', 'uat', '--result', 'passed', '--coverage', 'x'])).toBe(2);
  expect(run(['deploy', '--agent', 'admin', '--org', 'uat', '--result', 'passed', '--coverage', '120'])).toBe(2);
  expect(run(['deploy', '--agent', 'admin', '--org', 'uat', '--result', 'passed', '--tests', 'all'])).toBe(2);
  expect(lines()).toEqual([]);
});

test('release defaults the file and is written by planner', () => {
  expect(run(['release', '--task', 'T-012', '--components', '9'])).toBe(0);
  expect(lines()[0]).toMatchObject({ type: 'release', agent: 'planner', task: 'T-012', components: 9, file: 'docs/release/T-012-changeset.md' });
});

test('release needs at least one component', () => {
  expect(run(['release', '--task', 'T-012', '--components', '0'])).toBe(2);
  expect(run(['release', '--task', 'T-012'])).toBe(2);
});

test('released', () => {
  expect(run(['released', '--task', 'T-012', '--note', 'Deployed 18:00'])).toBe(0);
  expect(lines()[0]).toMatchObject({ type: 'released', agent: 'planner', task: 'T-012', note: 'Deployed 18:00' });
});

test('approval accepts --task', () => {
  expect(run(['approval', '--id', 'WO-7-admin', '--summary', 'Flow', '--agents', 'admin', '--task', 'T-012'])).toBe(0);
  expect(lines()[0]).toMatchObject({ type: 'approval_requested', id: 'WO-7-admin', agents: ['admin'], task: 'T-012' });
});
