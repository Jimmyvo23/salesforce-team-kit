import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from '../install.mjs';
import { STORY_PATH } from '../lib/install/setup.mjs';

let root, target, home, lookups;
const URLS = {
  uat: 'https://acme--uat.sandbox.my.salesforce.com',
  dev: 'https://acme--dev.sandbox.my.salesforce.com',
  prod: 'https://acme.my.salesforce.com',
};
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sftk-flow-'));
  target = path.join(root, 'Client X');
  home = path.join(root, 'home');
  fs.mkdirSync(target, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: target });
  fs.mkdirSync(path.join(home, '.claude', 'plugins', 'cache', 'superpowers-marketplace', 'superpowers'), { recursive: true });
  fs.mkdirSync(path.join(home, '.sfdx'), { recursive: true });
  fs.writeFileSync(path.join(home, '.sfdx', 'alias.json'), JSON.stringify({ orgs: { dev: 'u.dev', prod: 'u', uat: 'u.uat' } }));
  lookups = [];
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

async function cli(args, answers = []) {
  const queue = [...answers];
  let out = '';
  const code = await main(args, {
    cwd: root, homeDir: home, nodeVersion: 'v24.1.0',
    hasCommand: () => true,
    gitInit: () => true,
    stdout: (s) => { out += s; },
    stderr: (s) => { out += s; },
    ask: async (q) => { if (queue.length === 0) throw new Error(`unexpected question: ${q}`); return queue.shift(); },
    lookupInstanceUrl: (a) => { lookups.push(a); return URLS[a] ?? null; },
  });
  return { code, out };
}
const team = () => JSON.parse(fs.readFileSync(path.join(target, '.team', 'team.json'), 'utf8'));
const exists = (rel) => fs.existsSync(path.join(target, rel));

describe('first install, interactive', () => {
  test('asks name, sandboxes, org name; writes team.json, skeleton and story', async () => {
    // apply changes, project name, sandboxes, org name
    const r = await cli(['--target', target], ['y', '', '2', 'clientx']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('1) dev  (acme--dev.sandbox.my.salesforce.com)');
    expect(r.out).toContain('2) uat  (acme--uat.sandbox.my.salesforce.com)');
    expect(r.out).toContain('prod: not a sandbox (acme.my.salesforce.com)');
    const t = team();
    expect(t.project).toBe('Client X');
    expect(t.orgs.sandbox).toEqual(['uat']);
    expect(t.orgSkill).toBe('clientx-org');
    expect(t.approver.name).toBe('Jimmy');
    expect(exists('.claude/skills/clientx-org/SKILL.md')).toBe(true);
    expect(exists(STORY_PATH)).toBe(true);
    expect(r.out).toContain('ask the Architect to run T-000 to fill clientx-org');
    expect(r.out).not.toMatch(/Warning: the org knowledge skill/);
    // The template's sandbox list is empty, so a first install preselects and removes nothing.
    expect(r.out).not.toContain('[selected]');
    expect(r.out).not.toContain('Removed from orgs.sandbox');
  });

  test('a bad selection is asked again', async () => {
    const r = await cli(['--target', target], ['y', '', '9', '1', '']);
    expect(r.out).toContain('Please answer with numbers from the list.');
    expect(team().orgs.sandbox).toEqual(['dev']);
  });
});

describe('registry and prompts', () => {
  test('an unwritable registry only warns; install and setup still complete', async () => {
    fs.writeFileSync(path.join(home, '.salesforce-team-kit'), 'a file, not a folder');
    const r = await cli(['--target', target, '--yes']);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Warning: could not update ~/.salesforce-team-kit/projects.json (");
    expect(r.out).toContain("--update-all won't include this project.");
    expect(r.out).toContain('Org setup done');
  });

  test('announces the lookups', async () => {
    const r = await cli(['--target', target], ['y', '', '', '']);
    expect(r.out).toContain('Looking up 3 alias(es)…');
  });

  test('Enter drops a listed alias whose lookup now fails, and says so', async () => {
    await cli(['--target', target, '--yes']);
    const t = team();
    t.orgs.sandbox = ['dev', 'uat'];
    fs.writeFileSync(path.join(target, '.team', 'team.json'), JSON.stringify(t));
    delete URLS.uat;
    try {
      const r = await cli(['--target', target, '--setup'], ['', '', '']);
      expect(r.out).toContain('Removed from orgs.sandbox: uat (could not look up)');
      expect(team().orgs.sandbox).toEqual(['dev']);
    } finally {
      URLS.uat = 'https://acme--uat.sandbox.my.salesforce.com';
    }
  });

  test('--setup skips a team.json that is a symlink', async () => {
    await cli(['--target', target, '--yes']);
    const real = path.join(root, 'real-team.json');
    const f = path.join(target, '.team', 'team.json');
    fs.renameSync(f, real);
    fs.symlinkSync(real, f);
    const before = fs.readFileSync(real, 'utf8');
    const r = await cli(['--target', target, '--yes', '--setup']);
    expect(r.out).toContain('Skipped setup: .team/team.json is a symlink.');
    expect(r.out).not.toContain('Org setup done');
    expect(fs.readFileSync(real, 'utf8')).toBe(before);
  });
});

describe('--yes', () => {
  test('first install: no lookups, no sandboxes, default skill, hint printed', async () => {
    const r = await cli(['--target', target, '--yes']);
    expect(r.code).toBe(0);
    expect(lookups).toEqual([]);
    expect(team().orgs.sandbox).toEqual([]);
    expect(team().orgSkill).toBe('client-x-org');
    expect(r.out).toContain(`Run node install.mjs --target ${target} --setup to choose them.`);
    expect(exists('.claude/skills/client-x-org/SKILL.md')).toBe(true);
  });

  test('--yes --setup keeps the list and never overwrites the skeleton or story', async () => {
    await cli(['--target', target, '--yes']);
    const t = team();
    t.orgs.sandbox = ['uat'];
    fs.writeFileSync(path.join(target, '.team', 'team.json'), JSON.stringify(t));
    fs.writeFileSync(path.join(target, '.claude/skills/client-x-org/SKILL.md'), 'mine');
    fs.writeFileSync(path.join(target, STORY_PATH), 'mine too');
    const r = await cli(['--target', target, '--yes', '--setup']);
    expect(r.code).toBe(0);
    expect(team().orgs.sandbox).toEqual(['uat']);
    expect(fs.readFileSync(path.join(target, '.claude/skills/client-x-org/SKILL.md'), 'utf8')).toBe('mine');
    expect(fs.readFileSync(path.join(target, STORY_PATH), 'utf8')).toBe('mine too');
  });
});

describe('re-runs and uninstall', () => {
  test('a plain re-run does not run setup', async () => {
    await cli(['--target', target, '--yes']);
    const r = await cli(['--target', target]);
    expect(r.out).not.toContain('Sandboxes found');
  });

  test('--setup on an up-to-date project still runs setup and preselects listed sandboxes', async () => {
    await cli(['--target', target, '--yes']);
    const t = team();
    t.orgs.sandbox = ['dev'];
    fs.writeFileSync(path.join(target, '.team', 'team.json'), JSON.stringify(t));
    const r = await cli(['--target', target, '--setup'], ['', '', '']);
    expect(r.out).toContain('1) dev  (acme--dev.sandbox.my.salesforce.com) [selected]');
    expect(team().orgs.sandbox).toEqual(['dev']);
  });

  test('uninstall keeps the skeleton and the story', async () => {
    await cli(['--target', target, '--yes']);
    await cli(['--target', target, '--uninstall', '--yes']);
    expect(exists('.claude/skills/client-x-org/SKILL.md')).toBe(true);
    expect(exists(STORY_PATH)).toBe(true);
  });

  test('--setup with --uninstall is a usage error', async () => {
    const r = await cli(['--target', target, '--setup', '--uninstall']);
    expect(r.code).toBe(1);
  });
});

describe('review fixes', () => {
  test('a first --yes install ignores an existing org skill and writes the skeleton', async () => {
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'my-org-knowledge'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'skills', 'my-org-knowledge', 'SKILL.md'), '---\nname: my-org-knowledge\n---\n');
    const r = await cli(['--target', target, '--yes']);
    expect(r.code).toBe(0);
    expect(team().orgSkill).toBe('client-x-org');
    expect(exists('.claude/skills/client-x-org/SKILL.md')).toBe(true);
  });

  test('malformed team.json fails setup cleanly', async () => {
    await cli(['--target', target, '--yes']);
    fs.writeFileSync(path.join(target, '.team', 'team.json'), '{bad');
    const r = await cli(['--target', target, '--yes', '--setup']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('.team/team.json is not valid JSON; fix it, then re-run with --setup.');
  });
});
