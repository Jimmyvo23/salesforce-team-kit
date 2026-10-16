import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planInstall, planUninstall, applyChanges } from '../lib/install/plan.mjs';
import { main, formatDiff } from '../install.mjs';

const KIT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/hooks/subagent-start.json', import.meta.url));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const KIT_FILES = [
  '.claude/agents/admin.md',
  '.claude/agents/analyst.md',
  '.claude/agents/developer.md',
  '.claude/agents/qa.md',
  '.claude/agents/reviewer.md',
  '.team/bin/cli/team-status.mjs',
  '.team/bin/hooks/guard-org.mjs',
  '.team/bin/hooks/record.mjs',
  '.team/bin/lib/events.mjs',
  '.team/bin/lib/guard.mjs',
  '.team/bin/lib/paths.mjs',
  '.team/bin/lib/team.mjs',
  '.team/bin/team-status.mjs',
  '.team/changeset-template.md',
  '.team/handoffs/handoff-template.md',
  '.team/planner.md',
  '.team/work-order-template.md',
];
const EXECUTABLES = ['.team/bin/cli/team-status.mjs', '.team/bin/hooks/guard-org.mjs', '.team/bin/hooks/record.mjs', '.team/bin/team-status.mjs'];

let root, target, home;
/** Environment for spawned children, without any CLAUDE_PROJECT_DIR inherited from the test runner. */
const cleanEnv = () => {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  return env;
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atk install '));
  target = path.join(root, 'my project');
  home = path.join(root, 'home dir');
  fs.mkdirSync(target, { recursive: true });
  const git = spawnSync('git', ['init', '-q'], { cwd: target, encoding: 'utf8' });
  expect(git.status).toBe(0);
  fs.mkdirSync(path.join(home, '.claude', 'plugins', 'cache', 'superpowers-marketplace', 'superpowers'), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const p = (rel) => path.join(target, rel);
const read = (rel) => fs.readFileSync(p(rel), 'utf8');
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(p(rel)), { recursive: true });
  fs.writeFileSync(p(rel), text);
};
const exists = (rel) => fs.existsSync(p(rel));

/** Every file under dir (excluding .git) as relpath -> content. */
function snapshot(dir = target) {
  /** @type {Record<string, string>} */
  const out = {};
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      const rel = path.relative(dir, full).split(path.sep).join('/');
      if (rel === '.git') continue;
      if (ent.isSymbolicLink()) out[rel] = `symlink -> ${fs.readlinkSync(full)}`;
      else if (ent.isDirectory()) walk(full);
      else out[rel] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return out;
}

/**
 * Run the installer CLI in-process.
 * @param {string[]} args
 * @param {{ answers?: string[], cwd?: string, homeDir?: string, hasCommand?: (c: string, a: string[]) => boolean }} [o]
 */
async function cli(args, o = {}) {
  const answers = [...(o.answers ?? [])];
  const questions = [];
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd: o.cwd ?? root,
    homeDir: o.homeDir ?? home,
    nodeVersion: 'v24.1.0',
    hasCommand: o.hasCommand ?? (() => true),
    gitInit: (dir) => spawnSync('git', ['init', '-q'], { cwd: dir }).status === 0,
    stdout: (s) => { out += s; },
    stderr: (s) => { err += s; },
    ask: async (q) => {
      questions.push(q);
      if (answers.length === 0) throw new Error(`unexpected question: ${q}`);
      return answers.shift();
    },
  });
  return { code, out, err, questions };
}
const install = (extra = []) => cli(['--target', target, '--yes', ...extra]);
const uninstall = () => cli(['--target', target, '--uninstall', '--yes']);

describe('install', () => {
  test('fresh install creates expected files and CLAUDE.md section', async () => {
    const r = await install();
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    for (const f of KIT_FILES) expect(exists(f), f).toBe(true);
    expect(read('.claude/agents/admin.md')).toBe(fs.readFileSync(path.join(KIT, 'agents/admin.md'), 'utf8'));
    expect(read('.team/bin/lib/events.mjs')).toBe(fs.readFileSync(path.join(KIT, 'lib/events.mjs'), 'utf8'));
    expect(exists('.team/bin/lib/state.mjs')).toBe(false);
    for (const f of EXECUTABLES) expect(fs.statSync(p(f)).mode & 0o111, f).not.toBe(0);

    const md = read('CLAUDE.md');
    expect(md).toContain('<!-- agent-team-kit:start -->\n## Team');
    expect(md).toContain('<!-- agent-team-kit:end -->');
    expect(read('.gitignore')).toBe('# agent-team-kit:start\n.team/events*.jsonl\n.team/org-cache.json\nagent-status.json\n.superpowers/\n.claude/settings.json.bak\n.sf/\n.sfdx/\n# agent-team-kit:end\n');

    const settings = JSON.parse(read('.claude/settings.json'));
    expect(Object.keys(settings.hooks).sort()).toEqual(['PostToolUse', 'PreToolUse', 'Stop', 'SubagentStart', 'SubagentStop']);
    expect(settings.hooks.SubagentStart[0].hooks[0].command).toBe('node "$CLAUDE_PROJECT_DIR/.team/bin/hooks/record.mjs" agent-start');
    expect(exists('.claude/settings.json.bak')).toBe(false);

    const team = JSON.parse(read('.team/team.json'));
    expect(team.project).toBe('my project');
    expect(team.members.map((m) => m.id)).toEqual(['planner', 'analyst', 'admin', 'developer', 'qa', 'reviewer']);

    const manifest = JSON.parse(read('.team/kit-manifest.json'));
    expect(manifest.version).toBe(JSON.parse(fs.readFileSync(path.join(KIT, 'package.json'), 'utf8')).version);
    expect(Object.keys(manifest.files).sort()).toEqual(KIT_FILES);
    for (const f of KIT_FILES) expect(manifest.files[f]).toBe(sha(read(f)));
    expect([...manifest.created].sort()).toEqual(['.claude/settings.json', '.gitignore', 'CLAUDE.md']);

    expect(r.out).toMatch(/^ {2}create +\.claude\/agents\/admin\.md$/m);
  });

  test('a relative --target is resolved against cwd', async () => {
    const r = await cli(['--target', 'my project', '--yes'], { cwd: root });
    expect(r.code).toBe(0);
    expect(exists('.team/kit-manifest.json')).toBe(true);
  });

  test('--target is required', async () => {
    const r = await cli([]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/--target/);
  });

  test('failed checks exit 1 with the problems and change nothing', async () => {
    const before = snapshot();
    const r = await cli(['--target', target, '--yes'], { homeDir: path.join(root, 'empty home') });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Superpowers/);
    expect(snapshot()).toEqual(before);
  });

  test('second install reports every change as unchanged', async () => {
    write('CLAUDE.md', '# Mine\n');
    write('.claude/settings.json', '{\n  "model": "opus"\n}\n');
    await install();
    const plan = planInstall({ kitDir: KIT, targetDir: target });
    expect(plan.filter((c) => c.action !== 'unchanged')).toEqual([]);
    expect(plan.map((c) => c.path)).toContain('.team/kit-manifest.json');

    const before = snapshot();
    const r = await cli(['--target', target]);
    expect(r.code).toBe(0);
    expect(r.questions).toEqual([]);
    expect(r.out).toMatch(/Nothing to do/);
    expect(snapshot()).toEqual(before);
  });

  test('customized agent is a conflict and is kept when resolveConflict returns false', async () => {
    await install();
    const original = read('.claude/agents/admin.md');
    const manifestBefore = read('.team/kit-manifest.json');
    write('.claude/agents/admin.md', `${original}\nMy own rule.\n`);

    const plan = planInstall({ kitDir: KIT, targetDir: target });
    const conflict = plan.find((c) => c.path === '.claude/agents/admin.md');
    expect(conflict.action).toBe('conflict');
    expect(plan.filter((c) => c.action !== 'unchanged' && c.path !== '.claude/agents/admin.md')).toEqual([]);

    const seen = [];
    applyChanges(plan, { targetDir: target, resolveConflict: (c) => { seen.push(c.path); return false; } });
    expect(seen).toEqual(['.claude/agents/admin.md']);
    expect(read('.claude/agents/admin.md')).toBe(`${original}\nMy own rule.\n`);
    expect(read('.team/kit-manifest.json')).toBe(manifestBefore);

    applyChanges(planInstall({ kitDir: KIT, targetDir: target }), { targetDir: target, resolveConflict: () => true });
    expect(read('.claude/agents/admin.md')).toBe(original);
  });

  test('a kit file updated since the last install is an update, not a conflict', async () => {
    await install();
    const manifest = JSON.parse(read('.team/kit-manifest.json'));
    const old = 'old kit version\n';
    write('.team/planner.md', old);
    manifest.files['.team/planner.md'] = sha(old);
    write('.team/kit-manifest.json', JSON.stringify(manifest, null, 2));
    const plan = planInstall({ kitDir: KIT, targetDir: target });
    expect(plan.find((c) => c.path === '.team/planner.md').action).toBe('update');
    expect(plan.find((c) => c.path === '.team/kit-manifest.json').action).toBe('update');
  });

  test('an existing file the kit never wrote is a conflict', async () => {
    write('.claude/agents/admin.md', 'my own backend agent\n');
    const plan = planInstall({ kitDir: KIT, targetDir: target });
    expect(plan.find((c) => c.path === '.claude/agents/admin.md').action).toBe('conflict');
    applyChanges(plan, { targetDir: target, resolveConflict: () => false });
    expect(read('.claude/agents/admin.md')).toBe('my own backend agent\n');
    expect(JSON.parse(read('.team/kit-manifest.json')).files['.claude/agents/admin.md']).toBeUndefined();
  });

  test('re-install after editing an agent: y replaces, n keeps, --yes keeps', async () => {
    await install();
    const original = read('.claude/agents/admin.md');
    const custom = `${original}extra line one\nextra line two\n`;
    const rel = '.claude/agents/admin.md';

    write(rel, custom);
    let r = await cli(['--target', target], { answers: ['y', 'n'] });
    expect(r.code).toBe(0);
    expect(r.questions).toEqual(['Apply these changes? (y/n)', `Replace your customised ${rel}? (y/n)`]);
    expect(r.out).toMatch(/2 lines added, 0 removed/);
    expect(r.out).toMatch(/^ {2}\+extra line one$/m);
    expect(r.out).toMatch(/^ {2}\+extra line two$/m);
    expect(read(rel)).toBe(custom);

    r = await cli(['--target', target, '--yes']);
    expect(r.code).toBe(0);
    expect(r.questions).toEqual([]);
    expect(r.out).toMatch(/[Kk]ept/);
    expect(read(rel)).toBe(custom);

    r = await cli(['--target', target], { answers: ['y', 'y'] });
    expect(r.code).toBe(0);
    expect(read(rel)).toBe(original);
  });

  test('existing user hook survives install and uninstall', async () => {
    const userSettings = {
      model: 'opus',
      hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user' }] }] },
    };
    const text = `${JSON.stringify(userSettings, null, 2)}\n`;
    write('.claude/settings.json', text);
    expect((await install()).code).toBe(0);

    const merged = JSON.parse(read('.claude/settings.json'));
    expect(merged.model).toBe('opus');
    expect(merged.hooks.PostToolUse[0]).toEqual(userSettings.hooks.PostToolUse[0]);
    expect(merged.hooks.PostToolUse).toHaveLength(2);
    expect(read('.claude/settings.json.bak')).toBe(text);
    expect(JSON.parse(read('.team/kit-manifest.json')).created).not.toContain('.claude/settings.json');

    expect((await uninstall()).code).toBe(0);
    expect(read('.claude/settings.json')).toBe(text);
  });

  test('invalid settings.json aborts with message and changes nothing', async () => {
    write('.claude/settings.json', '{ "hooks": ');
    const before = snapshot();
    const r = await install();
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/settings\.json is not valid JSON/);
    expect(snapshot()).toEqual(before);
    expect(() => planInstall({ kitDir: KIT, targetDir: target })).toThrow(/not valid JSON/);
  });

  test('a malformed user hooks block is refused and nothing changes', async () => {
    write('.claude/settings.json', '{ "hooks": { "PostToolUse": { "matcher": "Bash" } } }\n');
    const before = snapshot();
    const r = await install();
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/hooks\.PostToolUse/);
    expect(snapshot()).toEqual(before);
  });

  test('settings.json with a UTF-8 BOM is accepted', async () => {
    write('.claude/settings.json', '﻿{ "model": "opus" }\n');
    const r = await install();
    expect(r.code).toBe(0);
    const s = JSON.parse(read('.claude/settings.json'));
    expect(s.model).toBe('opus');
    expect(s.hooks.SubagentStop).toHaveLength(1);
  });

  test('half a marked block in CLAUDE.md aborts and changes nothing', async () => {
    write('CLAUDE.md', '# Mine\n<!-- agent-team-kit:start -->\nstuff\n');
    const before = snapshot();
    const r = await install();
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/no matching end marker/);
    expect(snapshot()).toEqual(before);
  });

  test('existing team.json is never touched', async () => {
    write('.team/team.json', '{"project":"Mine"}\n');
    await install();
    expect(read('.team/team.json')).toBe('{"project":"Mine"}\n');
  });

  test('--yes skips the prompt; without it, answering n changes nothing', async () => {
    const before = snapshot();
    const r = await cli(['--target', target], { answers: ['n'] });
    expect(r.code).toBe(0);
    expect(r.questions).toEqual(['Apply these changes? (y/n)']);
    expect(r.out).toMatch(/^ {2}create +\.claude\/agents\/admin\.md$/m);
    expect(snapshot()).toEqual(before);

    const r2 = await install();
    expect(r2.questions).toEqual([]);
    expect(exists('.team/kit-manifest.json')).toBe(true);
  });
});

describe('installed scripts', () => {
  const lastEvent = () => {
    const lines = read('.team/events.jsonl').trim().split('\n');
    return JSON.parse(lines[lines.length - 1]);
  };

  test('installed team-status runs from the target and appends an event', async () => {
    await install();
    const r = spawnSync(process.execPath, ['.team/bin/team-status.mjs', 'status', '--agent', 'developer', '--status', 'working'], {
      cwd: target, env: cleanEnv(), encoding: 'utf8',
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(lastEvent()).toMatchObject({ type: 'status', agent: 'developer', status: 'working', source: 'cli' });
  });

  test('installed team-status warns about an id not in team.json and still writes', async () => {
    await install();
    const r = spawnSync(process.execPath, ['.team/bin/team-status.mjs', 'status', '--agent', 'bakend', '--status', 'working'], {
      cwd: target, env: cleanEnv(), encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/^Warning: "bakend"/);
    expect(lastEvent()).toMatchObject({ agent: 'bakend' });
  });

  test('the shim works from a nested cwd and via CLAUDE_PROJECT_DIR', async () => {
    await install();
    const nested = p('src/deep dir');
    fs.mkdirSync(nested, { recursive: true });
    const shim = p('.team/bin/team-status.mjs');
    let r = spawnSync(process.execPath, [shim, 'status', '--agent', 'tester', '--status', 'idle'], { cwd: nested, env: cleanEnv(), encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(lastEvent()).toMatchObject({ agent: 'tester', status: 'idle' });

    r = spawnSync(process.execPath, [shim, 'status', '--agent', 'reviewer', '--status', 'done'], {
      cwd: root, env: { ...cleanEnv(), CLAUDE_PROJECT_DIR: target }, encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(lastEvent()).toMatchObject({ agent: 'reviewer', status: 'done' });
  });

  test('installed hook record.mjs appends an event for fixture input', async () => {
    await install();
    const r = spawnSync(process.execPath, [p('.team/bin/hooks/record.mjs'), 'agent-start'], {
      cwd: root, env: { ...cleanEnv(), CLAUDE_PROJECT_DIR: target }, input: fs.readFileSync(FIXTURE), encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(lastEvent()).toMatchObject({ type: 'agent_start', agent: 'spike-helper', source: 'hook' });
  });
});

describe('uninstall', () => {
  const ignoredAfter = (rel) => rel === '.team/team.json' || rel.startsWith('.team/handoffs/') || rel === '.claude/settings.json.bak';

  test('uninstall leaves the repo as before except team.json and handoffs', async () => {
    write('CLAUDE.md', '# My project\n\nSome rules.\n');
    write('.gitignore', 'node_modules/\n.env*\n');
    write('.claude/settings.json', `${JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] } }, null, 2)}\n`);
    write('.claude/agents/designer.md', 'my own agent\n');
    write('src/index.js', 'console.log(1);\n');
    const before = snapshot();

    expect((await install()).code).toBe(0);
    write('.team/handoffs/T-001.md', 'a handoff\n');
    const r = await uninstall();
    expect(r.err).toBe('');
    expect(r.code).toBe(0);

    const after = snapshot();
    expect(Object.fromEntries(Object.entries(after).filter(([k]) => !ignoredAfter(k)))).toEqual(before);
    expect(exists('.team/team.json')).toBe(true);
    expect(read('.team/handoffs/T-001.md')).toBe('a handoff\n');
    expect(exists('.team/handoffs/handoff-template.md')).toBe(false);
    expect(exists('.team/kit-manifest.json')).toBe(false);
    expect(exists('.team/bin')).toBe(false);
  });

  test('uninstall from an empty repo removes files the kit created', async () => {
    await install();
    const r = await uninstall();
    expect(r.code).toBe(0);
    expect(exists('CLAUDE.md')).toBe(false);
    expect(exists('.gitignore')).toBe(false);
    expect(exists('.claude')).toBe(false);
    expect(exists('.team/bin')).toBe(false);
    expect(Object.keys(snapshot())).toEqual(['.team/team.json']);
    expect(fs.readdirSync(p('.team/handoffs'))).toEqual([]);
  });

  test('uninstall keeps files the user added next to kit content', async () => {
    await install();
    fs.appendFileSync(p('CLAUDE.md'), '\nMy own notes.\n');
    write('.claude/agents/designer.md', 'mine\n');
    await uninstall();
    expect(read('CLAUDE.md').trim()).toBe('My own notes.');
    expect(read('.claude/agents/designer.md')).toBe('mine\n');
    expect(exists('.claude/settings.json')).toBe(false);
  });

  test('a customised kit file is a conflict on uninstall; --yes keeps it', async () => {
    await install();
    write('.claude/agents/admin.md', 'customised\n');
    const plan = planUninstall({ targetDir: target });
    expect(plan.find((c) => c.path === '.claude/agents/admin.md').action).toBe('conflict');
    const r = await uninstall();
    expect(r.code).toBe(0);
    expect(read('.claude/agents/admin.md')).toBe('customised\n');
    expect(exists('.claude/agents/analyst.md')).toBe(false);
  });

  test('uninstall with only a CLAUDE.md block and no .team folder works', async () => {
    write('CLAUDE.md', '# Mine\n\n<!-- agent-team-kit:start -->\nold\n<!-- agent-team-kit:end -->\n');
    const r = await uninstall();
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(read('CLAUDE.md')).toBe('# Mine\n');
  });

  test('uninstall with nothing installed has nothing to do', async () => {
    write('README.md', 'hi\n');
    const r = await uninstall();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Nothing to do/);
  });
});

describe('fix round 1: safety', () => {
  test('uninstall ignores manifest entries outside the kit file set', async () => {
    await install();
    const outside = path.join(root, 'out side');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'victim.txt'), '');
    const absVictim = path.join(root, 'abs victim.txt');
    fs.writeFileSync(absVictim, '');
    write('notes.txt', '');
    const m = JSON.parse(read('.team/kit-manifest.json'));
    m.files['../out side/victim.txt'] = sha('');
    m.files[absVictim] = sha('');
    m.files['notes.txt'] = sha('');
    m.created.push('src/index.js', '../out side/victim.txt');
    write('.team/kit-manifest.json', JSON.stringify(m, null, 2));

    const plan = planUninstall({ targetDir: target });
    expect(plan.map((c) => c.path).filter((x) => x.includes('victim') || x === 'notes.txt')).toEqual([]);
    const r = await uninstall();
    expect(r.code).toBe(0);
    expect(fs.existsSync(path.join(outside, 'victim.txt'))).toBe(true);
    expect(fs.existsSync(absVictim)).toBe(true);
    expect(exists('notes.txt')).toBe(true);
  });

  test('uninstall keeps directories that existed before the first install', async () => {
    fs.mkdirSync(p('.claude/agents'), { recursive: true });
    await install();
    await install();
    expect(JSON.parse(read('.team/kit-manifest.json')).createdDirs).not.toContain('.claude/agents');
    await uninstall();
    expect(fs.statSync(p('.claude/agents')).isDirectory()).toBe(true);
    expect(exists('.team/bin')).toBe(false);
  });

  test('re-install keeps the original settings.json.bak', async () => {
    const original = '{\n  "model": "opus"\n}\n';
    write('.claude/settings.json', original);
    await install();
    expect(read('.claude/settings.json.bak')).toBe(original);
    write('.claude/settings.json', '{\n  "model": "sonnet"\n}\n');
    const plan = planInstall({ kitDir: KIT, targetDir: target });
    expect(plan.find((c) => c.path === '.claude/settings.json').action).toBe('update');
    expect(plan.find((c) => c.path === '.claude/settings.json.bak')).toBeUndefined();
    await install();
    expect(read('.claude/settings.json.bak')).toBe(original);
  });

  test('a dangling symlink destination is a conflict and is never written through', async () => {
    const evil = path.join(root, 'outside', 'evil.md');
    fs.mkdirSync(p('.claude/agents'), { recursive: true });
    fs.symlinkSync(evil, p('.claude/agents/admin.md'));
    const plan = planInstall({ kitDir: KIT, targetDir: target });
    const c = plan.find((x) => x.path === '.claude/agents/admin.md');
    expect(c).toMatchObject({ action: 'conflict', reason: 'is a symlink' });
    applyChanges(plan, { targetDir: target, resolveConflict: () => true });
    expect(fs.existsSync(evil)).toBe(false);
    expect(fs.lstatSync(p('.claude/agents/admin.md')).isSymbolicLink()).toBe(true);
    expect(JSON.parse(read('.team/kit-manifest.json')).files['.claude/agents/admin.md']).toBeUndefined();

    const r = await cli(['--target', target], { answers: ['y'] });
    expect(r.code).toBe(0);
    expect(r.questions).toEqual(['Apply these changes? (y/n)']);
    expect(r.out).toMatch(/symlink/);
    expect(fs.existsSync(evil)).toBe(false);
  });

  test('uninstall says events.jsonl was kept and is no longer git-ignored', async () => {
    await install();
    write('.team/events.jsonl', '{}\n');
    const r = await uninstall();
    expect(r.out).toMatch(/\.team\/events\.jsonl.*no longer git-ignored/);
    expect(exists('.team/events.jsonl')).toBe(true);
  });
});

describe('fix round 2: refusals and path guards', () => {
  for (const rel of ['.team', '.team/bin', '.team/kit-manifest.json', '.claude', '.claude/settings.json']) {
    test(`a symlinked ${rel} refuses the whole install and changes nothing`, async () => {
      const elsewhere = path.join(root, 'elsewhere');
      fs.mkdirSync(elsewhere);
      fs.mkdirSync(path.dirname(p(rel)), { recursive: true });
      fs.symlinkSync(rel.endsWith('.json') ? path.join(elsewhere, 'x.json') : elsewhere, p(rel));
      const before = snapshot();
      const r = await install();
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/symlink/);
      expect(r.err).toContain(rel);
      expect(snapshot()).toEqual(before);
      expect(fs.readdirSync(elsewhere)).toEqual([]);
      expect(() => planInstall({ kitDir: KIT, targetDir: target })).toThrow(/symlink/);
    });
  }

  test('applyChanges refuses paths outside the target and writes nothing', () => {
    const outside = path.join(root, 'out side');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'victim.txt'), 'keep me');
    const bad = [
      [{ path: '../out side/victim.txt', action: 'delete' }],
      [{ path: '../out side/victim.txt', action: 'update', content: 'x' }],
      [{ path: path.join(outside, 'victim.txt'), action: 'delete' }],
      [{ path: 'a/../../out side/victim.txt', action: 'delete' }],
      [{ path: 'ok.txt', action: 'create', content: 'x' }, { path: '../out side/victim.txt', action: 'delete' }],
    ];
    for (const changes of bad) {
      expect(() => applyChanges(changes, { targetDir: target, resolveConflict: () => true })).toThrow(/outside/);
    }
    expect(fs.readFileSync(path.join(outside, 'victim.txt'), 'utf8')).toBe('keep me');
    expect(exists('ok.txt')).toBe(false);
    expect(() => applyChanges([{ path: '.team/kit-manifest.json', action: 'delete', pruneDirs: ['../out side'] }],
      { targetDir: target, resolveConflict: () => true })).toThrow(/outside/);
  });

  test('a symlinked CLAUDE.md is a conflict only when a change is needed', async () => {
    write('AGENTS.md', '# Agents\n');
    fs.symlinkSync('AGENTS.md', p('CLAUDE.md'));
    let r = await uninstall();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Nothing to do/);

    const plan = planInstall({ kitDir: KIT, targetDir: target });
    expect(plan.find((c) => c.path === 'CLAUDE.md')).toMatchObject({ action: 'conflict', reason: 'is a symlink' });
    await install();
    expect(read('AGENTS.md')).toBe('# Agents\n');

    // The user adds the block themselves: now nothing is needed on install.
    write('AGENTS.md', `# Agents\n\n<!-- agent-team-kit:start -->\n${fs.readFileSync(path.join(KIT, 'templates/claude-team-section.md'), 'utf8').trimEnd()}\n<!-- agent-team-kit:end -->\n`);
    expect(planInstall({ kitDir: KIT, targetDir: target }).find((c) => c.path === 'CLAUDE.md').action).toBe('unchanged');
    r = await cli(['--target', target]);
    expect(r.out).toMatch(/Nothing to do/);
    expect(planUninstall({ targetDir: target }).find((c) => c.path === 'CLAUDE.md')).toMatchObject({ action: 'conflict', symlink: true });
  });

  test('a symlinked .gitignore that needs no change is unchanged', async () => {
    write('shared-ignore', 'node_modules/\n');
    fs.symlinkSync('shared-ignore', p('.gitignore'));
    expect((await uninstall()).out).toMatch(/Nothing to do/);
    expect(planInstall({ kitDir: KIT, targetDir: target }).find((c) => c.path === '.gitignore').action).toBe('conflict');
  });
});

describe('obsolete kit files', () => {
  /** Pretend an older kit installed `rel` with `text`. */
  const plantOld = (rel, text) => {
    write(rel, text);
    const m = JSON.parse(read('.team/kit-manifest.json'));
    m.files[rel] = sha(text);
    write('.team/kit-manifest.json', JSON.stringify(m, null, 2));
  };

  test('update deletes an untouched file the kit no longer ships and drops it from the manifest', async () => {
    await install();
    plantOld('.team/bin/lib/old-helper.mjs', 'old\n');
    plantOld('.claude/agents/designer.md', 'old agent\n');
    const plan = planInstall({ kitDir: KIT, targetDir: target });
    expect(plan.find((c) => c.path === '.team/bin/lib/old-helper.mjs')).toMatchObject({ action: 'delete' });
    expect(plan.find((c) => c.path === '.claude/agents/designer.md')).toMatchObject({ action: 'delete' });
    const r = await install();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^ {2}delete +\.team\/bin\/lib\/old-helper\.mjs$/m);
    expect(exists('.team/bin/lib/old-helper.mjs')).toBe(false);
    expect(exists('.claude/agents/designer.md')).toBe(false);
    const files = JSON.parse(read('.team/kit-manifest.json')).files;
    expect(Object.keys(files).sort()).toEqual(KIT_FILES);
  });

  test('a customised obsolete file is a conflict: y deletes, n and --yes keep', async () => {
    await install();
    plantOld('.team/bin/lib/old-helper.mjs', 'old\n');
    write('.team/bin/lib/old-helper.mjs', 'my change\n');
    const plan = planInstall({ kitDir: KIT, targetDir: target });
    const c = plan.find((x) => x.path === '.team/bin/lib/old-helper.mjs');
    expect(c).toMatchObject({ action: 'conflict' });
    expect(c.content).toBeUndefined();
    let r = await install();
    expect(read('.team/bin/lib/old-helper.mjs')).toBe('my change\n');
    r = await cli(['--target', target], { answers: ['y', 'n'] });
    expect(r.questions).toEqual(['Apply these changes? (y/n)', 'Delete your customised .team/bin/lib/old-helper.mjs? (y/n)']);
    expect(read('.team/bin/lib/old-helper.mjs')).toBe('my change\n');
    r = await cli(['--target', target], { answers: ['y', 'y'] });
    expect(r.code).toBe(0);
    expect(exists('.team/bin/lib/old-helper.mjs')).toBe(false);
  });

  test('a missing obsolete file is dropped from the manifest silently', async () => {
    await install();
    plantOld('.team/bin/lib/gone.mjs', 'x\n');
    fs.rmSync(p('.team/bin/lib/gone.mjs'));
    const plan = planInstall({ kitDir: KIT, targetDir: target });
    expect(plan.find((c) => c.path === '.team/bin/lib/gone.mjs')).toBeUndefined();
    await install();
    expect(JSON.parse(read('.team/kit-manifest.json')).files['.team/bin/lib/gone.mjs']).toBeUndefined();
  });

  test('uninstall deletes an untouched obsolete file and keeps a customised one with --yes', async () => {
    await install();
    plantOld('.team/bin/hooks/old.mjs', 'old\n');
    plantOld('.claude/agents/designer.md', 'old agent\n');
    write('.claude/agents/designer.md', 'mine now\n');
    const plan = planUninstall({ targetDir: target });
    expect(plan.find((c) => c.path === '.team/bin/hooks/old.mjs')).toMatchObject({ action: 'delete' });
    expect(plan.find((c) => c.path === '.claude/agents/designer.md')).toMatchObject({ action: 'conflict' });
    expect((await uninstall()).code).toBe(0);
    expect(exists('.team/bin/hooks/old.mjs')).toBe(false);
    expect(read('.claude/agents/designer.md')).toBe('mine now\n');
  });

  test('entries outside the kit install roots stay ignored on install and uninstall', async () => {
    await install();
    for (const rel of ['src/app.ts', '.team/team.json', '.team/handoffs/T-1-admin.md', '.claude/settings.local.json', '.claude/agents/../x.md', '.team/bin/../../y.md']) {
      const m = JSON.parse(read('.team/kit-manifest.json'));
      m.files[rel] = sha('');
      write('.team/kit-manifest.json', JSON.stringify(m, null, 2));
    }
    write('src/app.ts', '');
    write('.team/handoffs/T-1-admin.md', '');
    write('.claude/settings.local.json', '');
    write('x.md', '');
    write('y.md', '');
    const touched = (plan) => plan.map((c) => c.path).filter((x) => /app\.ts|T-1-backend|settings\.local|x\.md|y\.md/.test(x));
    expect(touched(planInstall({ kitDir: KIT, targetDir: target }))).toEqual([]);
    expect(touched(planUninstall({ targetDir: target }))).toEqual([]);
    await install();
    await uninstall();
    for (const f of ['src/app.ts', '.team/handoffs/T-1-admin.md', '.claude/settings.local.json', 'x.md', 'y.md']) expect(exists(f), f).toBe(true);
  });

  test('a symlinked obsolete file is a symlink conflict and never deleted', async () => {
    await install();
    plantOld('.team/bin/lib/old.mjs', 'old\n');
    fs.rmSync(p('.team/bin/lib/old.mjs'));
    fs.writeFileSync(path.join(root, 'elsewhere.mjs'), 'old\n');
    fs.symlinkSync(path.join(root, 'elsewhere.mjs'), p('.team/bin/lib/old.mjs'));
    const plan = planInstall({ kitDir: KIT, targetDir: target });
    expect(plan.find((c) => c.path === '.team/bin/lib/old.mjs')).toMatchObject({ action: 'conflict', symlink: true });
    await install();
    expect(fs.readFileSync(path.join(root, 'elsewhere.mjs'), 'utf8')).toBe('old\n');
    expect(fs.lstatSync(p('.team/bin/lib/old.mjs')).isSymbolicLink()).toBe(true);
  });
});

describe('formatDiff', () => {
  test('shows - for the kit version, + for your copy, with a little context', () => {
    const kit = 'a\nb\nc\nd\ne\nf\ng\nh\n';
    const mine = 'a\nb\nc\nD\ne\nf\ng\nh\nextra\n';
    expect(formatDiff(kit, mine)).toEqual([' b', ' c', '-d', '+D', ' e', ' f', ' g', ' h', '+extra']);
  });
  test('marks skipped unchanged lines between far-apart changes', () => {
    const kit = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const mine = kit.replace('l1\n', 'L1\n').replace('l18', 'L18');
    const out = formatDiff(kit, mine);
    expect(out).toContain('...');
    expect(out).toEqual([' l0', '-l1', '+L1', ' l2', ' l3', '...', ' l16', ' l17', '-l18', '+L18', ' l19']);
  });
  test('identical texts give no lines', () => {
    expect(formatDiff('same\n', 'same\n')).toEqual([]);
  });
  test('caps output at 40 lines with a note of how many were left out', () => {
    const kit = Array.from({ length: 100 }, (_, i) => `k${i}`).join('\n');
    const mine = Array.from({ length: 100 }, (_, i) => `m${i}`).join('\n');
    const out = formatDiff(kit, mine);
    expect(out).toHaveLength(40);
    expect(out.at(-1)).toBe('... 161 more lines');
    expect(out.slice(0, 39).every((l) => /^[-+]/.test(l))).toBe(true);
  });
});

describe('salesforce install checks', () => {
  test('a missing sf CLI stops the install and changes nothing', async () => {
    const before = snapshot();
    const r = await cli(['--target', target, '--yes'], { hasCommand: () => false });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Salesforce CLI/);
    expect(snapshot()).toEqual(before);
  });

  test('offers git init: n stops, y runs it and installs', async () => {
    fs.rmSync(p('.git'), { recursive: true });
    const no = await cli(['--target', target], { answers: ['n'] });
    expect(no.code).toBe(1);
    expect(no.questions[0]).toMatch(/not a Git repository. Run "git init"/);
    expect(exists('.git')).toBe(false);
    const yes = await cli(['--target', target], { answers: ['y', 'y'] });
    expect(yes.code).toBe(0);
    expect(exists('.git')).toBe(true);
    expect(yes.out).toMatch(/Ran git init/);
    expect(exists('.claude/agents/admin.md')).toBe(true);
  });

  test('--yes runs git init without asking', async () => {
    fs.rmSync(p('.git'), { recursive: true });
    const r = await install();
    expect(r.code).toBe(0);
    expect(r.questions).toEqual([]);
    expect(exists('.git')).toBe(true);
  });

  test('warns when the org knowledge skill is not found, and not when it is', async () => {
    const r = await install();
    expect(r.out).toMatch(/org knowledge skill "my-org-knowledge" was not found/);
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'my-org-knowledge'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'skills', 'my-org-knowledge', 'SKILL.md'), '---\nname: my-org-knowledge\n---\n');
    const again = await install();
    expect(again.out).not.toMatch(/was not found/);
  });

  test('the checks line names the Salesforce tools', async () => {
    const r = await install();
    expect(r.out).toMatch(/Checks passed: Node, Git repository, Superpowers plugin, Salesforce CLI and Code Analyzer\./);
  });
});
