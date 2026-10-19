import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planInstall, planUninstall, applyChanges, SKILLS, skillCopies, sha256 } from '../lib/install/plan.mjs';

const KIT = fileURLToPath(new URL('..', import.meta.url));
let target;
beforeEach(() => {
  target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sftk-skills-')), 'proj');
  fs.mkdirSync(target);
  spawnSync('git', ['init', '-q'], { cwd: target });
});
afterEach(() => fs.rmSync(path.dirname(target), { recursive: true, force: true }));
const install = () => applyChanges(planInstall({ kitDir: KIT, targetDir: target }), { targetDir: target, resolveConflict: () => false });
const uninstall = () => applyChanges(planUninstall({ targetDir: target }), { targetDir: target, resolveConflict: () => true });

describe('skills', () => {
  test('the seven skills', () => {
    expect([...SKILLS]).toEqual(['sf-architecture', 'sf-apex', 'sf-flow', 'sf-security', 'sf-testing', 'sf-deploy', 'sf-review']);
  });

  test('skillCopies lists SKILL.md and references, never tests', () => {
    const copies = skillCopies(path.join(KIT, 'skills'));
    for (const name of SKILLS) expect(copies).toContainEqual([`skills/${name}/SKILL.md`, `.claude/skills/${name}/SKILL.md`, false]);
    expect(copies.some(([src]) => src.includes('/tests/'))).toBe(false);
  });

  test('install puts every skill in .claude/skills without tests; uninstall removes them and keeps user skills', () => {
    fs.mkdirSync(path.join(target, '.claude', 'skills', 'my-own'), { recursive: true });
    fs.writeFileSync(path.join(target, '.claude', 'skills', 'my-own', 'SKILL.md'), '---\nname: my-own\ndescription: Use when mine\n---\n');
    install();
    for (const name of SKILLS) {
      expect(fs.existsSync(path.join(target, '.claude', 'skills', name, 'SKILL.md')), name).toBe(true);
      expect(fs.existsSync(path.join(target, '.claude', 'skills', name, 'tests')), `${name} tests`).toBe(false);
    }
    uninstall();
    for (const name of SKILLS) expect(fs.existsSync(path.join(target, '.claude', 'skills', name)), name).toBe(false);
    expect(fs.existsSync(path.join(target, '.claude', 'skills', 'my-own', 'SKILL.md'))).toBe(true);
  });

  test('update from a manifest without skill folders records them, so uninstall removes the empty folders', () => {
    install();
    const manifestPath = path.join(target, '.team', 'kit-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.files = Object.fromEntries(Object.entries(manifest.files).filter(([k]) => !k.startsWith('.claude/skills/')));
    manifest.createdDirs = manifest.createdDirs.filter((d) => !d.startsWith('.claude/skills'));
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    fs.rmSync(path.join(target, '.claude', 'skills'), { recursive: true });
    install();
    const after = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(after.createdDirs).toContain('.claude/skills');
    for (const name of SKILLS) expect(after.createdDirs).toContain(`.claude/skills/${name}`);
    uninstall();
    expect(fs.existsSync(path.join(target, '.claude', 'skills'))).toBe(false);
  });

  test('a skill file removed from the kit is removed from the project on update', () => {
    install();
    const manifestPath = path.join(target, '.team', 'kit-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const stale = '.claude/skills/sf-apex/references/old.md';
    fs.writeFileSync(path.join(target, stale), 'old');
    manifest.files[stale] = sha256('old');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    install();
    expect(fs.existsSync(path.join(target, stale))).toBe(false);
  });
});
