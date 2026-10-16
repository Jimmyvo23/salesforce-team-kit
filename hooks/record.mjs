#!/usr/bin/env node
// @ts-check
// Claude Code hook recorder. Usage: node record.mjs <agent-start|agent-stop|tool|turn-end>
// Reads the hook input JSON on stdin and appends one event to <project>/.team/events.jsonl.
// Contract: print NOTHING (stdout may reach Claude's context) and ALWAYS exit 0.
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** @param {unknown} v */
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * Split a shell command into top-level segments (on && || ; newline, outside quotes),
 * each a list of words with surrounding quotes removed. Empty segments are dropped.
 * @param {string} command
 * @returns {string[][]}
 */
function splitSegments(command) {
  /** @type {string[][]} */ const segments = [];
  /** @type {string[]} */ let words = [];
  let word = '';
  let inWord = false;
  /** @type {string} */ let quote = '';
  const endWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length) segments.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = '';
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      inWord = true;
    } else if (c === ';' || c === '\n' || c === '\r') {
      endSegment();
    } else if ((c === '&' || c === '|') && command[i + 1] === c) {
      endSegment();
      i++;
    } else if (/\s/.test(c)) {
      endWord();
    } else {
      word += c;
      inWord = true;
    }
  }
  endSegment();
  return segments;
}

/** @param {string} w */
const baseName = (w) => (w.includes('/') ? w.split('/').filter(Boolean).pop() || w : w);

/** Drop wrapper syntax ( $( { before the command and ) } after it, and VAR=value words. @param {string[]} words */
function cleanSegment(words) {
  const w = words.filter(Boolean);
  for (;;) {
    if (!w.length) break;
    w[0] = w[0].replace(/^(?:\$\(|[({])+/, '');
    if (!w[0]) { w.shift(); continue; }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) { w.shift(); continue; }
    break;
  }
  return w.map((x) => x.replace(/[)}]+$/, '')).filter(Boolean);
}

/**
 * Describe a Bash command for the dashboard. Leading directory changes (cd, pushd, popd)
 * are skipped and their arguments never shown; wrappers and VAR=value words are skipped;
 * the command word is shown as a basename; a second word (basename) is added only if it
 * cannot carry a secret (no '=', '@' or ':', no leading '-', no whitespace).
 * Returns '' for the team-status CLI (`node .../team-status.mjs`): it logs its own event.
 * @param {string} command
 * @returns {string}
 */
export function describeBash(command) {
  const segments = splitSegments(command).map(cleanSegment).filter((w) => w.length);
  if (!segments.length) return '';
  const isDir = (/** @type {string[]} */ w) => ['cd', 'pushd', 'popd'].includes(w[0]);
  const first = segments.find((w) => !isDir(w));
  if (!first) return `Running ${segments[0][0]}`;
  const cmd = baseName(first[0]);
  if (/\s/.test(cmd) || cmd.includes('=') || cmd.startsWith('-')) return 'Running a command';
  const raw = first[1];
  if (cmd === 'node' && raw && baseName(raw) === 'team-status.mjs') return '';
  const next = raw && !/[=@:]/.test(raw) && !raw.startsWith('-') ? baseName(raw) : '';
  const sub = next && !/\s/.test(next) ? ` ${next}` : '';
  return `Running ${cmd}${sub}`;
}

/**
 * Pure mapping from a hook input to a kit event, or null to ignore.
 * @param {string} kind
 * @param {any} input
 * @returns {Record<string, string> | null}
 */
export function mapHookInput(kind, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const type = str(input.agent_type).trim().toLowerCase();

  if (kind === 'agent-start') return type ? { type: 'agent_start', agent: type, source: 'hook' } : null;
  if (kind === 'agent-stop') return type ? { type: 'agent_stop', agent: type, source: 'hook' } : null;
  // Stop: the main session finished its turn. The state fold applies this only to a working planner.
  if (kind === 'turn-end') return { type: 'status', agent: 'planner', status: 'idle', source: 'hook' };
  if (kind !== 'tool') return null;

  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  let action = '';
  const editPath = ['Edit', 'Write', 'MultiEdit'].includes(input.tool_name) ? ti.file_path
    : input.tool_name === 'NotebookEdit' ? ti.notebook_path : undefined;
  if (editPath !== undefined) {
    const base = str(editPath).split(/[\\/]/).filter(Boolean).pop();
    if (base) action = `Editing ${base}`;
  } else if (input.tool_name === 'Bash') {
    action = describeBash(str(ti.command));
  }
  if (!action) return null;
  if (action.length > 120) action = `${action.slice(0, 119)}\u2026`;

  // Subagent -> its type; main session (no agent_id) -> planner; unknown instance -> team.
  const agent = type || (input.agent_id ? 'team' : 'planner');
  return { type: 'tool_use', agent, action, source: 'hook' };
}

// Reads stdin to EOF: Claude Code closes it; a manual run from a TTY waits for Ctrl-D.
/** @returns {Promise<string>} */
function readStdin() {
  return new Promise((resolve) => {
    /** @type {Buffer[]} */ const chunks = [];
    process.stdin.on('data', (c) => chunks.push(Buffer.from(c)));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}

async function run() {
  try {
    const kind = process.argv[2] ?? '';
    const dir = process.env.CLAUDE_PROJECT_DIR;
    const raw = await readStdin();
    if (!dir) return;
    const event = mapHookInput(kind, JSON.parse(raw));
    if (!event) return;
    const fs = await import('node:fs');
    const path = await import('node:path');
    if (!fs.statSync(path.join(dir, '.team'), { throwIfNoEntry: false })?.isDirectory()) return;
    const { appendEvent } = await import('../lib/events.mjs');
    const { logPath } = await import('../lib/paths.mjs');
    appendEvent(logPath(dir), event);
  } catch {
    // Swallow everything: a hook must never print or fail.
  }
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
  run().finally(() => process.exit(0));
}
