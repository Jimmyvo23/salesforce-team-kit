#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { appendEvent, validateEvent } from '../lib/events.mjs';
import { findProjectRoot, logPath } from '../lib/paths.mjs';
import { loadTeam } from '../lib/team.mjs';

/** @param {unknown} v */
const norm = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Per-subcommand spec: usage line, flags, and the event builder.
 * @type {Record<string, { usage: string, required: string[], optional: string[], build: (v: Record<string, any>) => Record<string, any> }>}
 */
const COMMANDS = {
  status: {
    usage: 'status --agent <id> --status <status> [--task <id>] [--progress <0-100>] [--next <text>] [--reason <text>]',
    required: ['agent', 'status'],
    optional: ['task', 'progress', 'next', 'reason'],
    build: (v) => ({ type: 'status', agent: v.agent, status: v.status, task: v.task, progress: v.progress, nextStep: v.next, reason: v.reason }),
  },
  task: {
    usage: 'task --id <id> --title <text> --owner <agent> --state <todo|in_progress|in_review|done> [--notes <text>]',
    required: ['id', 'title', 'owner', 'state'],
    optional: ['notes'],
    build: (v) => ({ type: 'task', agent: 'planner', id: v.id, title: v.title, owner: v.owner, state: v.state, notes: v.notes }),
  },
  approval: {
    usage: 'approval --id <id> --summary <text> [--agents a,b] [--task <id>]',
    required: ['id', 'summary'],
    optional: ['agents', 'task'],
    build: (v) => ({
      type: 'approval_requested', agent: 'planner', id: v.id, summary: v.summary, task: v.task,
      agents: v.agents === undefined ? undefined : String(v.agents).split(',').map((s) => s.trim()).filter(Boolean),
    }),
  },
  decide: {
    usage: 'decide --id <id> --state <approved|rejected|changes_requested> [--note <text>]',
    required: ['id', 'state'],
    optional: ['note'],
    build: (v) => ({ type: 'approval_decided', agent: 'planner', id: v.id, state: v.state, note: v.note }),
  },
  handoff: {
    usage: 'handoff --from <agent> --to <agent> --task <id> [--file <path>]',
    required: ['from', 'to', 'task'],
    optional: ['file'],
    build: (v) => ({ type: 'handoff', agent: v.from, from: v.from, to: v.to, task: v.task, file: v.file ?? `.team/handoffs/${v.task}-${norm(v.from)}.md` }),
  },
  escalate: {
    usage: 'escalate --task <id> --summary <text>',
    required: ['task', 'summary'],
    optional: [],
    build: (v) => ({ type: 'escalation', agent: 'planner', task: v.task, summary: v.summary }),
  },
  deploy: {
    usage: 'deploy --agent <id> --org <alias> --result <passed|failed> [--tests <passed>/<total>] [--coverage <0-100>] [--task <id>]',
    required: ['agent', 'org', 'result'],
    optional: ['tests', 'coverage', 'task'],
    build: (v) => ({ type: 'deploy', agent: v.agent, org: v.org, result: v.result, tests: v.tests, coverage: v.coverage, task: v.task }),
  },
  release: {
    usage: 'release --task <id> --components <n> [--file <path>]',
    required: ['task', 'components'],
    optional: ['file'],
    build: (v) => ({ type: 'release', agent: 'planner', task: v.task, components: v.components, file: v.file ?? `docs/release/${v.task}-changeset.md` }),
  },
  released: {
    usage: 'released --task <id> [--note <text>]',
    required: ['task'],
    optional: ['note'],
    build: (v) => ({ type: 'released', agent: 'planner', task: v.task, note: v.note }),
  },
};

/**
 * @param {string[]} argv arguments after the script name
 * @param {{ cwd: string, env: Record<string, string | undefined>, now?: Date, stderr?: (s: string) => void }} opts
 * @returns {number} exit code
 */
export function main(argv, opts) {
  const err = opts.stderr ?? ((s) => process.stderr.write(s));
  /** @param {string} msg */
  const fail = (msg) => { err(`${msg}\n`); return 2; };

  const [name, ...rest] = argv;
  const cmd = name === undefined ? undefined : Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!cmd) {
    return fail(`Usage: team-status <${Object.keys(COMMANDS).join('|')}> [flags]${name ? ` (unknown subcommand: ${name})` : ''}`);
  }
  const usage = `Usage: team-status ${cmd.usage}`;

  /** @type {Record<string, any>} */
  let values;
  try {
    const options = Object.fromEntries([...cmd.required, ...cmd.optional].map((k) => [k, { type: /** @type {const} */ ('string') }]));
    ({ values } = parseArgs({ args: rest, options, strict: true, allowPositionals: false }));
  } catch (e) {
    return fail(`${/** @type {Error} */ (e).message}. ${usage}`);
  }
  for (const k of cmd.required) {
    if (values[k] === undefined) return fail(`Missing --${k}. ${usage}`);
  }
  if (values.progress !== undefined) {
    if (!/^\d+$/.test(values.progress)) return fail(`--progress must be an integer from 0 to 100. ${usage}`);
    values.progress = Number(values.progress);
  }
  for (const k of ['coverage', 'components']) {
    if (values[k] === undefined) continue;
    if (!/^\d+$/.test(values[k])) return fail(`--${k} must be a whole number. ${usage}`);
    values[k] = Number(values[k]);
  }

  const envRoot = opts.env.CLAUDE_PROJECT_DIR;
  const root = envRoot ? envRoot : findProjectRoot(opts.cwd);
  if (!root || !fs.existsSync(path.join(root, '.team'))) return fail('No .team folder found. Run the installer first.');

  const event = Object.fromEntries(
    Object.entries({ ...cmd.build(values), source: 'cli' }).filter(([, v]) => v !== undefined),
  );
  const v = validateEvent(event);
  if (!v.ok) return fail(`${v.error}. ${usage}`);
  try {
    appendEvent(logPath(root), event, opts.now);
  } catch (e) {
    return fail(`${/** @type {Error} */ (e).message}. ${usage}`);
  }
  const unknown = unknownIds(root, values);
  if (unknown.length > 0) {
    err(`Warning: ${unknown.map((id) => `"${id}"`).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not on the team in .team/team.json (a typo?); the event was still written.\n`);
  }
  return 0;
}

/**
 * Agent ids named in the flags that are not a member or the approver of .team/team.json.
 * No team.json (or an invalid one) means nothing to check against.
 * @param {string} root
 * @param {Record<string, any>} values
 * @returns {string[]}
 */
function unknownIds(root, values) {
  const loaded = loadTeam(path.join(root, '.team', 'team.json'));
  if (!loaded.ok) return [];
  const known = new Set([loaded.team.approver.id, ...loaded.team.members.map((m) => m.id)]);
  const named = ['agent', 'owner', 'from', 'to'].map((k) => values[k]).filter((v) => v !== undefined).map(norm);
  if (values.agents !== undefined) named.push(...String(values.agents).split(',').map(norm));
  return [...new Set(named.filter((id) => id && !known.has(id)))];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2), { cwd: process.cwd(), env: process.env }));
}
