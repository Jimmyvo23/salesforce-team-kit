import { test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from '../install.mjs';
import { readRegistry, addProject, REGISTRY } from '../lib/install/registry.mjs';

let root, home, a, b;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sftk-all-')));
  home = path.join(root, 'home');
  a = path.join(root, 'a');
  b = path.join(root, 'b');
  for (const d of [a, b]) { fs.mkdirSync(d); spawnSync('git', ['init', '-q'], { cwd: d }); }
  fs.mkdirSync(path.join(home, '.claude', 'plugins', 'cache', 'superpowers-marketplace', 'superpowers'), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

async function cli(args) {
  let out = '';
  const code = await main(args, {
    cwd: root, homeDir: home, nodeVersion: 'v24.1.0',
    hasCommand: () => true, gitInit: () => true,
    stdout: (s) => { out += s; }, stderr: (s) => { out += s; },
    ask: async (q) => { throw new Error(`unexpected question: ${q}`); },
    lookupInstanceUrl: () => null,
  });
  return { code, out };
}

test('install registers, uninstall unregisters', async () => {
  await cli(['--target', a, '--yes']);
  expect(readRegistry(home)).toEqual([a]);
  await cli(['--target', a, '--uninstall', '--yes']);
  expect(readRegistry(home)).toEqual([]);
});

test('updates every project, drops a missing one, never runs setup', async () => {
  await cli(['--target', a, '--yes']);
  await cli(['--target', b, '--yes']);
  const teamA = fs.readFileSync(path.join(a, '.team', 'team.json'), 'utf8');
  const gone = path.join(root, 'gone');
  addProject(home, gone);
  fs.rmSync(path.join(b, '.team', 'bin', 'team-status.mjs'));
  const r = await cli(['--update-all', '--yes']);
  expect(r.code).toBe(0);
  expect(r.out).toContain(`${a}: up to date`);
  expect(r.out).toContain(`${b}: updated`);
  expect(r.out).toContain(`skipped ${gone}: not installed any more`);
  expect(r.out).not.toContain('Sandboxes found');
  expect(r.out).not.toContain('Org setup done');
  expect(fs.readFileSync(path.join(a, '.team', 'team.json'), 'utf8')).toBe(teamA);
  expect(readRegistry(home)).toEqual([a, b]);
});

test('a project without a manifest is skipped and dropped', async () => {
  await cli(['--target', a, '--yes']);
  fs.rmSync(path.join(a, '.team', 'kit-manifest.json'));
  const r = await cli(['--update-all', '--yes']);
  expect(r.out).toContain(`skipped ${a}: not installed any more`);
  expect(readRegistry(home)).toEqual([]);
});

test('one failure is reported, the rest still run, exit 1', async () => {
  await cli(['--target', a, '--yes']);
  await cli(['--target', b, '--yes']);
  fs.writeFileSync(path.join(a, '.team', 'kit-manifest.json'), '{broken');
  const r = await cli(['--update-all', '--yes']);
  expect(r.code).toBe(1);
  expect(r.out).toMatch(new RegExp(`${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: failed: `));
  expect(r.out).toContain(`${b}: up to date`);
});

test('empty registry and flag conflicts', async () => {
  expect((await cli(['--update-all'])).out).toContain('No projects registered yet.');
  expect((await cli(['--update-all', '--target', a])).code).toBe(1);
  expect((await cli(['--update-all', '--uninstall'])).code).toBe(1);
  expect((await cli(['--update-all', '--setup'])).code).toBe(1);
});

test('an exception in one project is reported and the rest still run', async () => {
  await cli(['--target', a, '--yes']);
  await cli(['--target', b, '--yes']);
  // a read-only registry makes addProject throw inside every project's install
  const reg = path.join(home, REGISTRY);
  fs.chmodSync(reg, 0o444);
  try {
    const r = await cli(['--update-all', '--yes']);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`${a}: failed: `);
    expect(r.out).toContain(`${b}: failed: `);
  } finally {
    fs.chmodSync(reg, 0o644);
  }
});

test('a customised kit file is kept and counted', async () => {
  await cli(['--target', a, '--yes']);
  fs.appendFileSync(path.join(a, '.claude', 'agents', 'qa.md'), '\nmy edit\n');
  const r = await cli(['--update-all', '--yes']);
  expect(r.code).toBe(0);
  expect(r.out).toContain(`${a}: kept 1 customised file`);
});
