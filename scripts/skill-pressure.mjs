#!/usr/bin/env node
// @ts-check
// Pressure-test one skill: node scripts/skill-pressure.mjs <skill> <baseline|with-skill> [--scenario S1]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runSkill } from './lib/pressure.mjs';

const kitDir = fileURLToPath(new URL('..', import.meta.url));

/** The Claude Code binary: $CLAUDE_BIN, `claude` on PATH, or the newest VS Code extension binary. */
function claudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  if (spawnSync('claude', ['--version'], { stdio: 'ignore' }).status === 0) return 'claude';
  const ext = path.join(os.homedir(), '.vscode', 'extensions');
  const found = (fs.existsSync(ext) ? fs.readdirSync(ext) : []).filter((d) => d.startsWith('anthropic.claude-code-')).sort()
    .map((d) => path.join(ext, d, 'resources', 'native-binary', 'claude')).filter((p) => fs.existsSync(p));
  if (found.length === 0) throw new Error('Claude Code not found. Set CLAUDE_BIN to the claude binary.');
  return found[found.length - 1];
}

const [skill, mode, flag, only] = process.argv.slice(2);
if (!skill || (mode !== 'baseline' && mode !== 'with-skill') || (flag && flag !== '--scenario')) {
  console.error('Usage: node scripts/skill-pressure.mjs <skill> <baseline|with-skill> [--scenario S1]');
  process.exit(2);
}
const bin = claudeBin();
const results = runSkill({
  kitDir, skill, mode, only,
  run: (args, cwd) => {
    const r = spawnSync(bin, args, { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 20 * 1024 * 1024 });
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? String(r.error ?? '') };
  },
});
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${skill} ${mode} ${r.id}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
