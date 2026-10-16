import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planInstall, planUninstall, applyChanges } from '../lib/install/plan.mjs';
import { mergeDeny, removeKitDeny, KIT_DENY, mergeHooks, removeKitHooks } from '../lib/install/text.mjs';

const KIT = fileURLToPath(new URL('..', import.meta.url));
let target;
beforeEach(() => {
  target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sftk-inst-')), 'proj');
  fs.mkdirSync(target);
  spawnSync('git', ['init', '-q'], { cwd: target });
});
afterEach(() => fs.rmSync(path.dirname(target), { recursive: true, force: true }));
const install = () => applyChanges(planInstall({ kitDir: KIT, targetDir: target }), { targetDir: target, resolveConflict: () => false });
const uninstall = () => applyChanges(planUninstall({ targetDir: target }), { targetDir: target, resolveConflict: () => true });
const settings = () => JSON.parse(fs.readFileSync(path.join(target, '.claude', 'settings.json'), 'utf8'));

describe('deny rules', () => {
  test('KIT_DENY blocks quick deploys', () => {
    expect(KIT_DENY).toEqual(['Bash(sf project deploy quick:*)']);
  });
  test('merge adds once and keeps user rules; remove takes only kit rules', () => {
    const user = { permissions: { deny: ['Bash(rm -rf:*)'], allow: ['Bash(ls:*)'] } };
    const merged = mergeDeny(mergeDeny(user));
    expect(merged.permissions.deny).toEqual(['Bash(rm -rf:*)', 'Bash(sf project deploy quick:*)']);
    expect(user.permissions.deny).toEqual(['Bash(rm -rf:*)']);
    expect(removeKitDeny(merged)).toEqual(user);
  });
  test('remove drops empty containers it emptied', () => {
    expect(removeKitDeny(mergeDeny({}))).toEqual({});
  });
});

describe('hooks', () => {
  test('the guard hook counts as a kit hook', () => {
    const kit = JSON.parse(fs.readFileSync(path.join(KIT, 'templates', 'hooks.json'), 'utf8'));
    expect(kit.PreToolUse[0].matcher).toBe('Bash');
    expect(kit.PreToolUse[0].hooks[0].command).toBe('node "$CLAUDE_PROJECT_DIR/.team/bin/hooks/guard-org.mjs"');
    expect(removeKitHooks(mergeHooks({}, kit))).toEqual({});
  });
});

describe('install and uninstall', () => {
  test('installs the guard, the deny rule and the ignore lines', () => {
    install();
    for (const f of ['.team/bin/hooks/guard-org.mjs', '.team/bin/lib/guard.mjs', '.team/changeset-template.md']) {
      expect(fs.existsSync(path.join(target, f)), f).toBe(true);
    }
    expect(fs.statSync(path.join(target, '.team/bin/hooks/guard-org.mjs')).mode & 0o111).not.toBe(0);
    const s = settings();
    expect(s.hooks.PreToolUse[0].hooks[0].command).toContain('guard-org.mjs');
    expect(s.permissions.deny).toContain('Bash(sf project deploy quick:*)');
    const ignore = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');
    for (const line of ['.team/org-cache.json', '.sf/', '.sfdx/']) expect(ignore).toContain(line);
  });

  test('the installed guard runs and blocks an unlisted org', () => {
    install();
    const r = spawnSync(process.execPath, [path.join(target, '.team/bin/hooks/guard-org.mjs')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'sf project deploy start -o prod' } }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: target },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/"prod" is not listed/);
  });

  test('uninstall removes the guard hook and the deny rule but keeps user rules', () => {
    fs.mkdirSync(path.join(target, '.claude'));
    fs.writeFileSync(path.join(target, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['Bash(rm -rf:*)'] } }));
    install();
    uninstall();
    const s = settings();
    expect(s.permissions.deny).toEqual(['Bash(rm -rf:*)']);
    expect(s.hooks).toBeUndefined();
  });
});

describe('re-install is idempotent with a user deny rule', () => {
  test('second planInstall reports settings.json as unchanged', () => {
    fs.mkdirSync(path.join(target, '.claude'));
    fs.writeFileSync(path.join(target, '.claude', 'settings.json'), JSON.stringify({ model: 'opus' }, null, 2));
    install();
    // The user adds their own deny rule to the permissions the first install created.
    const s = settings();
    s.permissions.deny.unshift('Bash(rm -rf:*)');
    fs.writeFileSync(path.join(target, '.claude', 'settings.json'), JSON.stringify(s, null, 2));
    // Planned straight away: a second install call would rewrite the key order and hide the defect.
    const plan = planInstall({ kitDir: KIT, targetDir: target });
    expect(plan.find((c) => c.path === '.claude/settings.json')).toMatchObject({ action: 'unchanged' });
    expect(settings().permissions.deny).toEqual(['Bash(rm -rf:*)', 'Bash(sf project deploy quick:*)']);
  });
});
