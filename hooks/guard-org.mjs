#!/usr/bin/env node
// @ts-check
// Claude Code PreToolUse hook for Bash: blocks sf commands aimed at any org that is not a
// listed sandbox (spec section 5). Allow: no output, exit 0. Block: the reason on stderr and
// exit 2, which Claude Code shows to the agent, plus a guard_blocked event for the office.
// It looks up instance URLs with "sf org display --json"; that output holds an access token
// and is never printed or stored, only the instance URL is kept.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decide, readDefaultOrg, cachedInstanceUrl } from '../lib/guard.mjs';
import { loadTeam } from '../lib/team.mjs';
import { appendEvent } from '../lib/events.mjs';
import { logPath } from '../lib/paths.mjs';
import { describeBash } from './record.mjs';

const CACHE_FILE = path.join('.team', 'org-cache.json');

/** @param {string} file @returns {string | null} */
function readOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** @param {string} alias @returns {string | null} */
function lookupInstanceUrl(alias) {
  const r = spawnSync('sf', ['org', 'display', '-o', alias, '--json'], { encoding: 'utf8', timeout: 30_000 });
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
 * @param {{ projectDir: string, homeDir: string, now: Date }} env
 * @returns {import('../lib/guard.mjs').Decision}
 */
export function guard(input, { projectDir, homeDir, now }) {
  if (!input || typeof input !== 'object' || input.tool_name !== 'Bash') return { allow: true };
  const command = typeof input.tool_input?.command === 'string' ? input.tool_input.command : '';
  const loaded = loadTeam(path.join(projectDir, '.team', 'team.json'));
  const cachePath = path.join(projectDir, CACHE_FILE);
  /** @type {Record<string, { url: string, at: string }>} */
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
    defaultOrg: () => readDefaultOrg({ projectDir, homeDir, readFile: readOrNull }),
    instanceUrl: (alias) => {
      const r = cachedInstanceUrl(alias, { cache, now, lookup: lookupInstanceUrl });
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
    readScript: (file) => readOrNull(path.resolve(projectDir, file)),
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

/** @returns {Promise<number>} exit code */
async function run() {
  const raw = await readStdin();
  /** @type {any} */
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return 0;
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!projectDir) return 0;
  const command = String(input?.tool_input?.command ?? '');
  /** @type {import('../lib/guard.mjs').Decision} */
  let d;
  try {
    d = guard(input, { projectDir, homeDir: os.homedir(), now: new Date() });
  } catch (e) {
    if (!/\bsf(dx)?\b/i.test(command)) return 0;
    d = { allow: false, reason: `The org guard failed (${e instanceof Error ? e.message : String(e)}), so this sf command is blocked.` };
  }
  if (d.allow) return 0;
  process.stderr.write(`Blocked by the org guard: ${d.reason}\n`);
  try {
    if (fs.statSync(path.join(projectDir, '.team'), { throwIfNoEntry: false })?.isDirectory()) {
      const type = typeof input.agent_type === 'string' ? input.agent_type.trim().toLowerCase() : '';
      appendEvent(logPath(projectDir), {
        type: 'guard_blocked', agent: type || 'planner', command: describeBash(command) || 'a command', reason: d.reason, source: 'hook',
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

if (isMain()) {
  run().then((code) => process.exit(code), () => process.exit(0));
}
