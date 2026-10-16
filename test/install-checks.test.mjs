import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPrereqs, isGitRepo, findSkill } from '../lib/install/checks.mjs';

let root, target, home;
let has;
const addPlugin = (market, name) =>
  mkdirSync(join(home, '.claude', 'plugins', 'cache', market, name), { recursive: true });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'atk checks '));
  target = join(root, 'proj dir');
  home = join(root, 'home');
  mkdirSync(join(target, '.git'), { recursive: true });
  mkdirSync(home, { recursive: true });
  addPlugin('superpowers-marketplace', 'superpowers');
  has = () => true;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const run = (over = {}) => checkPrereqs({ targetDir: target, nodeVersion: 'v24.1.0', homeDir: home, hasCommand: (c, a) => has(c, a), ...over });

describe('checkPrereqs', () => {
  it('returns [] when everything is present', () => {
    expect(run()).toEqual([]);
  });
  it('accepts a version without the v prefix and Node 20', () => {
    expect(run({ nodeVersion: '20.0.0' })).toEqual([]);
  });
  it('flags Node below 20 with one message', () => {
    const m = run({ nodeVersion: 'v18.19.0' });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatch(/Node/);
    expect(m[0]).toMatch(/20/);
  });
  it('flags missing Superpowers only', () => {
    rmSync(join(home, '.claude', 'plugins', 'cache', 'superpowers-marketplace'), { recursive: true });
    const m = run();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatch(/Superpowers/);
  });
  it('does not accept a plain file named like the plugin', () => {
    rmSync(join(home, '.claude', 'plugins', 'cache', 'superpowers-marketplace'), { recursive: true });
    mkdirSync(join(home, '.claude', 'plugins', 'cache', 'm'), { recursive: true });
    writeFileSync(join(home, '.claude', 'plugins', 'cache', 'm', 'superpowers'), '');
    expect(run()).toHaveLength(1);
  });
  it('treats a missing cache dir as Superpowers missing', () => {
    rmSync(join(home, '.claude'), { recursive: true });
    const m = run();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatch(/Superpowers/);
  });
  it('flags a missing sf CLI with the install link', () => {
    has = () => false;
    const m = run();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatch(/Salesforce CLI/);
    expect(m[0]).toMatch(/developer\.salesforce\.com/);
  });
  it('flags a missing Code Analyzer when sf is present', () => {
    has = (c, a) => !(a[0] === 'code-analyzer');
    const m = run();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatch(/sf plugins install code-analyzer/);
  });
  it('does not check git any more', () => {
    rmSync(join(target, '.git'), { recursive: true });
    expect(run()).toEqual([]);
  });
  it('returns one message per problem', () => {
    rmSync(join(home, '.claude'), { recursive: true });
    has = () => false;
    expect(run({ nodeVersion: 'v16.0.0' })).toHaveLength(3);
  });
});

describe('isGitRepo', () => {
  it('is true for a .git folder or file and false otherwise', () => {
    expect(isGitRepo(target)).toBe(true);
    rmSync(join(target, '.git'), { recursive: true });
    expect(isGitRepo(target)).toBe(false);
    writeFileSync(join(target, '.git'), 'gitdir: /elsewhere\n');
    expect(isGitRepo(target)).toBe(true);
  });
});

describe('findSkill', () => {
  const skill = (dir, name) => {
    mkdirSync(join(dir, '.claude', 'skills', name), { recursive: true });
    writeFileSync(join(dir, '.claude', 'skills', name, 'SKILL.md'), '---\nname: x\n---\n');
  };
  it('finds a skill in the project, a parent folder or the home folder', () => {
    expect(findSkill({ name: 'org', targetDir: target, homeDir: home })).toBeNull();
    skill(home, 'org');
    expect(findSkill({ name: 'org', targetDir: target, homeDir: home })).toBe(join(home, '.claude', 'skills', 'org'));
    skill(root, 'org');
    expect(findSkill({ name: 'org', targetDir: target, homeDir: home })).toBe(join(root, '.claude', 'skills', 'org'));
    skill(target, 'org');
    expect(findSkill({ name: 'org', targetDir: target, homeDir: home })).toBe(join(target, '.claude', 'skills', 'org'));
  });
  it('a folder without SKILL.md does not count', () => {
    mkdirSync(join(home, '.claude', 'skills', 'empty'), { recursive: true });
    expect(findSkill({ name: 'empty', targetDir: target, homeDir: home })).toBeNull();
  });
});
