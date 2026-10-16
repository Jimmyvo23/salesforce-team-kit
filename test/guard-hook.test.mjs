import { test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mentionsSf } from '../hooks/guard-org.mjs';

const HOOK = fileURLToPath(new URL('../hooks/guard-org.mjs', import.meta.url));
let root;
let project;
let home;
let bin;

const FAKE_SF = `#!/usr/bin/env node
const args = process.argv.slice(2);
const alias = args[args.indexOf('-o') + 1];
const urls = { uat: 'https://acme--uat.sandbox.my.salesforce.com', sneaky: 'https://acme.my.salesforce.com' };
require('node:fs').appendFileSync(process.env.FAKE_SF_LOG, alias + '\\n');
if (!urls[alias]) process.exit(1);
process.stdout.write(JSON.stringify({ status: 0, result: { instanceUrl: urls[alias], accessToken: 'SECRET-TOKEN' } }));
`;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sftk-guard-'));
  project = path.join(root, 'my project');
  home = path.join(root, 'home');
  bin = path.join(root, 'bin');
  fs.mkdirSync(path.join(project, '.team'), { recursive: true });
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'sf'), FAKE_SF, { mode: 0o755 });
  fs.writeFileSync(path.join(project, '.team', 'team.json'), JSON.stringify({
    project: 'P', orgs: { sandbox: ['uat', 'sneaky'] },
    approver: { id: 'jimmy', name: 'Jimmy', role: 'r', color: '#ffb900' },
    members: [{ id: 'planner', name: 'Architect', role: 'r', color: '#6a5ae0' }],
  }));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const runHook = (input) => spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify(input),
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_PROJECT_DIR: project, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_SF_LOG: path.join(root, 'sf.log') },
});
const bash = (command, extra = {}) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, ...extra });
const events = () => {
  const f = path.join(project, '.team', 'events.jsonl');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const everything = () => [
  ...events().map((e) => JSON.stringify(e)),
  fs.existsSync(path.join(project, '.team', 'org-cache.json')) ? fs.readFileSync(path.join(project, '.team', 'org-cache.json'), 'utf8') : '',
].join('\n');

test('allows a sandbox command silently', () => {
  const r = runHook(bash('sf project deploy start -o uat -m ApexClass:Foo'));
  expect(r.status).toBe(0);
  expect(r.stdout).toBe('');
  expect(r.stderr).toBe('');
  expect(events()).toEqual([]);
});

test('blocks an unlisted org with exit 2, a reason and an event', () => {
  const r = runHook(bash('sf project deploy start -o prod', { agent_type: 'Developer' }));
  expect(r.status).toBe(2);
  expect(r.stdout).toBe('');
  expect(r.stderr).toMatch(/^Blocked by the org guard: "prod" is not listed as a sandbox/);
  expect(events()).toEqual([expect.objectContaining({ type: 'guard_blocked', agent: 'developer', source: 'hook', command: 'Running sf project' })]);
});

test('blocks a listed alias that is really production; the token never leaks', () => {
  const r = runHook(bash('sf data query -o sneaky -q "SELECT Id FROM Account"'));
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/acme\.my\.salesforce\.com, which is not a sandbox/);
  expect(`${r.stdout}${r.stderr}${everything()}`).not.toContain('SECRET-TOKEN');
});

test('caches the instance URL between calls', () => {
  runHook(bash('sf data query -o uat -q x'));
  runHook(bash('sf data query -o uat -q y'));
  expect(fs.readFileSync(path.join(root, 'sf.log'), 'utf8').trim().split('\n')).toEqual(['uat']);
  const cache = JSON.parse(fs.readFileSync(path.join(project, '.team', 'org-cache.json'), 'utf8'));
  expect(cache.uat.url).toBe('https://acme--uat.sandbox.my.salesforce.com');
});

test('uses the project default org when no -o is given', () => {
  fs.mkdirSync(path.join(project, '.sf'));
  fs.writeFileSync(path.join(project, '.sf', 'config.json'), '{"target-org":"nitro-prod"}');
  const r = runHook(bash('sf project deploy start -m ApexClass:Foo'));
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/"nitro-prod" is not listed/);
});

test('main session blocks are attributed to planner', () => {
  runHook(bash('sf org display -o uat'));
  expect(events()[0]).toMatchObject({ agent: 'planner', reason: expect.stringMatching(/access token/) });
});

const quiet = (r, status) => {
  expect(r.status).toBe(status);
  expect(r.stdout).toBe('');
};
const rawRun = (input, env) => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', env: { ...process.env, HOME: home, ...env } });

test('non-Bash tools, and bad input without sf, are allowed silently', () => {
  const r = runHook({ tool_name: 'Edit', tool_input: { file_path: 'x' } });
  quiet(r, 0);
  expect(r.stderr).toBe('');
  const bad = rawRun('not json', { CLAUDE_PROJECT_DIR: project });
  quiet(bad, 0);
  expect(bad.stderr).toBe('');
});

test('malformed input that mentions sf is blocked', () => {
  const r = rawRun('sf data query -o prod {', { CLAUDE_PROJECT_DIR: project });
  quiet(r, 2);
  expect(r.stderr).toBe('Blocked by the org guard: The org guard could not read this command, so it is blocked.\n');
});

test('no project dir: sf commands are blocked, others allowed silently', () => {
  const r = rawRun(JSON.stringify(bash('sf data query -o prod -q x')), { CLAUDE_PROJECT_DIR: '' });
  quiet(r, 2);
  expect(r.stderr).toBe("Blocked by the org guard: The org guard can't find the project folder, so sf commands are blocked.\n");
  const ok = rawRun(JSON.stringify(bash('git status')), { CLAUDE_PROJECT_DIR: '' });
  quiet(ok, 0);
  expect(ok.stderr).toBe('');
});

test('falls back to the input cwd when CLAUDE_PROJECT_DIR is empty', () => {
  const r = rawRun(JSON.stringify(bash('sf data query -o prod -q x', { cwd: project })), { CLAUDE_PROJECT_DIR: '' });
  quiet(r, 2);
  expect(r.stderr).toMatch(/"prod" is not listed/);
});

test('mentionsSf spots the Salesforce CLI', () => {
  for (const t of ['SF data query', 'sfdx force:x', 'npx @salesforce/cli data query']) expect(mentionsSf(t)).toBe(true);
  for (const t of ['git status', 'salesforce docs']) expect(mentionsSf(t)).toBe(false);
});

test('a broken team.json blocks sf org commands only', () => {
  fs.writeFileSync(path.join(project, '.team', 'team.json'), '{broken');
  expect(runHook(bash('git status')).status).toBe(0);
  const r = runHook(bash('sf data query -o uat -q x'));
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/can't read \.team\/team\.json/);
});
