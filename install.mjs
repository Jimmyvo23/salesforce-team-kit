#!/usr/bin/env node
// @ts-check
// salesforce-team-kit installer.
// Usage: node install.mjs --target <project> [--setup] [--uninstall] [--yes]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkPrereqs, isGitRepo, findSkill } from './lib/install/checks.mjs';
import { planInstall, planUninstall, applyChanges } from './lib/install/plan.mjs';
import { readRegistry, addProject, removeProject } from './lib/install/registry.mjs';
import { loadTeam } from './lib/team.mjs';
import {
  readAliases, classifyAliases, sfInstanceUrl, parseSelection, defaultProjectName, defaultOrgName,
  orgSkillSkeleton, discoveryStory, writeIfMissing, STORY_PATH,
} from './lib/install/setup.mjs';

const KIT_DIR = path.dirname(fileURLToPath(import.meta.url));
const USAGE = 'Usage: node install.mjs --target <project> [--setup] [--uninstall] [--yes] | node install.mjs --update-all [--yes]';

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

/**
 * First-run setup: project name, sandbox list and org knowledge skill, written into .team/team.json.
 * @returns {Promise<string | null>} an error message, or null on success
 * @param {{ targetDir: string, firstInstall: boolean, yes: boolean, io: { homeDir: string, ask: (q: string) => Promise<string>, lookupInstanceUrl?: (alias: string) => string | null }, out: (s: string) => void }} o
 */
async function runSetup({ targetDir, firstInstall, yes, io, out }) {
  const teamFile = path.join(targetDir, '.team', 'team.json');
  /** @type {any} */
  let team;
  try {
    team = JSON.parse(fs.readFileSync(teamFile, 'utf8'));
  } catch {
    return '.team/team.json is not valid JSON; fix it, then re-run with --setup.';
  }
  team.orgs = team.orgs && typeof team.orgs === 'object' ? team.orgs : {};
  const lookup = io.lookupInstanceUrl ?? sfInstanceUrl;
  const foundSkill = (/** @type {unknown} */ name) => typeof name === 'string' && name !== ''
    && findSkill({ name, targetDir, homeDir: io.homeDir });

  let project = firstInstall || typeof team.project !== 'string' || !team.project ? defaultProjectName(targetDir) : team.project;
  if (!yes) {
    const answer = (await io.ask(`Project name [${project}]:`)).trim();
    if (answer) project = answer;
  }
  team.project = project;

  if (yes) {
    if (firstInstall) {
      team.orgs.sandbox = [];
      out(`No sandboxes chosen. Run node install.mjs --target ${targetDir} --setup to choose them.`);
    }
  } else {
    const { sandboxes, skipped } = classifyAliases(readAliases({ homeDir: io.homeDir }), lookup);
    /** @type {string[]} */
    const current = Array.isArray(team.orgs.sandbox) ? team.orgs.sandbox : [];
    if (sandboxes.length === 0) {
      out('No sandbox aliases found. Log in yourself with: sf org login web --alias <name> --instance-url https://test.salesforce.com');
      if (firstInstall) team.orgs.sandbox = [];
    } else {
      out('Sandboxes found:');
      sandboxes.forEach((s, i) => out(`  ${i + 1}) ${s.alias}  (${s.host})${current.includes(s.alias) ? ' [selected]' : ''}`));
      const preselected = sandboxes.flatMap((s, i) => (current.includes(s.alias) ? [i] : []));
      if (skipped.length > 0) {
        out('Skipped:');
        for (const s of skipped) out(`  ${s.alias}: ${s.reason}`);
      }
      /** @type {number[]} */
      let picked = preselected;
      for (let attempt = 0; attempt < 3; attempt++) {
        const answer = await io.ask('Sandboxes the team may use (numbers, comma-separated; Enter keeps [selected]; "none" for none):');
        const parsed = parseSelection(answer, sandboxes.length, preselected);
        if (parsed !== null) { picked = parsed; break; }
        out('Please answer with numbers from the list.');
      }
      team.orgs.sandbox = picked.map((i) => sandboxes[i].alias);
    }
    if (sandboxes.length === 0 && skipped.length > 0) {
      out('Skipped:');
      for (const s of skipped) out(`  ${s.alias}: ${s.reason}`);
    }
  }

  let skill = `${defaultOrgName(project)}-org`;
  let writeSkeleton = true;
  const old = team.orgSkill;
  if (yes) {
    if (!firstInstall && foundSkill(old)) { skill = old; writeSkeleton = false; }
  } else {
    const org = (await io.ask(`Org name for the knowledge skill [${defaultOrgName(project)}]:`)).trim();
    if (org) skill = `${defaultOrgName(org)}-org`;
    if (foundSkill(old) && old !== skill) {
      if (isYes(await io.ask(`Switch orgSkill from "${old}" to "${skill}"? (y/n)`))) { /* use the new skill */ } else { skill = old; writeSkeleton = false; }
    }
  }
  team.orgSkill = skill;
  fs.writeFileSync(teamFile, `${JSON.stringify(team, null, 2)}\n`);

  /** @type {[string, string][]} */
  const files = [[`.claude/skills/${skill}/SKILL.md`, orgSkillSkeleton({ skill, project })], [STORY_PATH, discoveryStory({ skill, project })]];
  for (const [rel, content] of files) {
    if (rel.startsWith('.claude/') && !writeSkeleton) continue;
    if (writeIfMissing(path.join(targetDir, ...rel.split('/')), content)) out(`Created ${rel}`);
  }
  out(`Org setup done. In Claude Code, ask the Architect to run T-000 to fill ${skill}.`);
  return null;
}

/** @param {string} answer */
const isYes = (answer) => /^\s*y(es)?\s*$/i.test(answer);

/**
 * Install, update or uninstall the Kit in one project.
 * @param {string} targetDir absolute path
 * @param { yes: boolean, setup: boolean, uninstall: boolean, io: { homeDir: string, cwd: string, nodeVersion: string, ask: (q: string) => Promise<string>, hasCommand: (cmd: string, args: string[]) => boolean, gitInit: (dir: string) => boolean, lookupInstanceUrl?: (alias: string) => string | null }, out: (s: string) => void, fail: (s: string) => number } o
 * @returns {Promise<{ code: number, summary: string }>}
 */
async function installOne(targetDir, { yes, setup, uninstall, io, out, fail }) {
  const done = (/** @type {string} */ message) => {
    fail(message);
    return { code: 1, summary: `failed: ${message.split('\n')[0]}` };
  };
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
      return done(`Cannot install yet:\n${problems.map((p) => `- ${p}`).join('\n')}`);
    }
    if (!fs.existsSync(targetDir)) return done(`${targetDir} does not exist.`);
    if (!isGitRepo(targetDir)) {
      const init = yes || isYes(await io.ask(`${targetDir} is not a Git repository. Run "git init" there now? (y/n)`));
      if (!init) return done('The team needs a Git repository. Run "git init" in the project, then re-run.');
      if (!io.gitInit(targetDir)) return done(`"git init" failed in ${targetDir}. Run it yourself, then re-run.`);
      out(`Ran git init in ${targetDir}.`);
    }
    out('Checks passed: Node, Git repository, Superpowers plugin, Salesforce CLI and Code Analyzer.');
  } else if (!fs.existsSync(targetDir)) {
    return done(`${targetDir} does not exist.`);
  }

  let changes;
  try {
    changes = uninstall ? planUninstall({ targetDir }) : planInstall({ kitDir: KIT_DIR, targetDir });
  } catch (e) {
    return done(/** @type {Error} */ (e).message);
  }

  const pending = changes.filter((c) => c.action !== 'unchanged');
  const unchanged = changes.length - pending.length;
  if (pending.length === 0) {
    out(`Nothing to do in ${targetDir}; everything is up to date.`);
    if (uninstall) removeProject(io.homeDir, targetDir); else addProject(io.homeDir, targetDir);
    if (setup) {
      const err = await runSetup({ targetDir, firstInstall: false, yes, io, out });
      if (err) return done(err);
    }
    warnOrgSkill();
    return { code: 0, summary: 'up to date' };
  }
  out(`${uninstall ? 'Uninstall' : 'Install'} into ${targetDir}:`);
  for (const c of pending) out(`  ${c.action.padEnd(8)}  ${c.path}${c.reason ? ` (${c.reason})` : ''}`);
  if (unchanged > 0) out(`  ${unchanged} file${unchanged === 1 ? '' : 's'} unchanged.`);

  if (!yes && !isYes(await io.ask('Apply these changes? (y/n)'))) {
    out('No changes made.');
    return { code: 0, summary: 'up to date' };
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
    if (yes) {
      out(`Kept your customised ${c.path} (--yes never replaces customised files).`);
      decisions.set(c.path, false);
      continue;
    }
    const verb = c.content === undefined ? 'Delete' : 'Replace';
    const replace = isYes(await io.ask(`${verb} your customised ${c.path}? (y/n)`));
    if (!replace) out(`Kept ${c.path}.`);
    decisions.set(c.path, replace);
  }

  const kept = [...decisions.values()].filter((d) => !d).length + changes.filter((c) => c.action === 'conflict' && c.symlink).length;
  applyChanges(changes, { targetDir, resolveConflict: (c) => decisions.get(c.path) === true });
  out(uninstall ? 'Uninstalled. team.json and handoffs were kept.' : 'Installed.');
  const createdTeam = changes.some((c) => c.path === '.team/team.json' && c.action === 'create');
  if (!uninstall && (createdTeam || setup)) {
    const err = await runSetup({ targetDir, firstInstall: createdTeam, yes, io, out });
    if (err) return done(err);
  }
  warnOrgSkill();
  if (uninstall && fs.existsSync(path.join(targetDir, '.team'))) {
    const logs = fs.readdirSync(path.join(targetDir, '.team'), { withFileTypes: true })
      .filter((e) => e.isFile() && /^events.*\.jsonl$/.test(e.name)).map((e) => `.team/${e.name}`);
    for (const log of logs) out(`Kept ${log} (the team's activity log); it is no longer git-ignored, so delete it or ignore it yourself before committing.`);
  }
  if (uninstall) removeProject(io.homeDir, targetDir); else addProject(io.homeDir, targetDir);
  return { code: 0, summary: kept > 0 ? `kept ${kept} customised file${kept === 1 ? '' : 's'}` : 'updated' };
}

/**
 * @param {string[]} argv arguments after the script name
 * @param {{ cwd: string, homeDir: string, nodeVersion: string, stdout: (s: string) => void, stderr: (s: string) => void, ask: (question: string) => Promise<string>, hasCommand: (cmd: string, args: string[]) => boolean, gitInit: (dir: string) => boolean, lookupInstanceUrl?: (alias: string) => string | null }} io
 * @returns {Promise<number>} exit code
 */
export async function main(argv, io) {
  const out = (/** @type {string} */ s) => io.stdout(`${s}\n`);
  const fail = (/** @type {string} */ s) => { io.stderr(`${s}\n`); return 1; };

  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { target: { type: 'string' }, uninstall: { type: 'boolean' }, yes: { type: 'boolean' }, setup: { type: 'boolean' }, 'update-all': { type: 'boolean' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (e) {
    return fail(`${/** @type {Error} */ (e).message}. ${USAGE}`);
  }
  if (!values.target && !values['update-all']) return fail(`Missing --target. ${USAGE}`);
  const uninstall = values.uninstall === true;
  const yes = values.yes === true;
  if (values['update-all']) {
    if (values.target || uninstall || values.setup) return fail(`--update-all cannot be combined with --target, --uninstall or --setup. ${USAGE}`);
    const projects = readRegistry(io.homeDir);
    if (projects.length === 0) {
      out('No projects registered yet. Install into a project first.');
      return 0;
    }
    let failed = false;
    for (const p of projects) {
      if (!fs.existsSync(p) || !fs.existsSync(path.join(p, '.team', 'kit-manifest.json'))) {
        out(`skipped ${p}: not installed any more`);
        removeProject(io.homeDir, p);
        continue;
      }
      const r = await installOne(p, { yes, setup: false, uninstall: false, io, out, fail: () => 1 });
      if (r.code !== 0) failed = true;
      out(`${p}: ${r.summary}`);
    }
    return failed ? 1 : 0;
  }
  const targetDir = path.resolve(io.cwd, /** @type {string} */ (values.target));
  if (uninstall && values.setup) return fail(`--setup cannot be combined with --uninstall. ${USAGE}`);
  return (await installOne(targetDir, { yes, setup: values.setup === true, uninstall, io, out, fail })).code;
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
    lookupInstanceUrl: sfInstanceUrl,
    hasCommand: (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore', timeout: 60_000 }).status === 0,
    gitInit: (dir) => spawnSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }).status === 0,
  });
  process.exit(code);
}
