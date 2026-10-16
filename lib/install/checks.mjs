// @ts-check
import fs from 'node:fs';
import path from 'node:path';

/**
 * Is there a plugin directory called `name` under any `<cacheDir>/<marketplace>/`?
 * @param {string} cacheDir
 * @param {string} name
 * @returns {boolean}
 */
function hasPlugin(cacheDir, name) {
  let markets;
  try {
    markets = fs.readdirSync(cacheDir);
  } catch {
    return false;
  }
  return markets.some((m) => {
    try {
      return fs.statSync(path.join(cacheDir, m, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * Report everything that stops the installer from running. Git is handled by the installer
 * itself (it offers "git init"), so it is not checked here.
 * @param {{ targetDir: string, nodeVersion: string, homeDir: string, hasCommand: (cmd: string, args: string[]) => boolean }} opts
 * @returns {string[]} one sentence per problem; empty when all is well
 */
export function checkPrereqs({ nodeVersion, homeDir, hasCommand }) {
  /** @type {string[]} */
  const problems = [];
  const major = Number.parseInt(String(nodeVersion).replace(/^v/i, ''), 10);
  if (!(major >= 20)) {
    problems.push(`Node 20 or newer is required but this is ${nodeVersion}; install a current Node LTS and re-run.`);
  }
  const cacheDir = path.join(homeDir, '.claude', 'plugins', 'cache');
  if (!hasPlugin(cacheDir, 'superpowers')) {
    problems.push('The Superpowers plugin is not installed; install it in Claude Code with /plugin and re-run.');
  }
  if (!hasCommand('sf', ['--version'])) {
    problems.push('The Salesforce CLI (sf) is not installed or not on PATH; install it from https://developer.salesforce.com/tools/salesforcecli and re-run.');
  } else if (!hasCommand('sf', ['code-analyzer', '--help'])) {
    problems.push('Salesforce Code Analyzer is not installed; run "sf plugins install code-analyzer" and re-run.');
  }
  return problems;
}

/**
 * @param {string} targetDir
 * @returns {boolean} true when the target has a .git folder or file
 */
export const isGitRepo = (targetDir) => fs.existsSync(path.join(targetDir, '.git'));

/**
 * Where Claude Code would find a skill: <dir>/.claude/skills/<name> from the target up to the
 * filesystem root, then the home folder. Only a folder with a SKILL.md counts.
 * @param {{ name: string, targetDir: string, homeDir: string }} opts
 * @returns {string | null}
 */
export function findSkill({ name, targetDir, homeDir }) {
  /** @type {string[]} */
  const dirs = [];
  let d = path.resolve(targetDir);
  for (;;) {
    dirs.push(path.join(d, '.claude', 'skills', name));
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  dirs.push(path.join(homeDir, '.claude', 'skills', name));
  return dirs.find((x) => fs.existsSync(path.join(x, 'SKILL.md'))) ?? null;
}
