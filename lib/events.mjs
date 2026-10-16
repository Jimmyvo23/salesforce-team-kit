// @ts-check
import fs from 'node:fs';
import path from 'node:path';

/** @type {readonly string[]} */
export const EVENT_TYPES = Object.freeze(['agent_start', 'agent_stop', 'tool_use', 'status', 'task',
  'approval_requested', 'approval_decided', 'handoff', 'escalation', 'snapshot',
  'deploy', 'release', 'released', 'guard_blocked']);
/** @type {readonly string[]} */
export const DEPLOY_RESULTS = Object.freeze(['passed', 'failed']);
/** @type {readonly string[]} */
export const AGENT_STATUSES = Object.freeze(['idle', 'working', 'blocked', 'awaiting_approval', 'done']);
/** @type {readonly string[]} */
export const TASK_STATES = Object.freeze(['todo', 'in_progress', 'in_review', 'done']);
/** @type {readonly string[]} */
export const APPROVAL_STATES = Object.freeze(['pending', 'approved', 'rejected', 'changes_requested']);
const SOURCES = ['hook', 'cli', 'server'];

/** @param {unknown} v */
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * Required non-empty string fields per event type.
 * @type {Record<string, string[]>}
 */
const REQUIRED = {
  agent_start: ['agent'],
  agent_stop: ['agent'],
  tool_use: ['agent', 'action'],
  status: ['agent'],
  task: ['id', 'title', 'owner'],
  approval_requested: ['id', 'summary'],
  approval_decided: ['id'],
  handoff: ['from', 'to', 'task'],
  escalation: ['task', 'summary'],
  snapshot: [],
  deploy: ['agent', 'org'],
  release: ['task'],
  released: ['task'],
  guard_blocked: ['agent', 'reason'],
};

/**
 * @param {any} e
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateEvent(e) {
  /** @param {string} error */
  const bad = (error) => ({ ok: false, error });
  if (e === null || typeof e !== 'object' || Array.isArray(e)) return bad('event must be an object');
  if (typeof e.type !== 'string' || !EVENT_TYPES.includes(e.type)) return bad(`unknown type: ${String(e.type)}`);
  if (!SOURCES.includes(e.source)) return bad(`source must be one of ${SOURCES.join(', ')}`);
  if (e.time !== undefined && (typeof e.time !== 'string' || Number.isNaN(Date.parse(e.time)))) {
    return bad('time must be a date string');
  }
  for (const f of REQUIRED[e.type]) {
    if (!nonEmpty(e[f])) return bad(`${e.type} requires ${f}`);
  }
  switch (e.type) {
    case 'status':
      if (!AGENT_STATUSES.includes(e.status)) return bad(`invalid status: ${String(e.status)}`);
      if (e.status === 'blocked' && !nonEmpty(e.reason)) return bad('status blocked requires reason');
      if (e.progress !== undefined && !(Number.isInteger(e.progress) && e.progress >= 0 && e.progress <= 100)) {
        return bad('progress must be an integer from 0 to 100');
      }
      break;
    case 'task':
      if (!TASK_STATES.includes(e.state)) return bad(`invalid task state: ${String(e.state)}`);
      break;
    case 'approval_decided':
      if (!APPROVAL_STATES.includes(e.state) || e.state === 'pending') return bad(`invalid approval state: ${String(e.state)}`);
      break;
    case 'snapshot':
      if (e.state === null || typeof e.state !== 'object' || Array.isArray(e.state)) return bad('snapshot requires state object');
      break;
    case 'approval_requested':
      if (e.task !== undefined && !nonEmpty(e.task)) return bad('approval task must be a non-empty string');
      break;
    case 'deploy':
      if (!DEPLOY_RESULTS.includes(e.result)) return bad(`deploy result must be one of ${DEPLOY_RESULTS.join(', ')}`);
      if (e.coverage !== undefined && !(Number.isInteger(e.coverage) && e.coverage >= 0 && e.coverage <= 100)) {
        return bad('coverage must be an integer from 0 to 100');
      }
      if (e.tests !== undefined && !(typeof e.tests === 'string' && /^\d+\/\d+$/.test(e.tests))) {
        return bad('tests must look like 38/38 (passed/total)');
      }
      break;
    case 'release':
      if (!(Number.isInteger(e.components) && e.components >= 1)) return bad('release components must be a whole number of at least 1');
      break;
    default:
  }
  return { ok: true };
}

/**
 * Validate and append one event as a single JSONL line. Adds `time` if missing.
 * @param {string} logPathStr path to events.jsonl
 * @param {Record<string, any>} event
 * @param {Date} [now]
 * @returns {void}
 */
export function appendEvent(logPathStr, event, now = new Date()) {
  const e = { ...event };
  if (e.time === undefined) e.time = now.toISOString();
  const v = validateEvent(e);
  if (!v.ok) throw new Error(`Invalid event: ${v.error}`);
  fs.mkdirSync(path.dirname(logPathStr), { recursive: true });
  const prefix = endsWithFragment(logPathStr) ? '\n' : '';
  fs.appendFileSync(logPathStr, prefix + JSON.stringify(e) + '\n');
}

/**
 * True when the file exists, is non-empty, and its last byte is not a newline
 * (a crashed writer left a fragment).
 * @param {string} file
 * @returns {boolean}
 */
function endsWithFragment(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const { size } = fs.fstatSync(fd);
    if (size === 0) return false;
    const buf = Buffer.alloc(1);
    fs.readSync(fd, buf, 0, 1, size - 1);
    return buf[0] !== 0x0a;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Read all valid events. A trailing line without a newline (write in progress)
 * is ignored silently; malformed complete lines are skipped with a warning.
 * @param {string} logPathStr
 * @returns {{ events: Record<string, any>[], warnings: string[] }}
 */
export function readEvents(logPathStr) {
  /** @type {string} */
  let raw;
  try {
    raw = fs.readFileSync(logPathStr, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return { events: [], warnings: [] };
    throw err;
  }
  const lines = raw.split('\n');
  lines.pop(); // text after the last newline: empty, or a half-written line
  /** @type {Record<string, any>[]} */
  const events = [];
  /** @type {string[]} */
  const warnings = [];
  lines.forEach((line, i) => {
    if (line.trim() === '') return;
    try {
      const e = JSON.parse(line);
      const v = validateEvent(e);
      if (v.ok) events.push(e);
      else warnings.push(`line ${i + 1}: ${v.error}`);
    } catch {
      warnings.push(`line ${i + 1}: malformed JSON skipped`);
    }
  });
  return { events, warnings };
}
