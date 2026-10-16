#!/usr/bin/env node
// @ts-check
// salesforce-team-kit installer.
// Usage: node install.mjs --target <project> [--uninstall] [--yes]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkPrereqs, isGitRepo, findSkill } from './lib/install/checks.mjs';
import { planInstall, planUninstall, applyChanges } from './lib/install/plan.mjs';
import { loadTeam } from './lib/team.mjs';

const KIT_DIR = path.dirname(fileURLToPath(import.meta.url));
const USAGE = 'Usage: node install.mjs --target <project> [--uninstall] [--yes]';

/**
 * Lines added and removed going from `a` to `b` (line-based LCS).
 * @param {string} a
 * @param {string} b
 * @returns {{ added: number, removed: number }}
 */
export function diffCounts(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  let prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const row = new Array(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) {
      row[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    }
    prev = row;
  }
  const common = prev[y.length];
  return { added: y.length - common, removed: x.length - common };
}

/**
 * Line edit script from `a` to `b` (LCS). A final newline does not count as an extra empty line.
 * @param {string} a
 * @param {string} b
 * @returns {{ op: ' ' | '-' | '+', line: string }[]}
 */
function diffLines(a, b) {
  const lines = (/** @type {string} */ t) => { const l = t.split('\n'); if (l.at(-1) === '') l.pop(); return l; };
  const x = lines(a);
  const y = lines(b);
  // suffix[i][j] = LCS length of x[i..] and y[j..]
  const suffix = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      suffix[i][j] = x[i] === y[j] ? suffix[i + 1][j + 1] + 1 : Math.max(suffix[i + 1][j], suffix[i][j + 1]);
    }
  }
  /** @type {{ op: ' ' | '-' | '+', line: string }[]} */
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { ops.push({ op: ' ', line: x[i] }); i++; j++; }
    else if (j >= y.length || (i < x.length && suffix[i + 1][j] >= suffix[i][j + 1])) ops.push({ op: '-', line: x[i++] });
    else ops.push({ op: '+', line: y[j++] });
  }
  return ops;
}

/**
 * A short unified-style diff from `a` (the Kit's version) to `b` (your copy):
 * `-` and `+` lines with up to `context` unchanged lines around them, `...` where
 * unchanged lines are skipped, and at most `max` lines in all.
 * @param {string} a
 * @param {string} b
 * @param {{ context?: number, max?: number }} [opts]
 * @returns {string[]}
 */
export function formatDiff(a, b, { context = 2, max = 40 } = {}) {
  const ops = diffLines(a, b);
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, k) => {
    if (o.op === ' ') return;
    for (let d = Math.max(0, k - context); d <= Math.min(ops.length - 1, k + context); d++) keep[d] = true;
  });
  /** @type {string[]} */
  const out = [];
  let last = -1;
  ops.forEach((o, k) => {
    if (!keep[k]) return;
    if (last >= 0 && k > last + 1) out.push('...');
    out.push(`${o.op}${o.line}`);
    last = k;
  });
  if (out.length <= max) return out;
  return [...out.slice(0, max - 1), `... ${out.length - (max - 1)} more lines`];
}

/** @param {string} answer */
const isYes = (answer) => /^\s*y(es)?\s*$/i.test(answer);

/**
 * @param {string[]} argv arguments after the script name
 * @param {{ cwd: string, homeDir: string, nodeVersion: string, stdout: (s: string) => void, stderr: (s: string) => void, ask: (question: string) => Promise<string>, hasCommand: (cmd: string, args: string[]) => boolean, gitInit: (dir: string) => boolean }} io
 * @returns {Promise<number>} exit code
 */
export async function main(argv, io) {
  const out = (/** @type {string} */ s) => io.stdout(`${s}\n`);
  const fail = (/** @type {string} */ s) => { io.stderr(`${s}\n`); return 1; };

  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { target: { type: 'string' }, uninstall: { type: 'boolean' }, yes: { type: 'boolean' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (e) {
    return fail(`${/** @type {Error} */ (e).message}. ${USAGE}`);
  }
  if (!values.target) return fail(`Missing --target. ${USAGE}`);
  const targetDir = path.resolve(io.cwd, values.target);
  const uninstall = values.uninstall === true;
  const warnOrgSkill = () => {
    if (uninstall) return;
    const team = loadTeam(path.join(targetDir, '.team', 'team.json'));
    if (team.ok && team.team.orgSkill && !findSkill({ name: team.team.orgSkill, targetDir, homeDir: io.homeDir })) {
      out(`Warning: the org knowledge skill "${team.team.orgSkill}" was not found in the project, its parent folders or ~/.claude/skills. Agents work without org knowledge until it exists. Set "orgSkill" in .team/team.json to your skill's name.`);
    }
  };

  if (!uninstall) {
    const problems = checkPrereqs({ targetDir, nodeVersion: io.nodeVersion, homeDir: io.homeDir, hasCommand: io.hasCommand });
    if (problems.length > 0) {
      return fail(`Cannot install yet:\n${problems.map((p) => `- ${p}`).join('\n')}`);
    }
    if (!fs.existsSync(targetDir)) return fail(`${targetDir} does not exist.`);
    if (!isGitRepo(targetDir)) {
      const yes = values.yes || isYes(await io.ask(`${targetDir} is not a Git repository. Run "git init" there now? (y/n)`));
      if (!yes) return fail('The team needs a Git repository. Run "git init" in the project, then re-run.');
      if (!io.gitInit(targetDir)) return fail(`"git init" failed in ${targetDir}. Run it yourself, then re-run.`);
      out(`Ran git init in ${targetDir}.`);
    }
    out('Checks passed: Node, Git repository, Superpowers plugin, Salesforce CLI and Code Analyzer.');
  } else if (!fs.existsSync(targetDir)) {
    return fail(`${targetDir} does not exist.`);
  }

  let changes;
  try {
    changes = uninstall ? planUninstall({ targetDir }) : planInstall({ kitDir: KIT_DIR, targetDir });
  } catch (e) {
    return fail(/** @type {Error} */ (e).message);
  }

  const pending = changes.filter((c) => c.action !== 'unchanged');
  const unchanged = changes.length - pending.length;
  if (pending.length === 0) {
    out(`Nothing to do in ${targetDir}; everything is up to date.`);
    warnOrgSkill();
    return 0;
  }
  out(`${uninstall ? 'Uninstall' : 'Install'} into ${targetDir}:`);
  for (const c of pending) out(`  ${c.action.padEnd(8)}  ${c.path}${c.reason ? ` (${c.reason})` : ''}`);
  if (unchanged > 0) out(`  ${unchanged} file${unchanged === 1 ? '' : 's'} unchanged.`);

  if (!values.yes && !isYes(await io.ask('Apply these changes? (y/n)'))) {
    out('No changes made.');
    return 0;
  }

  /** @type {Map<string, boolean>} */
  const decisions = new Map();
  for (const c of pending.filter((x) => x.action === 'conflict')) {
    if (c.symlink) {
      out(`Skipped ${c.path}: it is a symlink, so the Kit will not write or delete through it.`);
      continue;
    }
    if (c.content !== undefined) {
      const current = fs.readFileSync(path.join(targetDir, ...c.path.split('/')), 'utf8');
      const { added, removed } = diffCounts(c.content, current);
      out(`${c.path} differs from the Kit's version: your copy has ${added} line${added === 1 ? '' : 's'} added, ${removed} removed.`);
      for (const line of formatDiff(c.content, current)) out(`  ${line}`);
    } else {
      out(`${c.path} was changed after it was installed.`);
    }
    if (values.yes) {
      out(`Kept your customised ${c.path} (--yes never replaces customised files).`);
      decisions.set(c.path, false);
      continue;
    }
    const verb = c.content === undefined ? 'Delete' : 'Replace';
    const yes = isYes(await io.ask(`${verb} your customised ${c.path}? (y/n)`));
    if (!yes) out(`Kept ${c.path}.`);
    decisions.set(c.path, yes);
  }

  applyChanges(changes, { targetDir, resolveConflict: (c) => decisions.get(c.path) === true });
  out(uninstall ? 'Uninstalled. team.json and handoffs were kept.' : 'Installed.');
  warnOrgSkill();
  if (uninstall && fs.existsSync(path.join(targetDir, '.team'))) {
    const logs = fs.readdirSync(path.join(targetDir, '.team'), { withFileTypes: true })
      .filter((e) => e.isFile() && /^events.*\.jsonl$/.test(e.name)).map((e) => `.team/${e.name}`);
    for (const log of logs) out(`Kept ${log} (the team's activity log); it is no longer git-ignored, so delete it or ignore it yourself before committing.`);
  }
  return 0;
}

/** True when this file is the entry script, directly or through a symlink. */
function isMain() {
  try {
    const arg = process.argv[1];
    if (!arg) return false;
    if (import.meta.url === pathToFileURL(arg).href) return true;
    return fs.realpathSync(arg) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const { createInterface } = await import('node:readline');
  // One reader for the whole run, so piped answers ("y\ny\n") are not lost between questions.
  const rl = createInterface({ input: process.stdin });
  /** @type {string[]} */ const lines = [];
  /** @type {((s: string) => void)[]} */ const waiting = [];
  let closed = false;
  rl.on('line', (line) => { const w = waiting.shift(); if (w) w(line); else lines.push(line); });
  rl.on('close', () => { closed = true; for (const w of waiting.splice(0)) w(''); });
  /**
   * Ask on the terminal; a closed stdin (no answer possible) counts as "no".
   * @param {string} question
   * @returns {Promise<string>}
   */
  const ask = (question) => {
    process.stdout.write(`${question} `);
    const line = lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (closed) return Promise.resolve('');
    return new Promise((resolve) => waiting.push(resolve));
  };
  const code = await main(process.argv.slice(2), {
    cwd: process.cwd(),
    homeDir: os.homedir(),
    nodeVersion: process.version,
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    ask,
    hasCommand: (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore', timeout: 60_000 }).status === 0,
    gitInit: (dir) => spawnSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }).status === 0,
  });
  process.exit(code);
}
