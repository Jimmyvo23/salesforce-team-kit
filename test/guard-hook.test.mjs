import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mentionsSf, finish, looksLikeSf } from '../hooks/guard-org.mjs';

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
let user = alias;
try { user = JSON.parse(require('node:fs').readFileSync(require('node:path').join(process.env.HOME, '.sfdx', 'alias.json'), 'utf8')).orgs[alias] ?? alias; } catch {}
const url = user.endsWith('@prod.com') ? urls.sneaky : urls[alias];
if (!url) process.exit(1);
process.stdout.write(JSON.stringify({ status: 0, result: { instanceUrl: url, accessToken: 'SECRET-TOKEN' } }));
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

// The caller's own SF_/SFDX_ variables would change the default org, so tests start without them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SF|SFDX)_/i.test(k)));
const runHook = (input, extraEnv = {}) => spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify(input),
  encoding: 'utf8',
  env: { ...cleanEnv, CLAUDE_PROJECT_DIR: project, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_SF_LOG: path.join(root, 'sf.log'), ...extraEnv },
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
  fs.mkdirSync(path.join(home, '.sfdx'));
  fs.writeFileSync(path.join(home, '.sfdx', 'alias.json'), '{"orgs":{"uat":"u@sb.com"}}');
  runHook(bash('sf data query -o uat -q x'));
  runHook(bash('sf data query -o uat -q y'));
  expect(fs.readFileSync(path.join(root, 'sf.log'), 'utf8').trim().split('\n')).toEqual(['uat']);
  const cache = JSON.parse(fs.readFileSync(path.join(project, '.team', 'org-cache.json'), 'utf8'));
  expect(cache.uat.url).toBe('https://acme--uat.sandbox.my.salesforce.com');
});

test('uses the project default org when no -o is given', () => {
  fs.writeFileSync(path.join(project, 'sfdx-project.json'), '{}');
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
const rawRun = (input, env) => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', env: { ...cleanEnv, HOME: home, ...env } });

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

describe('final fix F-1: the hook reads SF_ and SFDX_ variables before the config', () => {
  const sandboxDefault = () => {
    fs.writeFileSync(path.join(project, 'sfdx-project.json'), '{}');
    fs.mkdirSync(path.join(project, '.sf'));
    fs.writeFileSync(path.join(project, '.sf', 'config.json'), '{"target-org":"uat"}');
  };
  test('SF_TARGET_ORG in the hook environment wins over the project default', () => {
    sandboxDefault();
    expect(runHook(bash('sf data query -q "SELECT Id FROM User"')).status).toBe(0);
    const r = runHook(bash('sf data query -q "SELECT Id FROM User"'), { SF_TARGET_ORG: 'prod' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/"prod" is not listed/);
  });
  test('SFDX_DEFAULTUSERNAME counts too', () => {
    sandboxDefault();
    const r = runHook(bash('sf data query -q x'), { SFDX_DEFAULTUSERNAME: 'prod' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/"prod" is not listed/);
  });
  test('a default Dev Hub from the environment or the config must be a listed sandbox', () => {
    sandboxDefault();
    const r = runHook(bash('sf org create scratch -f config/project-scratch-def.json'), { SF_TARGET_DEV_HUB: 'prod-hub' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/default Dev Hub "prod-hub"/);
    fs.mkdirSync(path.join(home, '.sf'));
    fs.writeFileSync(path.join(home, '.sf', 'config.json'), '{"target-dev-hub":"prod-hub"}');
    expect(runHook(bash('sf org create scratch -f x.json')).status).toBe(2);
    expect(runHook(bash('sf data query -o uat -q x')).status).toBe(0);
  });
});

describe('final fix F-2: the hook resolves from the folder the command runs in', () => {
  const sfdx = (dir, org) => {
    fs.mkdirSync(path.join(dir, '.sf'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sfdx-project.json'), '{}');
    if (org) fs.writeFileSync(path.join(dir, '.sf', 'config.json'), JSON.stringify({ 'target-org': org }));
  };
  test('a folder outside the project needs an explicit org', () => {
    sfdx(project, 'uat');
    const other = path.join(root, 'other');
    sfdx(other, 'prod');
    const r = runHook(bash('sf data query -q "SELECT Id FROM User"', { cwd: other }));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Pass -o <sandbox alias>; this folder is outside the project\./);
    expect(runHook(bash('sf data query -o uat -q x', { cwd: other })).status).toBe(0);
  });
  test('a nested SFDX project uses its own default org', () => {
    sfdx(project, 'uat');
    const sub = path.join(project, 'sub');
    sfdx(sub, 'prod');
    expect(runHook(bash('sf data query -q x', { cwd: project })).status).toBe(0);
    const r = runHook(bash('sf data query -q x', { cwd: sub }));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/"prod" is not listed/);
  });
  test('without sfdx-project.json the project config is ignored, as sf does', () => {
    fs.mkdirSync(path.join(project, '.sf'));
    fs.writeFileSync(path.join(project, '.sf', 'config.json'), '{"target-org":"uat"}');
    fs.mkdirSync(path.join(home, '.sf'));
    fs.writeFileSync(path.join(home, '.sf', 'config.json'), '{"target-org":"prod"}');
    const r = runHook(bash('sf data query -q x', { cwd: project }));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/"prod" is not listed/);
  });
  test('scripts resolve from the command folder, and ~ is the home folder', () => {
    fs.writeFileSync(path.join(home, 'x.sh'), 'sf data query -o prod -q x\n');
    const r = runHook(bash('bash ~/x.sh'));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/~\/x\.sh runs sf commands/);
    const sub = path.join(project, 'scripts');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'deploy.sh'), 'sf project deploy start -o prod\n');
    const s = runHook(bash('bash deploy.sh', { cwd: sub }));
    expect(s.status).toBe(2);
    expect(s.stderr).toMatch(/deploy\.sh runs sf commands/);
  });
  test('a script the guard cannot read (missing or a folder) is blocked', () => {
    fs.mkdirSync(path.join(project, 'adir'));
    for (const f of ['missing.sh', 'adir']) {
      const r = runHook(bash(`bash ${f}`, { cwd: project }));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`The guard can't read ${f} to check it for sf commands. Run the sf commands directly.`);
    }
  });
});

test('final fix F-3: a run that rejects exits 2', async () => {
  /** @type {number[]} */ const codes = [];
  await finish(Promise.reject(new Error('boom')), (c) => { codes.push(c); });
  await finish(Promise.resolve(0), (c) => { codes.push(c); });
  expect(codes).toEqual([2, 0]);
});

describe('round 2 G-1: the hook blocks a default org the new and legacy config disagree on', () => {
  test('.sf and .sfdx in the project name different orgs', () => {
    fs.writeFileSync(path.join(project, 'sfdx-project.json'), '{}');
    fs.mkdirSync(path.join(project, '.sf'));
    fs.mkdirSync(path.join(project, '.sfdx'));
    fs.writeFileSync(path.join(project, '.sf', 'config.json'), '{"target-org":"uat"}');
    fs.writeFileSync(path.join(project, '.sfdx', 'sfdx-config.json'), '{"defaultusername":"uat"}');
    expect(runHook(bash('sf data query -q x')).status).toBe(0);
    fs.writeFileSync(path.join(project, '.sfdx', 'sfdx-config.json'), '{"defaultusername":"prod"}');
    const r = runHook(bash('sf data query -q x'));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('The new and legacy sf config name different default orgs. Pass -o <sandbox alias>.');
    expect(runHook(bash('sf data query -o uat -q x')).status).toBe(0);
  });
  test('SF_TARGET_ORG and SFDX_DEFAULTUSERNAME name different orgs', () => {
    const r = runHook(bash('sf data query -q x'), { SF_TARGET_ORG: 'uat', SFDX_DEFAULTUSERNAME: 'prod' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/SF_ and SFDX_ variables name different default orgs\. Pass -o <sandbox alias>\./);
  });
});

test('round 3 H-4: a new-style key in the legacy project file is the default', () => {
  fs.writeFileSync(path.join(project, 'sfdx-project.json'), '{}');
  fs.mkdirSync(path.join(project, '.sfdx'));
  fs.writeFileSync(path.join(project, '.sfdx', 'sfdx-config.json'), '{"target-org":"prod"}');
  fs.mkdirSync(path.join(home, '.sf'));
  fs.writeFileSync(path.join(home, '.sf', 'config.json'), '{"target-org":"uat"}');
  const r = runHook(bash('sf data query -q x'));
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/"prod" is not listed/);
});

test('round 3 H-5: the crash fallback spots obfuscated sf lines', async () => {
  for (const t of ['arch s\\f data query -o prod', "arch -x86_64 sh -c 's''f data query -q x -o prod'", 'env -S "s""f data query"', 'sf data query -o x']) {
    expect(await looksLikeSf(t), t).toBe(true);
  }
  for (const t of ['git status', 'echo salesforce']) expect(await looksLikeSf(t), t).toBe(false);
});

test('round 4 J-4: a legacy key in the project .sf file does not hide the home default', () => {
  fs.writeFileSync(path.join(project, 'sfdx-project.json'), '{}');
  fs.mkdirSync(path.join(project, '.sf'));
  fs.writeFileSync(path.join(project, '.sf', 'config.json'), '{"defaultusername":"uat"}');
  fs.mkdirSync(path.join(home, '.sf'));
  fs.writeFileSync(path.join(home, '.sf', 'config.json'), '{"target-org":"prod"}');
  const r = runHook(bash('sf data query -q x'));
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/new and legacy sf config/);
});

test('round 4 J-5: remapping an alias to another username is looked up again', () => {
  const aliases = (user) => {
    fs.mkdirSync(path.join(home, '.sfdx'), { recursive: true });
    fs.writeFileSync(path.join(home, '.sfdx', 'alias.json'), JSON.stringify({ orgs: { uat: user } }));
  };
  aliases('u@sb.com');
  expect(runHook(bash('sf data query -o uat -q x')).status).toBe(0);
  expect(runHook(bash('sf data query -o uat -q y')).status).toBe(0);
  expect(fs.readFileSync(path.join(root, 'sf.log'), 'utf8').trim().split('\n')).toEqual(['uat']);
  aliases('someone@prod.com');
  const r = runHook(bash('sf data query -o uat -q z'));
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/acme\.my\.salesforce\.com, which is not a sandbox/);
  expect(`${r.stdout}${r.stderr}${everything()}`).not.toContain('SECRET-TOKEN');
});

test('round 6 L-1: patterns are data for known-safe programs and blocked behind others, in any folder', () => {
  fs.mkdirSync(path.join(project, 'tools'));
  fs.writeFileSync(path.join(project, 'tools', 'sf'), '');
  expect(runHook(bash('ls *')).status).toBe(0);
  expect(runHook(bash('ls *', { cwd: path.join(project, 'tools') })).status).toBe(0);
  const r = runHook(bash('arch ./tools/s? data query -q x -o prod'));
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/could not find every sf command/);
  expect(runHook(bash('f=f; arch ./tools/s$f data query -q x -o prod')).stderr).toMatch(/can't see what arch will run/);
});
