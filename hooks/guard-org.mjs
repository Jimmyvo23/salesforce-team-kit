#!/usr/bin/env node
// @ts-check
// Claude Code PreToolUse hook for Bash: blocks sf commands aimed at any org that is not a
// listed sandbox (spec section 5). Allow: no output, exit 0. Block: the reason on stderr and
// exit 2, which Claude Code shows to the agent, plus a guard_blocked event for the office.
// It looks up instance URLs with "sf org display --json"; that output holds an access token
// and is never printed or stored, only the instance URL is kept.
// Only Node built-ins are imported statically. The kit's own modules are loaded below inside a
// try/catch: if one is missing or broken, a static import would crash the hook with exit 1,
// which Claude Code treats as a non-blocking error, so the command would run unchecked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** @param {unknown} e @returns {string} the first line of an error, kept short */
const shortError = (e) => (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 200);

/**
 * @typedef {object} Kit
 * @property {typeof import('../lib/guard.mjs')} guardLib
 * @property {typeof import('../lib/team.mjs')} team
 * @property {typeof import('../lib/events.mjs')} events
 * @property {typeof import('../lib/paths.mjs')} paths
 * @property {typeof import('./record.mjs')} record
 */
/** @type {Kit | null} */
let kit = null;
let loadError = '';
try {
  const [guardLib, team, events, paths, record] = await Promise.all([
    import('../lib/guard.mjs'), import('../lib/team.mjs'), import('../lib/events.mjs'), import('../lib/paths.mjs'), import('./record.mjs'),
  ]);
  kit = { guardLib, team, events, paths, record };
} catch (e) {
  loadError = shortError(e);
}

const CACHE_FILE = path.join('.team', 'org-cache.json');

/** @param {string} file @returns {string | null} */
function readOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** @param {string} p @returns {string} the real path when it exists */
function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** @param {string} dir @param {string} sub @returns {boolean} true when sub is dir or below it */
function isInside(dir, sub) {
  const rel = path.relative(real(dir), real(sub));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** @param {string} alias @returns {string | null} */
function lookupInstanceUrl(alias) {
  const r = spawnSync('sf', ['org', 'display', '-o', alias, '--json'], { encoding: 'utf8', timeout: 10_000 });
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;
  try {
    const url = JSON.parse(r.stdout)?.result?.instanceUrl;
    return typeof url === 'string' ? url : null;
  } catch {
    return null;
  }
}

/**
 * @param {any} input the hook input
 * @param {{ projectDir: string, homeDir: string, now: Date, env?: Record<string, string | undefined> }} o
 * @returns {import('../lib/guard.mjs').Decision}
 */
export function guard(input, { projectDir, homeDir, now, env = process.env }) {
  if (!input || typeof input !== 'object' || input.tool_name !== 'Bash') return { allow: true };
  if (!kit) throw new Error(`the guard's files did not load: ${loadError}`);
  const { decide, resolveDefaultOrg, cachedInstanceUrl, findSfdxProject, aliasUsername } = kit.guardLib;
  const command = typeof input.tool_input?.command === 'string' ? input.tool_input.command : '';
  // sf resolves the project config and relative paths from the folder the command runs in.
  const base = typeof input.cwd === 'string' && input.cwd ? path.resolve(projectDir, input.cwd) : projectDir;
  const sfdxRoot = findSfdxProject(base, (f) => fs.existsSync(f));
  const sources = { projectDir: sfdxRoot, homeDir, readFile: readOrNull, env };
  const org = resolveDefaultOrg(sources);
  const hub = resolveDefaultOrg({ ...sources, hub: true });
  const conflict = org.conflict ?? hub.conflict;
  const loaded = kit.team.loadTeam(path.join(projectDir, '.team', 'team.json'));
  const cachePath = path.join(projectDir, CACHE_FILE);
  /** @type {import('../lib/guard.mjs').UrlCache} */
  let cache = {};
  try {
    const c = JSON.parse(readOrNull(cachePath) ?? '{}');
    if (c && typeof c === 'object' && !Array.isArray(c)) cache = c;
  } catch {
    // A broken cache is rebuilt.
  }
  return decide(command, {
    sandboxes: loaded.ok ? loaded.team.orgs.sandbox : null,
    teamError: loaded.ok ? undefined : loaded.error,
    defaultOrg: () => org.org,
    defaultDevHub: () => hub.org,
    mustNameOrg: !isInside(projectDir, base) ? 'Pass -o <sandbox alias>; this folder is outside the project.'
      : conflict === 'env' ? 'SF_ and SFDX_ variables name different default orgs. Pass -o <sandbox alias>.'
        : conflict === 'config' ? 'The new and legacy sf config name different default orgs. Pass -o <sandbox alias>.' : null,
    instanceUrl: (alias) => {
      const username = aliasUsername(alias, { homeDir, readFile: readOrNull });
      const r = cachedInstanceUrl(alias, { cache, now, lookup: lookupInstanceUrl, username });
      if (r.cache !== cache) {
        cache = r.cache;
        try {
          fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
        } catch {
          // The cache is only a speed-up.
        }
      }
      return r.url;
    },
    readScript: (file) => readOrNull(path.resolve(base, file === '~' || file.startsWith('~/') ? path.join(homeDir, file.slice(1)) : file)),
  });
}

/** @returns {Promise<string>} */
function readStdin() {
  return new Promise((resolve) => {
    /** @type {Buffer[]} */ const chunks = [];
    process.stdin.on('data', (c) => chunks.push(Buffer.from(c)));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}

/** @param {string} text @returns {boolean} true when the text looks like it runs the Salesforce CLI */
export function mentionsSf(text) {
  return /\bsf(dx)?\b|@salesforce\/cli/i.test(text);
}

/**
 * The fallback test for blocking when the guard can't decide: mentionsSf on the raw text and on
 * the text without quotes and backslashes (s''f, s\f), plus the guard's own word rules when they
 * loaded. If those rules throw, the answer is yes.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeSf(text) {
  if (mentionsSf(text) || mentionsSf(text.replace(/['"\\]/g, ''))) return true;
  try {
    return kit ? kit.guardLib.mentionsSfWords(text) : false;
  } catch {
    return true;
  }
}

/** @returns {Promise<number>} exit code */
async function run() {
  const raw = await readStdin();
  /** @type {any} */
  let input = null;
  /** @type {import('../lib/guard.mjs').Decision} */
  let d;
  let command = '';
  try {
    input = JSON.parse(raw);
  } catch {
    if (!looksLikeSf(raw)) return 0;
    d = { allow: false, reason: 'The org guard could not read this command, so it is blocked.' };
  }
  command = String(input?.tool_input?.command ?? '');
  if (!d && !kit) {
    if (input?.tool_name !== 'Bash' || !looksLikeSf(command)) return 0;
    d = { allow: false, reason: `The org guard could not load its files (${loadError}), so sf commands are blocked. Re-run the kit installer.` };
  }
  const cwd = typeof input?.cwd === 'string' ? input.cwd : '';
  const projectDir = process.env.CLAUDE_PROJECT_DIR || cwd || '';
  if (!d) {
    if (!projectDir) {
      if (!looksLikeSf(command)) return 0;
      d = { allow: false, reason: "The org guard can't find the project folder, so sf commands are blocked." };
    } else {
      try {
        d = guard(input, { projectDir, homeDir: os.homedir(), now: new Date() });
      } catch (e) {
        if (!looksLikeSf(command)) return 0;
        d = { allow: false, reason: `The org guard failed (${e instanceof Error ? e.message : String(e)}), so this sf command is blocked.` };
      }
    }
  }
  if (d.allow) return 0;
  process.stderr.write(`Blocked by the org guard: ${d.reason}\n`);
  try {
    if (kit && projectDir && fs.statSync(path.join(projectDir, '.team'), { throwIfNoEntry: false })?.isDirectory()) {
      const type = typeof input?.agent_type === 'string' ? input.agent_type.trim().toLowerCase() : '';
      kit.events.appendEvent(kit.paths.logPath(projectDir), {
        type: 'guard_blocked', agent: type || 'planner', command: kit.record.describeBash(command) || 'a command', reason: d.reason, source: 'hook',
      });
    }
  } catch {
    // Logging never changes the decision.
  }
  return 2;
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

/**
 * Exit with the run's code; a run that rejects exits 2 (blocked), never 1.
 * @param {Promise<number>} p
 * @param {(code: number) => void} [exit]
 */
export function finish(p, exit = (code) => process.exit(code)) {
  return p.then((code) => exit(code), () => exit(2));
}

if (isMain()) finish(run());
