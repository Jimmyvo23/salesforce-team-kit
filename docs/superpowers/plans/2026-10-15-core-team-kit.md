# Salesforce Team Kit, Plan 1: Core Team Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the cloned `agent-team-kit` into an installable six-role Salesforce team (Architect, Analyst, Admin, Developer, QA, Reviewer) with a sandbox-only org guard, deploy and release events, and stage-based task progress, working with the existing dashboard.

**Architecture:** The engine (installer, CLI, hooks, state) stays close to upstream. New behaviour lives in new focused modules: `lib/guard.mjs` (pure guard decisions), `hooks/guard-org.mjs` (PreToolUse hook entry), `lib/progress.mjs` (task progress). Existing modules get small, additive changes (new event types, new CLI subcommands, new folded state). Content (agent files, Architect rules, templates) is rewritten for Salesforce.

**Tech Stack:** Node 20+ ES modules with `// @ts-check` JSDoc (no dependencies in installed code), Vitest, ESLint, the Salesforce CLI (`sf` v2) and Code Analyzer v5.

**Spec:** `docs/superpowers/specs/2026-10-15-salesforce-team-kit-design.md` (approved). Read sections 3 to 6 and 8.4/8.4a before starting.

**Out of this plan:** the seven Salesforce skills (Plan 2) and the cloud office dashboard (Plan 3). Agent files already name the skills; they arrive in Plan 2.

## Global Constraints

- Node `>=20`. Installed code (`lib/`, `cli/`, `hooks/`) uses Node built-ins only: no npm dependencies.
- Every `.mjs` file starts with `// @ts-check` and uses JSDoc types, like the existing files.
- Work on branch `feature/sf-core`, created from `spec/salesforce-team-kit`. Never commit to `main`. Never force-push. Never push to `upstream` (its push URL is disabled on purpose).
- Agents work only in orgs listed under `orgs.sandbox` in `.team/team.json`. Production is never touched by any agent, including validate-only deploys.
- The Architect's internal id stays `planner`; its display name is `Architect`.
- Member ids: `planner`, `analyst`, `admin`, `developer`, `qa`, `reviewer`. Approver id: `jimmy`.
- Models: `developer` and `reviewer` use `opus`; `analyst`, `admin`, `qa` use `sonnet`.
- The guard blocks by printing the reason to stderr and exiting with code 2. It never prints an access token.
- `npm` in this environment: if `npm ci` fails with `EACCES` on `~/.npm`, use `npm ci --cache <scratch dir>/npm-cache`.
- Test command: `npx vitest run` (all) or `npx vitest run test/<file>` (one file). Lint: `npm run lint`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Status | Responsibility |
|---|---|---|
| `templates/team.json` | rewrite | Six roles, approver, `orgs.sandbox`, `orgSkill` |
| `lib/team.mjs` | modify | Parse and validate `orgs` and `orgSkill` |
| `lib/events.mjs` | modify | New event types `deploy`, `release`, `released`, `guard_blocked`; `task` on approvals |
| `cli/team-status.mjs` | modify | Subcommands `deploy`, `release`, `released`; `approval --task` |
| `lib/progress.mjs` | create | Role ids, builder test, task progress and stage |
| `lib/state.mjs` | modify | Fold deploys, releases, guard blocks, task tracking; derive progress |
| `lib/guard.mjs` | create | Shell splitting, unwrapping, `sf` classification, sandbox URL check, default org, cache |
| `hooks/guard-org.mjs` | create | PreToolUse hook: I/O around `lib/guard.mjs`, block output, `guard_blocked` event |
| `hooks/record.mjs` | modify | Export `describeBash` (no behaviour change) |
| `agents/{analyst,admin,developer,qa,reviewer}.md` | create | Subagent definitions |
| `agents/{backend,frontend,tester}.md` | delete | Web roles |
| `agents/reviewer.md` | rewrite | Salesforce reviewer |
| `planner/planner.md` | rewrite | Architect rules |
| `planner/work-order-template.md` | rewrite | Adds design decision and automation inventory |
| `templates/handoff-template.md` | rewrite | Adds sandbox deploy and "Org knowledge to add" |
| `templates/changeset-template.md` | create | The change set checklist |
| `templates/claude-team-section.md` | rewrite | Six-role team section for CLAUDE.md |
| `templates/hooks.json` | modify | Adds the PreToolUse guard hook |
| `lib/install/text.mjs` | modify | Kit hook marker covers both hooks; deny rules merge/remove |
| `lib/install/plan.mjs` | modify | Copy list, `.gitignore` block, deny rules |
| `lib/install/checks.mjs` | modify | `sf` and Code Analyzer checks; git and org skill helpers |
| `install.mjs` | modify | `git init` offer, new check message, org skill warning |
| `README.md`, `package.json` | rewrite/modify | Salesforce kit docs and name |
| `test/*.test.mjs` | create/modify | One test file per new module; updates to existing installer and state tests |

---

### Task 0: Branch and baseline

**Files:** none

- [ ] **Step 1: Create the work branch**

```bash
cd "/Users/jvo/Desktop/Claude-salesforce Project/salesforce-team-kit"
git checkout spec/salesforce-team-kit
git checkout -b feature/sf-core
```

- [ ] **Step 2: Install and run the baseline**

Run: `npm ci && npx vitest run`
Expected: `Test Files  16 passed (16)` and `Tests  297 passed (297)`. If `npm ci` fails with `EACCES`, re-run with `--cache` as in Global Constraints.

---

### Task 1: Team file with orgs and org skill

**Files:**
- Modify: `lib/team.mjs`
- Rewrite: `templates/team.json`
- Test: `test/team-orgs.test.mjs` (create)

**Interfaces:**
- Produces: `Team` gains `orgSkill: string | null` and `orgs: { sandbox: string[] }`. `loadTeam(file)` keeps its signature and return shape.

- [ ] **Step 1: Write the failing test**

Create `test/team-orgs.test.mjs`:

```js
import { test, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTeam } from '../lib/team.mjs';

const TEMPLATE = fileURLToPath(new URL('../templates/team.json', import.meta.url));
const base = {
  project: 'P',
  approver: { id: 'jimmy', name: 'Jimmy', role: 'Approver', color: '#ffb900' },
  members: [{ id: 'planner', name: 'Architect', role: 'Lead', color: '#6a5ae0' }],
};
let dir;
const load = (extra) => {
  const f = path.join(dir, 'team.json');
  fs.writeFileSync(f, JSON.stringify({ ...base, ...extra }));
  return loadTeam(f);
};
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sftk-team-')); });

test('orgs and orgSkill have empty defaults when absent', () => {
  const r = load({});
  expect(r.ok).toBe(true);
  expect(r.team.orgs).toEqual({ sandbox: [] });
  expect(r.team.orgSkill).toBeNull();
});

test('reads orgs.sandbox and orgSkill, trimming values', () => {
  const r = load({ orgs: { sandbox: [' uat ', 'dev'] }, orgSkill: ' nitro-salesforce ' });
  expect(r.team.orgs).toEqual({ sandbox: ['uat', 'dev'] });
  expect(r.team.orgSkill).toBe('nitro-salesforce');
});

test('an empty orgSkill means none', () => {
  expect(load({ orgSkill: '  ' }).team.orgSkill).toBeNull();
});

test('rejects bad orgs values', () => {
  expect(load({ orgs: [] })).toEqual({ ok: false, error: 'orgs must be an object' });
  expect(load({ orgs: { sandbox: 'uat' } })).toEqual({ ok: false, error: 'orgs.sandbox must be an array of non-empty strings' });
  expect(load({ orgs: { sandbox: ['uat', ''] } })).toEqual({ ok: false, error: 'orgs.sandbox must be an array of non-empty strings' });
});

test('rejects orgs.production: agents never work in production', () => {
  const r = load({ orgs: { sandbox: ['uat'], production: ['prod'] } });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/production/);
});

test('rejects a non-string orgSkill', () => {
  expect(load({ orgSkill: 3 })).toEqual({ ok: false, error: 'orgSkill must be a string' });
});

test('the shipped template loads with the six roles and the approver', () => {
  const r = loadTeam(TEMPLATE);
  expect(r.ok).toBe(true);
  expect(r.team.members.map((m) => m.id)).toEqual(['planner', 'analyst', 'admin', 'developer', 'qa', 'reviewer']);
  expect(r.team.members[0].name).toBe('Architect');
  expect(r.team.approver.id).toBe('jimmy');
  expect(r.team.orgs.sandbox.length).toBeGreaterThan(0);
  expect(r.team.orgSkill).toBe('my-org-knowledge');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/team-orgs.test.mjs`
Expected: FAIL (`orgs` is undefined; the template still has five web roles).

- [ ] **Step 3: Implement**

In `lib/team.mjs`, replace the `Team` typedef line with:

```js
/** @typedef {{ project: string, staleAfterMinutes: number, approver: Member, members: Member[], orgSkill: string | null, orgs: { sandbox: string[] } }} Team */
```

In `loadTeam`, insert this block directly before the line `const a = checkMember(raw.approver, 'approver');`:

```js
  /** @type {string | null} */
  let orgSkill = null;
  if ('orgSkill' in raw) {
    if (typeof raw.orgSkill !== 'string') return { ok: false, error: 'orgSkill must be a string' };
    orgSkill = raw.orgSkill.trim() || null;
  }
  /** @type {string[]} */
  let sandbox = [];
  if ('orgs' in raw) {
    const o = raw.orgs;
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: 'orgs must be an object' };
    if ('production' in o) {
      return { ok: false, error: 'orgs.production is not supported: agents never work in production. Remove it from .team/team.json.' };
    }
    if ('sandbox' in o) {
      if (!Array.isArray(o.sandbox) || !o.sandbox.every(nonEmpty)) {
        return { ok: false, error: 'orgs.sandbox must be an array of non-empty strings' };
      }
      sandbox = o.sandbox.map((/** @type {string} */ s) => s.trim());
    }
  }
```

Change the final return of `loadTeam` to:

```js
  return { ok: true, team: { project: raw.project, staleAfterMinutes, approver: a.member, members, orgSkill, orgs: { sandbox } } };
```

Replace the whole of `templates/team.json` with:

```json
{
  "project": "My Salesforce Project",
  "staleAfterMinutes": 5,
  "orgSkill": "my-org-knowledge",
  "orgs": { "sandbox": ["dev", "uat"] },
  "approver": { "id": "jimmy", "name": "Jimmy", "role": "Approves every Work Order and deploys to production", "color": "#ffb900" },
  "members": [
    { "id": "planner",   "name": "Architect", "role": "Designs the solution and runs the team", "color": "#6a5ae0" },
    { "id": "analyst",   "name": "Analyst",   "role": "Stories, acceptance criteria, UAT",      "color": "#f2a33a" },
    { "id": "admin",     "name": "Admin",     "role": "Flows, objects, permissions",            "color": "#12a37c" },
    { "id": "developer", "name": "Developer", "role": "Apex, LWC, integrations",                "color": "#2f86e8" },
    { "id": "qa",        "name": "QA",        "role": "Tests and verifies in the sandbox",      "color": "#e0559a" },
    { "id": "reviewer",  "name": "Reviewer",  "role": "Final check before release",             "color": "#6b7a90" }
  ]
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/team-orgs.test.mjs test/team.test.mjs`
Expected: PASS. Then run `npx vitest run`. The old `test/agents.test.mjs` fails now (it expects the web roles in the template); that file is rewritten in Task 9. Every other file passes.

- [ ] **Step 5: Commit**

```bash
git add lib/team.mjs templates/team.json test/team-orgs.test.mjs
git commit -m "Team file: six Salesforce roles, orgs.sandbox and orgSkill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: New event types

**Files:**
- Modify: `lib/events.mjs`
- Test: `test/events-salesforce.test.mjs` (create)

**Interfaces:**
- Produces: event types `deploy` (`agent`, `org`, `result` ∈ `DEPLOY_RESULTS`, optional `tests` like `"38/38"`, optional integer `coverage` 0–100, optional `task`), `release` (`task`, integer `components` ≥ 1, optional `file`), `released` (`task`, optional `note`), `guard_blocked` (`agent`, `reason`, optional `command`). `approval_requested` may carry an optional non-empty `task`. Export `DEPLOY_RESULTS = ['passed', 'failed']`.

- [ ] **Step 1: Write the failing test**

Create `test/events-salesforce.test.mjs`:

```js
import { test, expect } from 'vitest';
import { validateEvent, DEPLOY_RESULTS, EVENT_TYPES } from '../lib/events.mjs';

const ok = (e) => expect(validateEvent({ source: 'cli', ...e })).toEqual({ ok: true });
const bad = (e, msg) => {
  const r = validateEvent({ source: 'cli', ...e });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(msg);
};

test('lists the new types and deploy results', () => {
  for (const t of ['deploy', 'release', 'released', 'guard_blocked']) expect(EVENT_TYPES).toContain(t);
  expect(DEPLOY_RESULTS).toEqual(['passed', 'failed']);
});

test('deploy', () => {
  ok({ type: 'deploy', agent: 'admin', org: 'uat', result: 'passed' });
  ok({ type: 'deploy', agent: 'developer', org: 'uat', result: 'failed', tests: '37/38', coverage: 91, task: 'T-012' });
  bad({ type: 'deploy', agent: 'admin', org: 'uat' }, /result/);
  bad({ type: 'deploy', agent: 'admin', org: 'uat', result: 'ok' }, /result/);
  bad({ type: 'deploy', agent: 'admin', result: 'passed' }, /org/);
  bad({ type: 'deploy', agent: 'admin', org: 'uat', result: 'passed', coverage: 101 }, /coverage/);
  bad({ type: 'deploy', agent: 'admin', org: 'uat', result: 'passed', coverage: 9.5 }, /coverage/);
  bad({ type: 'deploy', agent: 'admin', org: 'uat', result: 'passed', tests: '38' }, /tests/);
});

test('release and released', () => {
  ok({ type: 'release', agent: 'planner', task: 'T-012', components: 9, file: 'docs/release/T-012-changeset.md' });
  bad({ type: 'release', agent: 'planner', task: 'T-012' }, /components/);
  bad({ type: 'release', agent: 'planner', task: 'T-012', components: 0 }, /components/);
  ok({ type: 'released', agent: 'planner', task: 'T-012' });
  bad({ type: 'released', agent: 'planner' }, /task/);
});

test('guard_blocked', () => {
  ok({ type: 'guard_blocked', agent: 'developer', reason: 'not a sandbox', command: 'Running sf project', source: 'hook' });
  bad({ type: 'guard_blocked', agent: 'developer', source: 'hook' }, /reason/);
});

test('approval_requested accepts an optional task', () => {
  ok({ type: 'approval_requested', id: 'WO-7-admin', summary: 's', task: 'T-012' });
  bad({ type: 'approval_requested', id: 'WO-7-admin', summary: 's', task: ' ' }, /task/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/events-salesforce.test.mjs`
Expected: FAIL (`unknown type: deploy`, `DEPLOY_RESULTS` undefined).

- [ ] **Step 3: Implement**

In `lib/events.mjs`, replace the `EVENT_TYPES` export with:

```js
/** @type {readonly string[]} */
export const EVENT_TYPES = Object.freeze(['agent_start', 'agent_stop', 'tool_use', 'status', 'task',
  'approval_requested', 'approval_decided', 'handoff', 'escalation', 'snapshot',
  'deploy', 'release', 'released', 'guard_blocked']);
/** @type {readonly string[]} */
export const DEPLOY_RESULTS = Object.freeze(['passed', 'failed']);
```

Add to the `REQUIRED` object (after `snapshot: [],`):

```js
  deploy: ['agent', 'org'],
  release: ['task'],
  released: ['task'],
  guard_blocked: ['agent', 'reason'],
```

Add these cases inside the `switch (e.type)` in `validateEvent`, before `default:`:

```js
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
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/events-salesforce.test.mjs test/events.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/events.mjs test/events-salesforce.test.mjs
git commit -m "Events: deploy, release, released, guard_blocked; task on approvals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: CLI subcommands

**Files:**
- Modify: `cli/team-status.mjs`
- Test: `test/cli-salesforce.test.mjs` (create)

**Interfaces:**
- Consumes: event types from Task 2.
- Produces: `team-status deploy --agent <id> --org <alias> --result <passed|failed> [--tests <p>/<t>] [--coverage <0-100>] [--task <id>]`, `team-status release --task <id> --components <n> [--file <path>]` (default file `docs/release/<task>-changeset.md`), `team-status released --task <id> [--note <text>]`, `team-status approval ... [--task <id>]`.

- [ ] **Step 1: Write the failing test**

Create `test/cli-salesforce.test.mjs`:

```js
import { test, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../cli/team-status.mjs';

const NOW = new Date('2026-10-15T12:00:00.000Z');
let root;
let errs;
const lines = () => {
  const f = path.join(root, '.team', 'events.jsonl');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const run = (argv) => main(argv, { cwd: root, env: { CLAUDE_PROJECT_DIR: root }, now: NOW, stderr: (s) => errs.push(s) });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sftk-cli-'));
  fs.mkdirSync(path.join(root, '.team'));
  errs = [];
});

test('deploy writes the event with numeric coverage', () => {
  expect(run(['deploy', '--agent', 'developer', '--org', 'uat', '--result', 'passed', '--tests', '38/38', '--coverage', '92', '--task', 'T-012'])).toBe(0);
  expect(lines()).toEqual([{ type: 'deploy', source: 'cli', agent: 'developer', org: 'uat', result: 'passed', tests: '38/38', coverage: 92, task: 'T-012', time: NOW.toISOString() }]);
});

test('deploy rejects a bad result, bad coverage and bad tests', () => {
  expect(run(['deploy', '--agent', 'admin', '--org', 'uat', '--result', 'ok'])).toBe(2);
  expect(run(['deploy', '--agent', 'admin', '--org', 'uat', '--result', 'passed', '--coverage', 'x'])).toBe(2);
  expect(run(['deploy', '--agent', 'admin', '--org', 'uat', '--result', 'passed', '--coverage', '120'])).toBe(2);
  expect(run(['deploy', '--agent', 'admin', '--org', 'uat', '--result', 'passed', '--tests', 'all'])).toBe(2);
  expect(lines()).toEqual([]);
});

test('release defaults the file and is written by planner', () => {
  expect(run(['release', '--task', 'T-012', '--components', '9'])).toBe(0);
  expect(lines()[0]).toMatchObject({ type: 'release', agent: 'planner', task: 'T-012', components: 9, file: 'docs/release/T-012-changeset.md' });
});

test('release needs at least one component', () => {
  expect(run(['release', '--task', 'T-012', '--components', '0'])).toBe(2);
  expect(run(['release', '--task', 'T-012'])).toBe(2);
});

test('released', () => {
  expect(run(['released', '--task', 'T-012', '--note', 'Deployed 18:00'])).toBe(0);
  expect(lines()[0]).toMatchObject({ type: 'released', agent: 'planner', task: 'T-012', note: 'Deployed 18:00' });
});

test('approval accepts --task', () => {
  expect(run(['approval', '--id', 'WO-7-admin', '--summary', 'Flow', '--agents', 'admin', '--task', 'T-012'])).toBe(0);
  expect(lines()[0]).toMatchObject({ type: 'approval_requested', id: 'WO-7-admin', agents: ['admin'], task: 'T-012' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli-salesforce.test.mjs`
Expected: FAIL (`unknown subcommand: deploy`).

- [ ] **Step 3: Implement**

In `cli/team-status.mjs`, change the `approval` entry of `COMMANDS` to:

```js
  approval: {
    usage: 'approval --id <id> --summary <text> [--agents a,b] [--task <id>]',
    required: ['id', 'summary'],
    optional: ['agents', 'task'],
    build: (v) => ({
      type: 'approval_requested', agent: 'planner', id: v.id, summary: v.summary, task: v.task,
      agents: v.agents === undefined ? undefined : String(v.agents).split(',').map((s) => s.trim()).filter(Boolean),
    }),
  },
```

Add three entries to `COMMANDS` after `escalate`:

```js
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
```

In `main`, directly after the existing `if (values.progress !== undefined) { ... }` block, add:

```js
  for (const k of ['coverage', 'components']) {
    if (values[k] === undefined) continue;
    if (!/^\d+$/.test(values[k])) return fail(`--${k} must be a whole number. ${usage}`);
    values[k] = Number(values[k]);
  }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/cli-salesforce.test.mjs test/cli.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/team-status.mjs test/cli-salesforce.test.mjs
git commit -m "CLI: deploy, release, released subcommands; approval --task

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Task progress module

**Files:**
- Create: `lib/progress.mjs`
- Test: `test/progress.test.mjs` (create)

**Interfaces:**
- Produces:
  - `ROLES = { architect: 'planner', analyst: 'analyst', qa: 'qa', reviewer: 'reviewer' }`
  - `isBuilder(id: string, approverId: string): boolean`
  - `emptyTrack(): { deployed: boolean, qaPassed: boolean, reviewed: boolean, back: boolean }`
  - `taskProgress(task: { id: string, state: string }, acc: { approvals: { task: string|null, state: string }[], releases: { task: string, state: 'ready'|'released' }[], taskTrack: Record<string, Track> }, agents: { id: string, currentTask: string|null, progress: number }[], approverId: string): { progress: number, stage: string }`

- [ ] **Step 1: Write the failing test**

Create `test/progress.test.mjs`:

```js
import { test, expect } from 'vitest';
import { taskProgress, isBuilder, emptyTrack, ROLES } from '../lib/progress.mjs';

const task = { id: 'T-012', state: 'in_progress' };
const acc = (o = {}) => ({ approvals: [], releases: [], taskTrack: {}, ...o });
const approved = [{ task: 'T-012', state: 'approved' }, { task: 'T-012', state: 'approved' }];
const p = (a, agents = [], t = task) => taskProgress(t, a, agents, 'jimmy');

test('roles and builders', () => {
  expect(ROLES).toEqual({ architect: 'planner', analyst: 'analyst', qa: 'qa', reviewer: 'reviewer' });
  for (const id of ['admin', 'developer']) expect(isBuilder(id, 'jimmy')).toBe(true);
  for (const id of ['planner', 'analyst', 'qa', 'reviewer', 'jimmy', 'team', '']) expect(isBuilder(id, 'jimmy')).toBe(false);
  expect(emptyTrack()).toEqual({ deployed: false, qaPassed: false, reviewed: false, back: false });
});

test('a new task is 5% To do', () => {
  expect(p(acc())).toEqual({ progress: 5, stage: 'To do' });
});

test('a pending approval for the task is 20%', () => {
  expect(p(acc({ approvals: [{ task: 'T-012', state: 'pending' }, { task: 'T-012', state: 'approved' }] })))
    .toEqual({ progress: 20, stage: 'Waiting for approval' });
});

test('approvals for other tasks do not count', () => {
  expect(p(acc({ approvals: [{ task: 'T-099', state: 'pending' }, { task: null, state: 'approved' }] })))
    .toEqual({ progress: 5, stage: 'To do' });
});

test('all approved: 30% plus 30% of the builders\' average progress', () => {
  expect(p(acc({ approvals: approved }))).toEqual({ progress: 30, stage: 'Building' });
  const agents = [
    { id: 'admin', currentTask: 'T-012', progress: 60 },
    { id: 'developer', currentTask: 'T-012', progress: 40 },
    { id: 'qa', currentTask: 'T-012', progress: 100 },
    { id: 'admin2', currentTask: 'T-099', progress: 100 },
  ];
  expect(p(acc({ approvals: approved }), agents)).toEqual({ progress: 45, stage: 'Building' });
});

test('milestones in order', () => {
  const t = (o) => ({ 'T-012': { ...emptyTrack(), ...o } });
  expect(p(acc({ approvals: approved, taskTrack: t({ deployed: true }) }))).toEqual({ progress: 65, stage: 'In sandbox' });
  expect(p(acc({ taskTrack: t({ deployed: true, qaPassed: true }) }))).toEqual({ progress: 80, stage: 'QA passed' });
  expect(p(acc({ taskTrack: t({ qaPassed: true, reviewed: true }) }))).toEqual({ progress: 90, stage: 'Review passed' });
  expect(p(acc({ releases: [{ task: 'T-012', state: 'ready' }] }))).toEqual({ progress: 95, stage: 'Change set ready' });
  expect(p(acc({ releases: [{ task: 'T-012', state: 'released' }] }))).toEqual({ progress: 100, stage: 'Released' });
});

test('sent back to the builder shows Back to build', () => {
  const a = acc({ approvals: approved, taskTrack: { 'T-012': { ...emptyTrack(), back: true } } });
  expect(p(a, [{ id: 'developer', currentTask: 'T-012', progress: 80 }])).toEqual({ progress: 54, stage: 'Back to build' });
});

test('a done task without a release is 100% Done', () => {
  expect(p(acc(), [], { id: 'T-012', state: 'done' })).toEqual({ progress: 100, stage: 'Done' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/progress.test.mjs`
Expected: FAIL (cannot find module `../lib/progress.mjs`).

- [ ] **Step 3: Implement**

Create `lib/progress.mjs`:

```js
// @ts-check
// Task progress for the dashboard: a percentage and a stage label worked out from events
// (spec 8.4a). It reflects where a task is in the pipeline and goes down when work is sent back.

/** Role ids the progress rules depend on. Every other member except the approver is a builder. */
export const ROLES = Object.freeze({ architect: 'planner', analyst: 'analyst', qa: 'qa', reviewer: 'reviewer' });
const NOT_BUILDERS = new Set([...Object.values(ROLES), 'team']);

/**
 * @param {string} id
 * @param {string} approverId
 * @returns {boolean}
 */
export const isBuilder = (id, approverId) => Boolean(id) && !NOT_BUILDERS.has(id) && id !== approverId;

/** @typedef {{ deployed: boolean, qaPassed: boolean, reviewed: boolean, back: boolean }} Track */

/** @returns {Track} */
export const emptyTrack = () => ({ deployed: false, qaPassed: false, reviewed: false, back: false });

/**
 * @param {{ id: string, state: string }} task
 * @param {{ approvals: { task: string|null, state: string }[], releases: { task: string, state: string }[], taskTrack: Record<string, Track> }} acc
 * @param {{ id: string, currentTask: string|null, progress: number }[]} agents
 * @param {string} approverId
 * @returns {{ progress: number, stage: string }}
 */
export function taskProgress(task, acc, agents, approverId) {
  const release = acc.releases.find((r) => r.task === task.id);
  if (release?.state === 'released') return { progress: 100, stage: 'Released' };
  if (task.state === 'done') return { progress: 100, stage: 'Done' };
  if (release?.state === 'ready') return { progress: 95, stage: 'Change set ready' };
  const t = acc.taskTrack[task.id] ?? emptyTrack();
  if (t.reviewed) return { progress: 90, stage: 'Review passed' };
  if (t.qaPassed) return { progress: 80, stage: 'QA passed' };
  if (t.deployed) return { progress: 65, stage: 'In sandbox' };
  const approvals = acc.approvals.filter((a) => a.task === task.id);
  if (approvals.length > 0 && approvals.every((a) => a.state === 'approved')) {
    const builders = agents.filter((a) => a.currentTask === task.id && isBuilder(a.id, approverId));
    const avg = builders.length === 0 ? 0 : builders.reduce((sum, a) => sum + a.progress, 0) / builders.length;
    return { progress: 30 + Math.round(avg * 0.3), stage: t.back ? 'Back to build' : 'Building' };
  }
  if (approvals.some((a) => a.state === 'pending')) return { progress: 20, stage: 'Waiting for approval' };
  return { progress: 5, stage: 'To do' };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/progress.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/progress.mjs test/progress.test.mjs
git commit -m "Task progress from pipeline milestones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: State engine: deploys, releases, guard blocks, progress

**Files:**
- Modify: `lib/state.mjs`
- Modify: `test/state.test.mjs:52` (one expectation)
- Test: `test/state-salesforce.test.mjs` (create)

**Interfaces:**
- Consumes: `taskProgress`, `isBuilder`, `emptyTrack`, `ROLES` from Task 4; event types from Task 2.
- Produces: `buildState(...)` returns, in addition to today's fields: `deploys: { org, agent, result, tests, coverage, task, time }[]` (latest per org), `releases: { task, state: 'ready'|'released', components, file, time }[]`, `guardBlocks: { agent, command, reason, time }[]` (last 10), and every task gains `progress: number` and `stage: string`. Approvals gain `task: string | null`.

- [ ] **Step 1: Write the failing test**

Create `test/state-salesforce.test.mjs`:

```js
import { test, expect } from 'vitest';
import { buildState, foldEvents, GUARD_CAP } from '../lib/state.mjs';

const team = {
  project: 'P', staleAfterMinutes: 5, orgSkill: null, orgs: { sandbox: ['uat'] },
  approver: { id: 'jimmy', name: 'Jimmy', role: 'Approver', color: '#ffb900' },
  members: ['planner', 'analyst', 'admin', 'developer', 'qa', 'reviewer'].map((id) => ({ id, name: id, role: id, color: '#aabbcc' })),
};
const now = new Date('2026-10-15T18:00:00Z');
let n = 0;
const ev = (e) => ({ source: 'cli', time: new Date(Date.UTC(2026, 9, 15, 9, n++)).toISOString(), ...e });
const state = (events) => buildState(events, team, now);
const task = (state_ = 'in_progress') => ev({ type: 'task', agent: 'planner', id: 'T-012', title: 'Discount', owner: 'admin', state: state_ });

test('deploys keep the latest result per org and log a line', () => {
  const s = state([
    ev({ type: 'deploy', agent: 'admin', org: 'uat', result: 'failed' }),
    ev({ type: 'deploy', agent: 'developer', org: 'uat', result: 'passed', tests: '38/38', coverage: 92, task: 'T-012' }),
    ev({ type: 'deploy', agent: 'admin', org: 'dev', result: 'passed' }),
  ]);
  expect(s.deploys.map((d) => [d.org, d.agent, d.result])).toEqual([['uat', 'developer', 'passed'], ['dev', 'admin', 'passed']]);
  expect(s.deploys[0]).toMatchObject({ tests: '38/38', coverage: 92, task: 'T-012' });
  expect(s.agentLogs.developer.at(-1).event).toBe('Deployed to uat: passed, 38/38 tests, 92% coverage');
});

test('release then released', () => {
  const s1 = state([task(), ev({ type: 'release', agent: 'planner', task: 'T-012', components: 9, file: 'docs/release/T-012-changeset.md' })]);
  expect(s1.releases).toEqual([expect.objectContaining({ task: 'T-012', state: 'ready', components: 9, file: 'docs/release/T-012-changeset.md' })]);
  expect(s1.tasks[0]).toMatchObject({ progress: 95, stage: 'Change set ready' });
  const s2 = state([task(), ev({ type: 'release', agent: 'planner', task: 'T-012', components: 9 }), ev({ type: 'released', agent: 'planner', task: 'T-012' })]);
  expect(s2.releases[0].state).toBe('released');
  expect(s2.tasks[0]).toMatchObject({ progress: 100, stage: 'Released' });
});

test('guard blocks keep the last GUARD_CAP entries', () => {
  const events = Array.from({ length: GUARD_CAP + 3 }, (_, i) =>
    ev({ type: 'guard_blocked', agent: 'developer', command: `Running sf ${i}`, reason: `r${i}`, source: 'hook' }));
  const s = state(events);
  expect(s.guardBlocks).toHaveLength(GUARD_CAP);
  expect(s.guardBlocks.at(-1)).toMatchObject({ agent: 'developer', command: `Running sf ${GUARD_CAP + 2}`, reason: `r${GUARD_CAP + 2}` });
  expect(s.agentLogs.developer.at(-1).event).toBe(`Guard blocked: r${GUARD_CAP + 2}`);
});

test('approvals record their task', () => {
  const s = state([ev({ type: 'approval_requested', agent: 'planner', id: 'WO-7-admin', summary: 'Flow', agents: ['admin'], task: 'T-012' })]);
  expect(s.approvals[0].task).toBe('T-012');
});

test('progress follows the pipeline, including a QA bounce-back', () => {
  const base = [
    task(),
    ev({ type: 'approval_requested', agent: 'planner', id: 'WO-7-admin', summary: 'Flow', agents: ['admin'], task: 'T-012' }),
  ];
  expect(state(base).tasks[0]).toMatchObject({ progress: 20, stage: 'Waiting for approval' });
  const approvedEvents = [...base, ev({ type: 'approval_decided', agent: 'planner', id: 'WO-7-admin', state: 'approved' }),
    ev({ type: 'status', agent: 'admin', status: 'working', task: 'T-012', progress: 50 })];
  expect(state(approvedEvents).tasks[0]).toMatchObject({ progress: 45, stage: 'Building' });
  const deployed = [...approvedEvents, ev({ type: 'deploy', agent: 'admin', org: 'uat', result: 'passed', task: 'T-012' })];
  expect(state(deployed).tasks[0]).toMatchObject({ progress: 65, stage: 'In sandbox' });
  const bounced = [...deployed, ev({ type: 'handoff', agent: 'qa', from: 'qa', to: 'admin', task: 'T-012' })];
  expect(state(bounced).tasks[0]).toMatchObject({ progress: 45, stage: 'Back to build' });
  const passed = [...bounced, ev({ type: 'deploy', agent: 'admin', org: 'uat', result: 'passed', task: 'T-012' }),
    ev({ type: 'handoff', agent: 'qa', from: 'qa', to: 'reviewer', task: 'T-012' })];
  expect(state(passed).tasks[0]).toMatchObject({ progress: 80, stage: 'QA passed' });
  const reviewed = [...passed, ev({ type: 'handoff', agent: 'reviewer', from: 'reviewer', to: 'planner', task: 'T-012' })];
  expect(state(reviewed).tasks[0]).toMatchObject({ progress: 90, stage: 'Review passed' });
});

test('a failed deploy does not move progress', () => {
  const s = state([task(), ev({ type: 'deploy', agent: 'admin', org: 'uat', result: 'failed', task: 'T-012' })]);
  expect(s.tasks[0]).toMatchObject({ progress: 5, stage: 'To do' });
});

test('a snapshot keeps the new folded fields', () => {
  const events = [
    task(),
    ev({ type: 'deploy', agent: 'admin', org: 'uat', result: 'passed', task: 'T-012' }),
    ev({ type: 'release', agent: 'planner', task: 'T-012', components: 3 }),
    ev({ type: 'guard_blocked', agent: 'developer', reason: 'r', source: 'hook' }),
  ];
  const snap = { type: 'snapshot', source: 'server', time: now.toISOString(), state: foldEvents(events, team) };
  const fromSnap = buildState([snap], team, now);
  expect(fromSnap).toEqual(state(events));
  expect(fromSnap.deploys).toHaveLength(1);
  expect(fromSnap.tasks[0].stage).toBe('Change set ready');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/state-salesforce.test.mjs`
Expected: FAIL (`GUARD_CAP` is not exported; `s.deploys` undefined).

- [ ] **Step 3: Implement**

In `lib/state.mjs`:

1. Add the import at the top, after the typedef comment block's first line (`// @ts-check` stays first):

```js
import { taskProgress, isBuilder, emptyTrack, ROLES } from './progress.mjs';
```

2. Replace the `Approval` typedef with:

```js
/** @typedef {{ id: string, requestedBy: string, summary: string, state: string, requestedAt: string, decidedAt: string|null, note: string, agents: string[], task: string|null }} Approval */
/** @typedef {{ org: string, agent: string, result: string, tests: string|null, coverage: number|null, task: string|null, time: string }} Deploy */
/** @typedef {{ task: string, state: 'ready'|'released', components: number, file: string|null, time: string }} Release */
/** @typedef {{ agent: string, command: string, reason: string, time: string }} GuardBlock */
```

3. Add these properties to the `Folded` typedef (after `escalations`):

```js
 * @property {Deploy[]} deploys latest deploy per org
 * @property {Release[]} releases
 * @property {GuardBlock[]} guardBlocks last GUARD_CAP blocks
 * @property {Record<string, import('./progress.mjs').Track>} taskTrack milestones per task id
```

4. After `export const HANDOFF_CAP = 20;` add `export const GUARD_CAP = 10;`.

5. Replace `emptyFolded` with:

```js
/** @returns {Folded} */
function emptyFolded() {
  return { agents: [], approvals: [], tasks: [], log: [], agentLogs: {}, handoffs: [], escalations: [],
    deploys: [], releases: [], guardBlocks: [], taskTrack: {} };
}
```

6. In `describe(e)`, add before `default:`:

```js
    case 'deploy': {
      const tests = e.tests ? `, ${e.tests} tests` : '';
      const coverage = e.coverage !== undefined ? `, ${e.coverage}% coverage` : '';
      return `Deployed to ${e.org}: ${e.result}${tests}${coverage}`;
    }
    case 'release': return `Change set ready for ${e.task} (${e.components} components)`;
    case 'released': return `Released ${e.task} to production`;
    case 'guard_blocked': return `Guard blocked: ${e.reason}`;
```

7. In `foldEvents`, after the `touch` helper, add:

```js
  /** @param {string} id */
  const track = (id) => (acc.taskTrack[id] ??= emptyTrack());
```

8. In the `approval_requested` case, change the `approval` object to include the task:

```js
        const approval = { id: e.id, requestedBy, summary: e.summary, state: 'pending', requestedAt: time,
          decidedAt: null, note: '', agents, task: typeof e.task === 'string' ? e.task : null };
```

9. Replace the `handoff` case with:

```js
      case 'handoff': {
        touch(norm(e.from), time, line);
        const from = norm(e.from);
        const to = norm(e.to);
        acc.handoffs.push({ from, to, task: e.task, time });
        if (acc.handoffs.length > HANDOFF_CAP) acc.handoffs.splice(0, acc.handoffs.length - HANDOFF_CAP);
        const t = track(e.task);
        if (from === ROLES.qa && to === ROLES.reviewer) t.qaPassed = true;
        else if (from === ROLES.reviewer && to === ROLES.architect) t.reviewed = true;
        else if ((from === ROLES.qa || from === ROLES.reviewer) && isBuilder(to, approverId)) {
          Object.assign(t, { deployed: false, qaPassed: false, reviewed: false, back: true });
        }
        break;
      }
```

10. Add these cases before `default:` in the `foldEvents` switch:

```js
      case 'deploy': {
        touch(who, time, line);
        /** @type {Deploy} */
        const d = { org: e.org, agent: who, result: e.result, tests: e.tests ?? null, coverage: e.coverage ?? null, task: e.task ?? null, time };
        acc.deploys = [...acc.deploys.filter((x) => x.org !== d.org), d];
        if (d.task && d.result === 'passed') track(d.task).deployed = true;
        break;
      }
      case 'release': {
        touch(who || ROLES.architect, time, line);
        /** @type {Release} */
        const r = { task: e.task, state: 'ready', components: e.components, file: e.file ?? null, time };
        acc.releases = [...acc.releases.filter((x) => x.task !== r.task), r];
        break;
      }
      case 'released': {
        touch(who || ROLES.architect, time, line);
        const r = acc.releases.find((x) => x.task === e.task);
        if (r) { r.state = 'released'; r.time = time; }
        else acc.releases.push({ task: e.task, state: 'released', components: 0, file: null, time });
        break;
      }
      case 'guard_blocked': {
        touch(who, time, line);
        acc.guardBlocks.push({ agent: who, command: typeof e.command === 'string' ? e.command : '', reason: e.reason, time });
        if (acc.guardBlocks.length > GUARD_CAP) acc.guardBlocks.splice(0, acc.guardBlocks.length - GUARD_CAP);
        break;
      }
```

11. In `derive`, replace `tasks: acc.tasks,` in the returned object with:

```js
    tasks: acc.tasks.map((t) => ({ ...t, ...taskProgress(t, acc, acc.agents, team.approver.id) })),
    deploys: acc.deploys,
    releases: acc.releases,
    guardBlocks: acc.guardBlocks,
```

12. In `test/state.test.mjs` line 52, change the expectation to include progress:

```js
  expect(closed.tasks).toEqual([{ id: 'T-004', title: 'Pricing', owner: 'backend', state: 'done', notes: '', progress: 100, stage: 'Done' }]);
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/state-salesforce.test.mjs test/state.test.mjs test/server.test.mjs test/rotate.test.mjs`
Expected: PASS. If a server or rotate test compares a whole state object and fails only because of the new keys `deploys`, `releases`, `guardBlocks`, `taskTrack` or the task `progress`/`stage`, add those keys with the values the failure shows; do not change any other expectation.

- [ ] **Step 5: Commit**

```bash
git add lib/state.mjs test/state-salesforce.test.mjs test/state.test.mjs
git commit -m "State: deploys, releases, guard blocks and task progress

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Guard: shell splitting and unwrapping

**Files:**
- Create: `lib/guard.mjs`
- Test: `test/guard-shell.test.mjs` (create)

**Interfaces:**
- Produces:
  - `splitCommands(command: string): string[][]`: simple commands (split on `;` `&` `|` newlines and parentheses/braces, outside quotes), quotes removed, redirect targets dropped; the contents of `$(…)` and backticks come back as extra commands at the end.
  - `unwrap(words: string[]): { kind: 'program', program: string, args: string[] } | { kind: 'inline', text: string } | { kind: 'script', file: string } | { kind: 'opaque', what: string, text: string } | null`

- [ ] **Step 1: Write the failing test**

Create `test/guard-shell.test.mjs`:

```js
import { test, expect } from 'vitest';
import { splitCommands, unwrap } from '../lib/guard.mjs';

test('splits on control operators outside quotes', () => {
  expect(splitCommands('cd x && sf org list; git status | head -5 & echo "a && b"')).toEqual([
    ['cd', 'x'], ['sf', 'org', 'list'], ['git', 'status'], ['head', '-5'], ['echo', 'a && b'],
  ]);
});

test('keeps quoted words whole and handles escapes', () => {
  expect(splitCommands(`sf data query -q "SELECT Id FROM Account WHERE Name = 'A;B'" -o uat`)).toEqual([
    ['sf', 'data', 'query', '-q', "SELECT Id FROM Account WHERE Name = 'A;B'", '-o', 'uat'],
  ]);
  expect(splitCommands('echo a\\ b')).toEqual([['echo', 'a b']]);
});

test('subshells and groups split; redirect targets are dropped', () => {
  expect(splitCommands('(cd x && sf org list) > out.txt 2>&1')).toEqual([['cd', 'x'], ['sf', 'org', 'list'], ['2']]);
  expect(splitCommands('{ sf org list; }')).toEqual([['sf', 'org', 'list']]);
});

test('command substitution is returned as extra commands', () => {
  expect(splitCommands('echo $(sf org list -o prod) `sf alias list`')).toEqual([
    ['echo', '$(…)', '$(…)'], ['sf', 'org', 'list', '-o', 'prod'], ['sf', 'alias', 'list'],
  ]);
});

test('${VAR} stays inside its word', () => {
  expect(splitCommands('sf project deploy start -o ${ORG}')).toEqual([['sf', 'project', 'deploy', 'start', '-o', '${ORG}']]);
});

test('unwrap skips env assignments and pass-through wrappers', () => {
  expect(unwrap(['FOO=1', 'sf', 'org', 'list'])).toEqual({ kind: 'program', program: 'sf', args: ['org', 'list'] });
  expect(unwrap(['env', '-i', 'npx', 'sf', 'org', 'list'])).toEqual({ kind: 'program', program: 'sf', args: ['org', 'list'] });
  expect(unwrap(['time', '/usr/local/bin/sf', 'org', 'list'])).toEqual({ kind: 'program', program: 'sf', args: ['org', 'list'] });
  expect(unwrap(['A=1'])).toBeNull();
});

test('unwrap finds inline shells, eval, scripts and xargs', () => {
  expect(unwrap(['bash', '-c', 'sf org list -o prod'])).toEqual({ kind: 'inline', text: 'sf org list -o prod' });
  expect(unwrap(['eval', 'sf', 'org', 'list'])).toEqual({ kind: 'inline', text: 'sf org list' });
  expect(unwrap(['bash', 'scripts/deploy.sh'])).toEqual({ kind: 'script', file: 'scripts/deploy.sh' });
  expect(unwrap(['./deploy.sh', 'uat'])).toEqual({ kind: 'script', file: './deploy.sh' });
  expect(unwrap(['source', 'env.sh'])).toEqual({ kind: 'script', file: 'env.sh' });
  expect(unwrap(['xargs', 'sf', 'org', 'list'])).toEqual({ kind: 'opaque', what: 'xargs', text: 'sf org list' });
  expect(unwrap(['/usr/bin/git', 'status'])).toEqual({ kind: 'program', program: 'git', args: ['status'] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/guard-shell.test.mjs`
Expected: FAIL (cannot find module `../lib/guard.mjs`).

- [ ] **Step 3: Implement**

Create `lib/guard.mjs`:

```js
// @ts-check
// Decision logic for the org guard (hooks/guard-org.mjs). Pure functions: all I/O comes in
// through the GuardCtx functions, so every rule can be tested without Salesforce.

/** @param {string} w */
const baseName = (w) => (w.includes('/') ? w.split('/').filter(Boolean).pop() || w : w);

/**
 * Split a shell command into simple commands, each a list of words with quotes removed.
 * Splits on ; & | newlines ( ) { } outside quotes. Redirect targets are dropped.
 * The text inside $( ) and backticks is split too and appended at the end.
 * @param {string} command
 * @returns {string[][]}
 */
export function splitCommands(command) {
  /** @type {string[][]} */ const out = [];
  /** @type {string[]} */ const inner = [];
  /** @type {string[]} */ let words = [];
  let word = '';
  let inWord = false;
  let quote = '';
  let dropNext = false;
  const endWord = () => {
    if (inWord) {
      if (dropNext) dropNext = false;
      else words.push(word);
    }
    word = '';
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) out.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") quote = '';
      else word += c;
      continue;
    }
    if (c === '$' && command[i + 1] === '(') {
      let depth = 1;
      let j = i + 2;
      while (j < command.length && depth > 0) {
        if (command[j] === '(') depth++;
        else if (command[j] === ')') depth--;
        j++;
      }
      inner.push(command.slice(i + 2, depth === 0 ? j - 1 : j));
      word += '$(…)';
      inWord = true;
      i = j - 1;
      continue;
    }
    if (c === '`') {
      const j = command.indexOf('`', i + 1);
      const end = j === -1 ? command.length : j;
      inner.push(command.slice(i + 1, end));
      word += '$(…)';
      inWord = true;
      i = end;
      continue;
    }
    if (c === '$' && command[i + 1] === '{') {
      const j = command.indexOf('}', i);
      const end = j === -1 ? command.length - 1 : j;
      word += command.slice(i, end + 1);
      inWord = true;
      i = end;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = '';
      else if (c === '\\' && i + 1 < command.length) word += command[++i];
      else word += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; inWord = true; continue; }
    if (c === '\\' && i + 1 < command.length) { word += command[++i]; inWord = true; continue; }
    if (c === '>' || c === '<') {
      endWord();
      while (command[i + 1] === '>' || command[i + 1] === '<') i++;
      if (command[i + 1] === '&') {
        i++;
        while (/\d/.test(command[i + 1] ?? '')) i++;
        continue;
      }
      dropNext = true;
      continue;
    }
    if (';&|\n\r(){}'.includes(c)) { endCommand(); continue; }
    if (/\s/.test(c)) { endWord(); continue; }
    word += c;
    inWord = true;
  }
  endCommand();
  for (const text of inner) out.push(...splitCommands(text));
  return out;
}

const PASS_THROUGH = new Set(['env', 'sudo', 'time', 'nice', 'nohup', 'command', 'exec', 'npx', 'builtin']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const SCRIPT_FILE = /^\.\.?\/|\.(sh|bash|zsh)$/;

/**
 * What a simple command really runs.
 * @param {string[]} words
 * @returns {{ kind: 'program', program: string, args: string[] } | { kind: 'inline', text: string } | { kind: 'script', file: string } | { kind: 'opaque', what: string, text: string } | null}
 */
export function unwrap(words) {
  let w = words.filter((x) => x !== '');
  for (;;) {
    while (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) w = w.slice(1);
    if (w.length === 0) return null;
    const prog = baseName(w[0]);
    if (PASS_THROUGH.has(prog)) {
      w = w.slice(1);
      while (w.length && w[0].startsWith('-')) w = w.slice(1);
      continue;
    }
    if (prog === 'eval') return { kind: 'inline', text: w.slice(1).join(' ') };
    if (SHELLS.has(prog)) {
      const c = w.indexOf('-c');
      if (c !== -1) return { kind: 'inline', text: w[c + 1] ?? '' };
      const file = w.slice(1).find((x) => !x.startsWith('-'));
      return file ? { kind: 'script', file } : null;
    }
    if (prog === 'source' || prog === '.') return w[1] ? { kind: 'script', file: w[1] } : null;
    if (prog === 'xargs') return { kind: 'opaque', what: 'xargs', text: w.slice(1).join(' ') };
    if (prog !== 'sf' && prog !== 'sfdx' && SCRIPT_FILE.test(w[0])) return { kind: 'script', file: w[0] };
    return { kind: 'program', program: prog, args: w.slice(1) };
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/guard-shell.test.mjs && npm run lint`
Expected: PASS, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add lib/guard.mjs test/guard-shell.test.mjs
git commit -m "Guard: split shell commands and unwrap wrappers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Guard: sf rules, sandbox check, default org, cache

**Files:**
- Modify: `lib/guard.mjs`
- Test: `test/guard-rules.test.mjs` (create)

**Interfaces:**
- Consumes: `splitCommands`, `unwrap` (Task 6).
- Produces:
  - `type Decision = { allow: true } | { allow: false, reason: string }`
  - `type GuardCtx = { sandboxes: string[] | null, teamError?: string, defaultOrg: () => string | null, instanceUrl: (alias: string) => string | null, readScript: (file: string) => string | null }`
  - `isSandboxUrl(url: string): boolean`
  - `checkSf(args: string[], ctx: GuardCtx): Decision`
  - `decide(command: string, ctx: GuardCtx, depth?: number): Decision`
  - `readDefaultOrg(o: { projectDir: string, homeDir: string, readFile: (file: string) => string | null }): string | null`
  - `CACHE_TTL_MS = 86400000`
  - `cachedInstanceUrl(alias: string, o: { cache: Record<string, { url: string, at: string }>, now: Date, lookup: (alias: string) => string | null }): { url: string | null, cache: Record<string, { url: string, at: string }> }` (returns the same `cache` object when nothing changed)

- [ ] **Step 1: Write the failing test**

Create `test/guard-rules.test.mjs`:

```js
import { describe, test, expect } from 'vitest';
import { decide, checkSf, isSandboxUrl, readDefaultOrg, cachedInstanceUrl, CACHE_TTL_MS } from '../lib/guard.mjs';

const URLS = {
  uat: 'https://acme--uat.sandbox.my.salesforce.com',
  dev: 'https://acme--dev.sandbox.my.salesforce.com',
  sneaky: 'https://acme.my.salesforce.com',
};
const ctx = (o = {}) => ({
  sandboxes: ['uat', 'dev', 'sneaky'],
  defaultOrg: () => 'uat',
  instanceUrl: (a) => URLS[a] ?? null,
  readScript: () => null,
  ...o,
});
const allowed = (cmd, c = ctx()) => expect(decide(cmd, c)).toEqual({ allow: true });
const blocked = (cmd, msg, c = ctx()) => {
  const r = decide(cmd, c);
  expect(r.allow).toBe(false);
  expect(r.reason).toMatch(msg);
};

describe('sandbox URLs', () => {
  test('recognises sandbox domains', () => {
    for (const u of ['https://acme--uat.sandbox.my.salesforce.com', 'https://acme--uat.my.salesforce.com',
      'https://acme--uat.cs42.my.salesforce.com', 'https://cs42.salesforce.com']) expect(isSandboxUrl(u)).toBe(true);
  });
  test('rejects production and junk', () => {
    for (const u of ['https://acme.my.salesforce.com', 'https://na42.salesforce.com', 'https://login.salesforce.com', 'not a url', '']) {
      expect(isSandboxUrl(u)).toBe(false);
    }
  });
});

describe('decide', () => {
  test('non-sf commands pass', () => {
    allowed('git status && npm test');
    allowed('echo sf is great');
  });

  test('org-free sf commands pass without a target', () => {
    for (const c of ['sf --version', 'sf help', 'sf project deploy start --help', 'sf config set target-org=prod',
      'sf alias list', 'sf project generate manifest --source-dir force-app', 'sf code-analyzer run --target force-app',
      'sf org list', 'sf apex generate class --name Foo']) allowed(c, ctx({ defaultOrg: () => null }));
  });

  test('a listed sandbox passes', () => {
    allowed('sf project deploy start -o uat -m ApexClass:Foo');
    allowed('sf data query --target-org dev -q "SELECT Id FROM Account"');
    allowed('sf project retrieve start --target-org=uat -m Flow:X');
    allowed('sf project deploy start -m ApexClass:Foo');
  });

  test('an unlisted alias is blocked, with the alias in the reason', () => {
    blocked('sf project deploy start -o prod -m ApexClass:Foo', /"prod" is not listed as a sandbox/);
    blocked('sf data query -o prod -q "SELECT Id FROM User"', /"prod" is not listed/);
  });

  test('the default org is used when no target is given', () => {
    blocked('sf project deploy start -m ApexClass:Foo', /"nitro-prod" is not listed/, ctx({ defaultOrg: () => 'nitro-prod' }));
    blocked('sf data query -q "SELECT Id FROM Account"', /no target org/, ctx({ defaultOrg: () => null }));
  });

  test('a listed alias that points to production is blocked', () => {
    blocked('sf project deploy start -o sneaky', /acme\.my\.salesforce\.com, which is not a sandbox/);
  });

  test('an alias that cannot be looked up is blocked', () => {
    blocked('sf data query -o uat -q x', /could not look up "uat"/, ctx({ instanceUrl: () => null }));
  });

  test('every org flag is checked, including dev hub and from-org', () => {
    blocked('sf org create scratch -v prod -f config.json', /"prod"/);
    blocked('sf project generate manifest --from-org prod', /"prod"/);
  });

  test('always-forbidden commands', () => {
    blocked('sf project deploy quick --job-id 0Af', /Jimmy deploys to production himself/);
    blocked('sf org display -o uat', /access token/);
    blocked('sf org open -o uat --url-only', /session token/);
    blocked('sf org list --json', /access tokens/);
    blocked('sf org login web -a prod', /Jimmy authorises orgs/);
    blocked('sf org logout -o uat', /Jimmy manages org logins/);
    blocked('sfdx force:source:deploy -u prod', /Use sf instead of the legacy sfdx/);
  });

  test('colon topics work like spaces', () => {
    blocked('sf project:deploy:quick --job-id 0Af', /Jimmy deploys/);
  });

  test('chained, substituted and wrapped commands are all checked', () => {
    blocked('npm test && sf project deploy start -o prod', /"prod"/);
    blocked('echo $(sf data query -o prod -q x)', /"prod"/);
    blocked('bash -c "sf project deploy start -o prod"', /"prod"/);
    blocked('eval sf project deploy start -o prod', /"prod"/);
    blocked('env FOO=1 npx sf project deploy start -o prod', /"prod"/);
    allowed('bash -c "sf project deploy start -o uat"');
  });

  test('xargs hides arguments and is blocked when it runs sf', () => {
    blocked('cat aliases.txt | xargs sf org list', /xargs hides/);
    allowed('ls | xargs echo');
  });

  test('scripts that run sf are blocked; other scripts pass', () => {
    const c = ctx({ readScript: (f) => (f === './deploy.sh' ? '#!/bin/bash\nsf project deploy start -o prod\n' : 'echo hi\n') });
    blocked('./deploy.sh', /deploy\.sh runs sf commands/, c);
    allowed('bash build.sh', c);
  });

  test('without a readable team.json, sf org commands are blocked but others pass', () => {
    const c = ctx({ sandboxes: null, teamError: 'team file not found' });
    blocked('sf data query -o uat -q x', /team file not found/, c);
    allowed('sf --version', c);
    allowed('git status', c);
  });

  test('deep nesting is refused', () => {
    let cmd = 'sf org list -o uat';
    for (let k = 0; k < 5; k++) cmd = `bash -c ${JSON.stringify(cmd)}`;
    blocked(cmd, /nests shells too deeply/);
  });
});

describe('checkSf', () => {
  test('help anywhere means no org is touched', () => {
    expect(checkSf(['project', 'deploy', 'start', '-o', 'prod', '--help'], ctx())).toEqual({ allow: true });
  });
});

describe('readDefaultOrg', () => {
  const files = (map) => (f) => map[f] ?? null;
  test('project .sf config wins', () => {
    expect(readDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: files({
      '/p/.sf/config.json': '{"target-org":"uat"}', '/h/.sf/config.json': '{"target-org":"prod"}' }) })).toBe('uat');
  });
  test('falls back to legacy project config, then the home configs', () => {
    expect(readDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: files({ '/p/.sfdx/sfdx-config.json': '{"defaultusername":"dev"}' }) })).toBe('dev');
    expect(readDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: files({ '/h/.sf/config.json': '{"target-org":"prod"}' }) })).toBe('prod');
    expect(readDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: files({ '/h/.sfdx/sfdx-config.json': '{"defaultusername":"x"}' }) })).toBe('x');
  });
  test('broken or empty configs are skipped; none means null', () => {
    expect(readDefaultOrg({ projectDir: '/p', homeDir: '/h', readFile: files({ '/p/.sf/config.json': '{oops', '/h/.sf/config.json': '{"target-org":" "}' }) })).toBeNull();
  });
});

describe('cachedInstanceUrl', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  test('uses a fresh cache entry without looking up', () => {
    const cache = { uat: { url: URLS.uat, at: new Date(now.getTime() - 1000).toISOString() } };
    const r = cachedInstanceUrl('uat', { cache, now, lookup: () => { throw new Error('should not look up'); } });
    expect(r).toEqual({ url: URLS.uat, cache });
  });
  test('looks up when missing or older than a day, and returns a new cache', () => {
    const cache = { uat: { url: 'old', at: new Date(now.getTime() - CACHE_TTL_MS - 1).toISOString() } };
    const r = cachedInstanceUrl('uat', { cache, now, lookup: () => URLS.uat });
    expect(r.url).toBe(URLS.uat);
    expect(r.cache).not.toBe(cache);
    expect(r.cache.uat).toEqual({ url: URLS.uat, at: now.toISOString() });
  });
  test('a failed lookup returns null and leaves the cache alone', () => {
    const cache = {};
    expect(cachedInstanceUrl('x', { cache, now, lookup: () => null })).toEqual({ url: null, cache });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/guard-rules.test.mjs`
Expected: FAIL (`decide` is not exported).

- [ ] **Step 3: Implement**

In `lib/guard.mjs`, add `import path from 'node:path';` on the line after the two header comment lines, then append:

```js
/** @typedef {{ allow: true } | { allow: false, reason: string }} Decision */
/**
 * @typedef {object} GuardCtx
 * @property {string[] | null} sandboxes aliases from orgs.sandbox in team.json; null when team.json can't be read
 * @property {string} [teamError] why sandboxes is null
 * @property {() => string | null} defaultOrg the default target org (project, then global)
 * @property {(alias: string) => string | null} instanceUrl the org's instance URL, or null when unknown
 * @property {(file: string) => string | null} readScript a script's text, or null when unreadable
 */

/** @type {Decision} */
const ALLOW = Object.freeze({ allow: true });
/** @param {string} reason @returns {Decision} */
const deny = (reason) => ({ allow: false, reason });

/**
 * True for sandbox instance URLs: enhanced domains (<domain>--<sandbox>.sandbox.my.salesforce.com),
 * legacy My Domain sandboxes (<domain>--<sandbox>[.csNN].my.salesforce.com) and legacy csNN instances.
 * Production My Domains can't contain "--".
 * @param {string} url
 * @returns {boolean}
 */
export function isSandboxUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host.endsWith('.sandbox.my.salesforce.com')
    || /^[a-z0-9-]+--[a-z0-9]+(\.cs\d+)?\.my\.salesforce\.com$/.test(host)
    || /^cs\d+\.salesforce\.com$/.test(host);
}

/** @param {string} url */
const hostOf = (url) => {
  try { return new URL(url).hostname; } catch { return url; }
};

/** @type {{ topic: string[], when?: (flags: string[]) => boolean, reason: string }[]} */
const FORBIDDEN = [
  { topic: ['project', 'deploy', 'quick'], reason: 'Quick deploys are for production releases. Jimmy deploys to production himself with change sets.' },
  { topic: ['org', 'display'], reason: 'sf org display prints an access token. Use "sf org list" to see orgs.' },
  { topic: ['org', 'open'], when: (f) => f.includes('--url-only') || f.includes('-r'), reason: 'sf org open --url-only prints a login URL with a session token.' },
  { topic: ['org', 'list'], when: (f) => f.includes('--json'), reason: 'sf org list --json can include access tokens. Run it without --json.' },
  { topic: ['org', 'login'], reason: 'Jimmy authorises orgs himself.' },
  { topic: ['org', 'logout'], reason: 'Jimmy manages org logins himself.' },
];

/** Topics that never touch an org unless an org flag is given. */
const NO_ORG = [['version'], ['help'], ['plugins'], ['update'], ['autocomplete'], ['doctor'], ['config'], ['alias'],
  ['search'], ['info'], ['which'], ['commands'], ['project', 'generate'], ['apex', 'generate'], ['lightning', 'generate'],
  ['static-resource', 'generate'], ['visualforce', 'generate'], ['analytics', 'generate'], ['template'],
  ['code-analyzer'], ['scanner'], ['org', 'list']];

const ORG_FLAGS = new Set(['-o', '--target-org', '-v', '--target-dev-hub', '--from-org', '--source-org']);

/**
 * Every org named by an org flag (-o x, --target-org x, --target-org=x, ...).
 * @param {string[]} flags
 * @returns {string[]}
 */
function orgFlagValues(flags) {
  /** @type {string[]} */ const out = [];
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    const eq = f.indexOf('=');
    if (f.startsWith('-') && eq > 0 && ORG_FLAGS.has(f.slice(0, eq))) out.push(f.slice(eq + 1));
    else if (ORG_FLAGS.has(f)) { out.push(flags[i + 1] ?? ''); i++; }
  }
  return out;
}

/**
 * Decide one sf invocation (the words after "sf").
 * @param {string[]} args
 * @param {GuardCtx} ctx
 * @returns {Decision}
 */
export function checkSf(args, ctx) {
  /** @type {string[]} */ const topic = [];
  let i = 0;
  for (; i < args.length && !args[i].startsWith('-'); i++) topic.push(...args[i].split(':'));
  const flags = args.slice(i);
  if (topic.length === 0 || topic[0] === 'help' || flags.includes('--help') || flags.includes('-h')) return ALLOW;
  const starts = (/** @type {string[]} */ p) => p.every((w, k) => topic[k] === w);
  for (const f of FORBIDDEN) {
    if (starts(f.topic) && (!f.when || f.when(flags))) return deny(f.reason);
  }
  const named = orgFlagValues(flags);
  if (named.length === 0 && NO_ORG.some(starts)) return ALLOW;
  if (ctx.sandboxes === null) {
    return deny(`The guard can't read .team/team.json (${ctx.teamError ?? 'unknown error'}), so sf org commands are blocked until it is fixed.`);
  }
  let orgs = named;
  if (orgs.length === 0) {
    const d = ctx.defaultOrg();
    if (!d) return deny('This sf command has no target org. Add -o <alias> with an alias from orgs.sandbox in .team/team.json.');
    orgs = [d];
  }
  for (const org of orgs) {
    if (!ctx.sandboxes.includes(org)) {
      return deny(`"${org}" is not listed as a sandbox in .team/team.json (orgs.sandbox). The team only works in listed sandboxes; ask Jimmy to add it if it is one.`);
    }
    const url = ctx.instanceUrl(org);
    if (url === null) return deny(`The guard could not look up "${org}". Ask Jimmy to check the alias with "sf org list".`);
    if (!isSandboxUrl(url)) return deny(`"${org}" points to ${hostOf(url)}, which is not a sandbox. The team only works in sandboxes.`);
  }
  return ALLOW;
}

const SCRIPT_RUNS_SF = /(^|[\s;&|(`])(sf|sfdx)\s+[a-z-]/m;
const MAX_DEPTH = 3;

/**
 * Decide a whole Bash command.
 * @param {string} command
 * @param {GuardCtx} ctx
 * @param {number} [depth]
 * @returns {Decision}
 */
export function decide(command, ctx, depth = 0) {
  if (depth > MAX_DEPTH) return deny('The command nests shells too deeply for the guard to check. Run the sf command directly.');
  for (const words of splitCommands(command)) {
    const u = unwrap(words);
    if (!u) continue;
    if (u.kind === 'inline') {
      const r = decide(u.text, ctx, depth + 1);
      if (!r.allow) return r;
      continue;
    }
    if (u.kind === 'opaque') {
      if (/\bsfdx?\b/.test(u.text)) return deny(`${u.what} hides the sf command's arguments from the guard. Run the sf command directly.`);
      continue;
    }
    if (u.kind === 'script') {
      const text = ctx.readScript(u.file);
      if (text !== null && SCRIPT_RUNS_SF.test(text)) {
        return deny(`${u.file} runs sf commands the guard can't check one by one. Run those sf commands directly.`);
      }
      continue;
    }
    if (u.program === 'sfdx') return deny('Use sf instead of the legacy sfdx command, so the guard can check the target org.');
    if (u.program === 'sf') {
      const r = checkSf(u.args, ctx);
      if (!r.allow) return r;
    }
  }
  return ALLOW;
}

/**
 * The default target org: project .sf, project .sfdx, then the same in the home folder.
 * @param {{ projectDir: string, homeDir: string, readFile: (file: string) => string | null }} o
 * @returns {string | null}
 */
export function readDefaultOrg({ projectDir, homeDir, readFile }) {
  /** @type {[string, string][]} */
  const tries = [
    [path.join(projectDir, '.sf', 'config.json'), 'target-org'],
    [path.join(projectDir, '.sfdx', 'sfdx-config.json'), 'defaultusername'],
    [path.join(homeDir, '.sf', 'config.json'), 'target-org'],
    [path.join(homeDir, '.sfdx', 'sfdx-config.json'), 'defaultusername'],
  ];
  for (const [file, key] of tries) {
    const text = readFile(file);
    if (text === null) continue;
    try {
      const v = JSON.parse(text)?.[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    } catch {
      // A broken config file is skipped, like sf itself would fail on it.
    }
  }
  return null;
}

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Instance URL for an alias, from a cache that is trusted for one day.
 * @param {string} alias
 * @param {{ cache: Record<string, { url: string, at: string }>, now: Date, lookup: (alias: string) => string | null }} o
 * @returns {{ url: string | null, cache: Record<string, { url: string, at: string }> }} the same cache object when unchanged
 */
export function cachedInstanceUrl(alias, { cache, now, lookup }) {
  const hit = Object.hasOwn(cache, alias) ? cache[alias] : undefined;
  if (hit && typeof hit.url === 'string' && now.getTime() - Date.parse(hit.at) < CACHE_TTL_MS) return { url: hit.url, cache };
  const url = lookup(alias);
  if (url === null) return { url: null, cache };
  return { url, cache: { ...cache, [alias]: { url, at: now.toISOString() } } };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/guard-rules.test.mjs test/guard-shell.test.mjs && npm run lint`
Expected: PASS, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add lib/guard.mjs test/guard-rules.test.mjs
git commit -m "Guard: sf rules, sandbox URL check, default org and cache

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Guard hook entry

**Files:**
- Create: `hooks/guard-org.mjs`
- Modify: `hooks/record.mjs` (export `describeBash`)
- Test: `test/guard-hook.test.mjs` (create)

**Interfaces:**
- Consumes: `decide`, `readDefaultOrg`, `cachedInstanceUrl` (Task 7); `loadTeam` (Task 1); `appendEvent`; `logPath`; `describeBash`.
- Produces: `guard(input: any, env: { projectDir: string, homeDir: string, now: Date }): Decision` (exported for tests), and the executable hook. Contract: allow → no output, exit 0. Block → `Blocked by the org guard: <reason>` on stderr, exit 2, plus a `guard_blocked` event. The cache file is `.team/org-cache.json`.

- [ ] **Step 1: Write the failing test**

Create `test/guard-hook.test.mjs`:

```js
import { test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../hooks/guard-org.mjs', import.meta.url));
let root;
let project;
let home;
let bin;

const FAKE_SF = `#!/usr/bin/env node
const args = process.argv.slice(2);
const alias = args[args.indexOf('-o') + 1];
const urls = { uat: 'https://acme--uat.sandbox.my.salesforce.com', sneaky: 'https://acme.my.salesforce.com' };
require('node:fs').appendFileSync(process.env.FAKE_SF_LOG, alias + '\\n');
if (!urls[alias]) process.exit(1);
process.stdout.write(JSON.stringify({ status: 0, result: { instanceUrl: urls[alias], accessToken: 'SECRET-TOKEN' } }));
`;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sftk-guard-'));
  project = path.join(root, 'my project');
  home = path.join(root, 'home');
  bin = path.join(root, 'bin');
  fs.mkdirSync(path.join(project, '.team'), { recursive: true });
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'sf'), FAKE_SF, { mode: 0o755 });
  fs.writeFileSync(path.join(project, '.team', 'team.json'), JSON.stringify({
    project: 'P', orgs: { sandbox: ['uat', 'sneaky'] },
    approver: { id: 'jimmy', name: 'Jimmy', role: 'r', color: '#ffb900' },
    members: [{ id: 'planner', name: 'Architect', role: 'r', color: '#6a5ae0' }],
  }));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const runHook = (input) => spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify(input),
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_PROJECT_DIR: project, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_SF_LOG: path.join(root, 'sf.log') },
});
const bash = (command, extra = {}) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, ...extra });
const events = () => {
  const f = path.join(project, '.team', 'events.jsonl');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const everything = () => [
  ...events().map((e) => JSON.stringify(e)),
  fs.existsSync(path.join(project, '.team', 'org-cache.json')) ? fs.readFileSync(path.join(project, '.team', 'org-cache.json'), 'utf8') : '',
].join('\n');

test('allows a sandbox command silently', () => {
  const r = runHook(bash('sf project deploy start -o uat -m ApexClass:Foo'));
  expect(r.status).toBe(0);
  expect(r.stdout).toBe('');
  expect(r.stderr).toBe('');
  expect(events()).toEqual([]);
});

test('blocks an unlisted org with exit 2, a reason and an event', () => {
  const r = runHook(bash('sf project deploy start -o prod', { agent_type: 'Developer' }));
  expect(r.status).toBe(2);
  expect(r.stdout).toBe('');
  expect(r.stderr).toMatch(/^Blocked by the org guard: "prod" is not listed as a sandbox/);
  expect(events()).toEqual([expect.objectContaining({ type: 'guard_blocked', agent: 'developer', source: 'hook', command: 'Running sf project' })]);
});

test('blocks a listed alias that is really production; the token never leaks', () => {
  const r = runHook(bash('sf data query -o sneaky -q "SELECT Id FROM Account"'));
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/acme\.my\.salesforce\.com, which is not a sandbox/);
  expect(`${r.stdout}${r.stderr}${everything()}`).not.toContain('SECRET-TOKEN');
});

test('caches the instance URL between calls', () => {
  runHook(bash('sf data query -o uat -q x'));
  runHook(bash('sf data query -o uat -q y'));
  expect(fs.readFileSync(path.join(root, 'sf.log'), 'utf8').trim().split('\n')).toEqual(['uat']);
  const cache = JSON.parse(fs.readFileSync(path.join(project, '.team', 'org-cache.json'), 'utf8'));
  expect(cache.uat.url).toBe('https://acme--uat.sandbox.my.salesforce.com');
});

test('uses the project default org when no -o is given', () => {
  fs.mkdirSync(path.join(project, '.sf'));
  fs.writeFileSync(path.join(project, '.sf', 'config.json'), '{"target-org":"nitro-prod"}');
  const r = runHook(bash('sf project deploy start -m ApexClass:Foo'));
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/"nitro-prod" is not listed/);
});

test('main session blocks are attributed to planner', () => {
  runHook(bash('sf org display -o uat'));
  expect(events()[0]).toMatchObject({ agent: 'planner', reason: expect.stringMatching(/access token/) });
});

test('non-Bash tools, bad input and a missing project dir are allowed', () => {
  expect(runHook({ tool_name: 'Edit', tool_input: { file_path: 'x' } }).status).toBe(0);
  const bad = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: project } });
  expect(bad.status).toBe(0);
  const noDir = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(bash('sf data query -o prod -q x')), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '' } });
  expect(noDir.status).toBe(0);
});

test('a broken team.json blocks sf org commands only', () => {
  fs.writeFileSync(path.join(project, '.team', 'team.json'), '{broken');
  expect(runHook(bash('git status')).status).toBe(0);
  const r = runHook(bash('sf data query -o uat -q x'));
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/can't read \.team\/team\.json/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/guard-hook.test.mjs`
Expected: FAIL (hook file missing; `node` exits with code 1).

- [ ] **Step 3: Implement**

In `hooks/record.mjs`, change `function describeBash(command) {` to `export function describeBash(command) {`. Nothing else changes.

Create `hooks/guard-org.mjs`:

```js
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
    if (!/\bsfdx?\b/.test(command)) return 0;
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
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/guard-hook.test.mjs test/hooks.test.mjs && npm run lint`
Expected: PASS, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add hooks/guard-org.mjs hooks/record.mjs test/guard-hook.test.mjs
git commit -m "Guard hook: block non-sandbox sf commands and log guard_blocked

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Agent files

**Files:**
- Create: `agents/analyst.md`, `agents/admin.md`, `agents/developer.md`, `agents/qa.md`
- Rewrite: `agents/reviewer.md`
- Delete: `agents/backend.md`, `agents/frontend.md`, `agents/tester.md`
- Modify: `lib/install/plan.mjs` (the four agent lines in `COPIES`), `test/install.test.mjs` (the agent paths in `KIT_FILES`)
- Rewrite: `test/agents.test.mjs` (agent tests only; planner tests move to Task 10, README tests to Task 13)

**Interfaces:**
- Produces: five subagents whose `name` equals their team id; each body has the sections `Role`, `Boundaries`, `Skills to use`, `Reporting`, `Handoff` in that order; each file is under 80 lines.

- [ ] **Step 1: Write the failing test**

Replace the whole of `test/agents.test.mjs` with:

```js
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const MAX_AGENT_FILE_LINES = 80;
const AGENTS = ['analyst', 'admin', 'developer', 'qa', 'reviewer'];
const APPROVED_FIRST = ['admin', 'developer', 'qa', 'reviewer'];

function parse(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('missing frontmatter');
  const front = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) front[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { front, body: m[2] };
}
const agent = (id) => parse(read(`agents/${id}.md`));

describe('agent files', () => {
  test('the web agents are gone', () => {
    for (const id of ['backend', 'frontend', 'tester']) expect(fs.existsSync(path.join(root, `agents/${id}.md`))).toBe(false);
  });

  test('every team.json member except planner has an agent file whose name matches', () => {
    const ids = JSON.parse(read('templates/team.json')).members.map((m) => m.id).filter((id) => id !== 'planner');
    expect(ids.sort()).toEqual([...AGENTS].sort());
    for (const id of ids) {
      expect(agent(id).front.name).toBe(id);
      expect(agent(id).front.description.length).toBeGreaterThan(40);
    }
  });

  test('tools: reviewer is read-only, everyone else can edit', () => {
    expect(agent('reviewer').front.tools).not.toMatch(/\b(Edit|Write)\b/);
    expect(agent('reviewer').front.tools).toMatch(/\bBash\b/);
    for (const id of ['analyst', 'admin', 'developer', 'qa']) {
      for (const t of ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob']) expect(agent(id).front.tools).toMatch(new RegExp(`\\b${t}\\b`));
    }
  });

  test('models: developer and reviewer opus, the rest sonnet', () => {
    expect(agent('developer').front.model).toBe('opus');
    expect(agent('reviewer').front.model).toBe('opus');
    for (const id of ['analyst', 'admin', 'qa']) expect(agent(id).front.model).toBe('sonnet');
  });

  test('every agent body has the five sections in order and stays short', () => {
    for (const id of AGENTS) {
      const { body } = agent(id);
      const heads = [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
      expect(heads).toEqual(['Role', 'Boundaries', 'Skills to use', 'Reporting', 'Handoff']);
      expect(body.split('\n').length + 5).toBeLessThan(MAX_AGENT_FILE_LINES);
    }
  });

  test('every agent reports with team-status and its own id', () => {
    for (const id of AGENTS) {
      const { body } = agent(id);
      expect(body).toContain('node .team/bin/team-status.mjs');
      expect(body).toContain(`--agent ${id}`);
      expect(body).toContain('--reason');
    }
  });

  test('every agent states the git, sandbox and data rules', () => {
    for (const id of AGENTS) {
      const { body } = agent(id);
      expect(body).toMatch(/never push to `?main`?/i);
      expect(body).toMatch(/never force-push/i);
      expect(body).toMatch(/never commit secrets/i);
      expect(body).toMatch(/feature branch/i);
      expect(body).toContain('orgs.sandbox');
      expect(body).toMatch(/never touch production/i);
      expect(body).toMatch(/real customer data/i);
      expect(body).toContain('orgSkill');
    }
  });

  test('approval and handoff wording', () => {
    for (const id of APPROVED_FIRST) {
      expect(agent(id).body).toMatch(/Do not start before the Architect confirms Jimmy approved/);
      expect(agent(id).body).toContain('handoff-template.md');
    }
    for (const id of ['admin', 'developer', 'qa']) {
      expect(agent(id).body).toContain(`.team/handoffs/<task-id>-${id}.md`);
      expect(agent(id).body).toContain('Org knowledge to add');
    }
    expect(agent('analyst').body).toContain('docs/stories/<task-id>.md');
    expect(agent('analyst').body).toContain('--from analyst --to planner');
  });

  test('builders deploy only to the sandbox and record it', () => {
    for (const id of ['admin', 'developer']) {
      const { body } = agent(id);
      expect(body).toContain('sf project retrieve start -o <alias>');
      expect(body).toContain('--dry-run');
      expect(body).toContain(`team-status.mjs deploy --agent ${id}`);
      expect(body).toContain(`--from ${id} --to qa`);
    }
  });

  test('role boundaries', () => {
    expect(agent('admin').body).toMatch(/Do not write Apex or LWC/);
    expect(agent('developer').body).toMatch(/Do not build flows/);
    expect(agent('analyst').body).toMatch(/Never edit `force-app\/`/);
    expect(agent('qa').body).toMatch(/only create or edit test files/i);
    expect(agent('reviewer').body).toMatch(/read-only/i);
  });

  test('QA and Reviewer route their verdicts', () => {
    expect(agent('qa').body).toContain('--from qa --to reviewer');
    expect(agent('qa').body).toContain('--to <builder id>');
    const r = agent('reviewer').body;
    expect(r).toContain('.team/handoffs/<task-id>-<builder id>.md');
    expect(r).toContain('.team/handoffs/<task-id>-qa.md');
    expect(r).toContain('--from reviewer --to planner');
    expect(r).toContain('sf code-analyzer run');
    expect(r).toMatch(/gh pr review --comment/);
    expect(r).toMatch(/Never use `--approve`/);
  });

  test('skills use exact names', () => {
    const want = {
      analyst: ['sf-architecture'],
      admin: ['sf-flow', 'sf-security', 'sf-deploy', 'superpowers:verification-before-completion', 'superpowers:receiving-code-review'],
      developer: ['sf-apex', 'sf-security', 'sf-deploy', 'superpowers:test-driven-development', 'superpowers:systematic-debugging',
        'superpowers:verification-before-completion', 'superpowers:receiving-code-review'],
      qa: ['sf-testing', 'superpowers:verification-before-completion', 'superpowers:systematic-debugging'],
      reviewer: ['sf-review', 'sf-security', 'superpowers:requesting-code-review', 'superpowers:verification-before-completion'],
    };
    for (const [id, skills] of Object.entries(want)) for (const s of skills) expect(agent(id).body).toContain(`\`${s}\``);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agents.test.mjs`
Expected: FAIL (`agents/analyst.md` missing; web agents still present).

- [ ] **Step 3: Write the agent files**

```bash
git rm agents/backend.md agents/frontend.md agents/tester.md
```

Create `agents/analyst.md`:

````markdown
---
name: analyst
description: Turns a Salesforce request into a user story with testable acceptance criteria and edge cases, and writes UAT scripts and design or review documents. Use first on every task, before the Architect designs.
tools: Read, Write, Edit, Bash, Grep, Glob
model: sonnet
---

## Role

You are the Analyst. You turn Jimmy's request into `docs/stories/<task-id>.md`: a user story, acceptance criteria that QA can test in the sandbox, edge cases, what is out of scope, and open questions. When the Architect asks, you also write UAT scripts and design or review documents in `docs/`.

Story format:

```
# <task-id> <title>
As a <role>, I want <goal>, so that <benefit>.
### Acceptance criteria
1. Given <state>, when <action>, then <result>.
### Edge cases
### Out of scope
### Questions for Jimmy
### Org knowledge to add
```

Always cover records that must not change, records that already have a value, 200 records saved at once, and a user without the needed permission.

## Boundaries

- Your story needs no Work Order, but you only write in `docs/`. Never edit `force-app/` or any other metadata.
- Work on the feature branch the Architect names, if there is one. Never push to `main`. Never force-push. Never commit secrets (`.env` files, auth files, keys).
- Work only in sandboxes listed under `orgs.sandbox` in `.team/team.json`, and only read: `sf data query -o <alias>` and `sf sobject describe -o <alias>`. Never touch production.
- Never use real customer data in examples. Make records up.
- If something is unclear, write it under "Questions for Jimmy". Do not guess or invent requirements.

## Skills to use

- `sf-architecture`: Salesforce terms and how objects and automation relate, so criteria name real fields and behaviour.
- The org knowledge skill named by `orgSkill` in `.team/team.json`.

## Reporting

Update the status board with the CLI (run from the project root). Use `--agent analyst`.

- Start: `node .team/bin/team-status.mjs status --agent analyst --status working --task T-012 --progress 0 --next "Read the request"`
- Milestone: `node .team/bin/team-status.mjs status --agent analyst --status working --task T-012 --progress 60 --next "Write the edge cases"`
- Blocked: `node .team/bin/team-status.mjs status --agent analyst --status blocked --task T-012 --reason "Need Jimmy's answer on renewals without a partner"`
- Finish: `node .team/bin/team-status.mjs status --agent analyst --status done --task T-012 --progress 100`

## Handoff

1. The story file is your handoff. Fill in "Org knowledge to add" (write "None" if there is nothing).
2. Run `node .team/bin/team-status.mjs handoff --from analyst --to planner --task <task-id> --file docs/stories/<task-id>.md`.
3. Tell the Architect the story is ready. Do not re-explain it in chat.
````

Create `agents/admin.md`:

```markdown
---
name: admin
description: Builds declarative Salesforce changes (flows, objects, fields, validation rules, formulas, permission sets, layouts, Lightning pages, reports, custom metadata) in a sandbox for an approved Work Order.
tools: Read, Edit, Write, Bash, Grep, Glob
model: sonnet
---

## Role

You are the Admin. You build declarative metadata in `force-app/`: flows, objects and fields, validation rules, formulas, permission sets, page layouts, Lightning pages, reports and custom metadata. You deploy it to the sandbox and hand it to QA.

## Boundaries

- Do not start before the Architect confirms Jimmy approved your Work Order. Work only on the feature branch the Architect names, and only on your Work Order.
- Never push to `main`. Never force-push. Never commit secrets (`.env` files, auth files, keys).
- Do not write Apex or LWC. Ask the Architect to give code work to the Developer.
- Work only in sandboxes listed under `orgs.sandbox` in `.team/team.json`, and always pass `-o <alias>`. Never touch production. If the org guard blocks a command, do not work around it; tell the Architect.
- Retrieve before you edit (`sf project retrieve start -o <alias> -m <type>:<name>`), so you never overwrite someone else's sandbox change.
- Deploy with `--dry-run` first, then for real. Give every flow element that writes data or calls out a fault path.
- Never use real customer data. If you lack information, say exactly what is missing. If scope grows by more than about 25%, stop and tell the Architect.

## Skills to use

- `sf-flow`: flow type, entry conditions, fault paths, no DML in loops, versions and activation.
- `sf-security`: permission sets, field-level security and sharing.
- `sf-deploy`: retrieve first, manifests, dry runs, reading deploy errors.
- `superpowers:verification-before-completion`: deploy and check in the sandbox before you say you are done.
- `superpowers:receiving-code-review`: when QA or the Reviewer sends notes, check each one before you act on it.
- The org knowledge skill named by `orgSkill` in `.team/team.json`.

## Reporting

Update the status board with the CLI (run from the project root). Use `--agent admin`.

- Start: `node .team/bin/team-status.mjs status --agent admin --status working --task T-012 --progress 0 --next "Retrieve the Opportunity flows"`
- Milestone: `node .team/bin/team-status.mjs status --agent admin --status working --task T-012 --progress 60 --next "Deploy to the sandbox"`
- Blocked: `node .team/bin/team-status.mjs status --agent admin --status blocked --task T-012 --reason "Need the Developer's invocable method name"`
- Deployed: `node .team/bin/team-status.mjs deploy --agent admin --org uat --result passed --task T-012`
- Finish: `node .team/bin/team-status.mjs status --agent admin --status done --task T-012 --progress 100`

## Handoff

1. Copy `.team/handoffs/handoff-template.md` to `.team/handoffs/<task-id>-admin.md` and fill in every section, including "Org knowledge to add". On a second round, update your file.
2. Run `node .team/bin/team-status.mjs handoff --from admin --to qa --task <task-id>`.
3. Tell the Architect the handoff file is ready. Do not re-explain it in chat.
```

Create `agents/developer.md`:

```markdown
---
name: developer
description: Builds Apex (classes, triggers, batch and queueable jobs), Lightning Web Components and integrations with Apex tests, in a sandbox, for an approved Work Order.
tools: Read, Edit, Write, Bash, Grep, Glob
model: opus
---

## Role

You are the Developer. You build Apex classes and triggers, async jobs, Lightning Web Components and integrations (Named Credentials, callouts, Platform Events) in `force-app/`, with Apex tests for your own code. You deploy to the sandbox and hand it to QA. If the Admin's flow calls your code, write the invocable method's name and inputs into the design file before the Admin needs them.

## Boundaries

- Do not start before the Architect confirms Jimmy approved your Work Order. Work only on the feature branch the Architect names, and only on your Work Order.
- Never push to `main`. Never force-push. Never commit secrets (`.env` files, auth files, keys). Secrets live in Named Credentials, never in code.
- Do not build flows or other declarative config. Ask the Architect to give that to the Admin.
- Work only in sandboxes listed under `orgs.sandbox` in `.team/team.json`, and always pass `-o <alias>`. Never touch production. Never call Salesforce APIs with `curl` or other tools. If the org guard blocks a command, do not work around it; tell the Architect.
- Retrieve before you edit (`sf project retrieve start -o <alias> -m <type>:<name>`). Deploy with `--dry-run` first, then for real with your tests.
- Write the failing test first. Bulkify everything, keep SOQL and DML out of loops, use `WITH USER_MODE`, never hard-code IDs, one trigger per object with a handler.
- Never use real customer data; build test data with a factory. If you lack information, say exactly what is missing. If scope grows by more than about 25%, stop and tell the Architect.

## Skills to use

- `sf-apex`: bulk patterns, security, async choices, test data factories, LWC basics.
- `sf-security`: CRUD/FLS, sharing, SOQL injection, secrets.
- `sf-deploy`: retrieve first, manifests, dry runs, reading deploy errors.
- `superpowers:test-driven-development`: the failing test first, then the code.
- `superpowers:systematic-debugging`: when a test fails and the cause is not obvious.
- `superpowers:verification-before-completion`: run the tests in the sandbox and read the results before you say you are done.
- `superpowers:receiving-code-review`: when QA or the Reviewer sends notes, check each one before you act on it.
- The org knowledge skill named by `orgSkill` in `.team/team.json`.

## Reporting

Update the status board with the CLI (run from the project root). Use `--agent developer`.

- Start: `node .team/bin/team-status.mjs status --agent developer --status working --task T-012 --progress 0 --next "Write the first failing test"`
- Milestone: `node .team/bin/team-status.mjs status --agent developer --status working --task T-012 --progress 50 --next "Bulk test with 200 records"`
- Blocked: `node .team/bin/team-status.mjs status --agent developer --status blocked --task T-012 --reason "Deploy fails: missing field on Opportunity"`
- Deployed: `node .team/bin/team-status.mjs deploy --agent developer --org uat --result passed --tests 38/38 --coverage 92 --task T-012`
- Finish: `node .team/bin/team-status.mjs status --agent developer --status done --task T-012 --progress 100`

## Handoff

1. Copy `.team/handoffs/handoff-template.md` to `.team/handoffs/<task-id>-developer.md` and fill in every section, including "Org knowledge to add". On a second round, update your file.
2. Run `node .team/bin/team-status.mjs handoff --from developer --to qa --task <task-id>`.
3. Tell the Architect the handoff file is ready. Do not re-explain it in chat.
```

Create `agents/qa.md`:

```markdown
---
name: qa
description: Verifies finished Salesforce work in the sandbox against the acceptance criteria, writes Apex test classes and Flow tests, runs them and reports bugs. Use after a builder hands off a task.
tools: Read, Write, Edit, Bash, Grep, Glob
model: sonnet
---

## Role

You are QA. You check the builders' work in the sandbox against `docs/stories/<task-id>.md`, every acceptance criterion and edge case, including 200 records at once and a user without permission. You write and run Apex test classes and Flow tests, and you check results with SOQL. You report pass or fail with exact steps. You can block a task.

Run tests with `sf apex run test -o <alias> --tests <ClassName> --code-coverage --result-format json --wait 20` and read the JSON.

## Boundaries

- Do not start before the Architect confirms Jimmy approved your Work Order. Work only on the feature branch the Architect names.
- Never push to `main`. Never force-push. Never commit secrets (`.env` files, auth files, keys).
- Only create or edit test files: Apex test classes (`*Test.cls`, `*_Test.cls` and their `-meta.xml`) and Flow tests (`force-app/**/flowtests/`). Never edit other metadata; send bugs back to the builder in your handoff.
- Work only in sandboxes listed under `orgs.sandbox` in `.team/team.json`, and always pass `-o <alias>`. Never touch production.
- Never use real customer data. Name test records `QA <task-id> ...` and delete them when you are done.
- If you lack information, say exactly what is missing. If scope grows by more than about 25%, stop and tell the Architect.

## Skills to use

- `sf-testing`: test plans from acceptance criteria, bulk and permission tests, reading test results.
- `superpowers:verification-before-completion`: run every check and read the output before you report a result.
- `superpowers:systematic-debugging`: find the cause of a failure before you write the bug report.
- The org knowledge skill named by `orgSkill` in `.team/team.json`.

## Reporting

Update the status board with the CLI (run from the project root). Use `--agent qa`.

- Start: `node .team/bin/team-status.mjs status --agent qa --status working --task T-012 --progress 0 --next "Run the acceptance criteria"`
- Milestone: `node .team/bin/team-status.mjs status --agent qa --status working --task T-012 --progress 60 --next "Bulk insert 200 records"`
- Blocked: `node .team/bin/team-status.mjs status --agent qa --status blocked --task T-012 --reason "Bulk insert applies the discount twice"`
- Finish: `node .team/bin/team-status.mjs status --agent qa --status done --task T-012 --progress 100`

## Handoff

1. Read every builder handoff for the task. Copy `.team/handoffs/handoff-template.md` to `.team/handoffs/<task-id>-qa.md` and fill in every section, including "Org knowledge to add".
2. If everything passes, run `node .team/bin/team-status.mjs handoff --from qa --to reviewer --task <task-id>`.
   If something fails, list each failure with exact steps and run it with `--to <builder id>` (admin or developer) so the builder gets it back.
3. Tell the Architect the handoff file is ready. Do not re-explain it in chat.
```

Replace `agents/reviewer.md` with:

```markdown
---
name: reviewer
description: Final gate for a Salesforce task. Reviews the tested change for security, bulk safety, automation conflicts, test quality and plan compliance, then approves or requests changes. Read-only.
tools: Read, Bash, Grep, Glob
model: opus
---

## Role

You are the Reviewer, the final gate before the Architect prepares the change set. Check the diff against the story, the design and the Work Order. Check CRUD/FLS and `WITH USER_MODE`, sharing keywords, SOQL or DML in loops, hard-coded IDs, overlap with existing automation, fault paths in flows, tests that assert behaviour (coverage alone is not enough), direct API calls, and the rollback plan. Run `sf code-analyzer run --target force-app` and read the results. Approve or request changes with specific notes.

## Boundaries

- Do not start before the Architect confirms Jimmy approved the Work Order. Review only the branch or pull request the Architect names.
- Never push to `main`. Never force-push. Never commit secrets.
- You are read-only. You have no Edit or Write tool. Never change files.
- Use Bash only for read-only commands: `git diff`, `git log`, `git status`, `gh pr view`, `gh pr diff`, `sf code-analyzer run`, and `sf apex run test -o <alias>` against sandboxes listed under `orgs.sandbox` in `.team/team.json`. Never touch production.
- If the project has a GitHub pull request, post your verdict only with `gh pr review --comment` or `gh pr comment`. Never use `--approve` or `--request-changes` (one GitHub account cannot approve its own pull request).
- Check that no real customer data is in tests or documents. If you lack information, say exactly what is missing. If the change does much more than its Work Order (about 25% or new objects), say so.

## Skills to use

- `sf-review`: the full checklist, Code Analyzer thresholds and the verdict format.
- `sf-security`: what secure Apex, flows and permissions look like.
- `superpowers:requesting-code-review`: judge the diff against the task and the approved plan.
- `superpowers:verification-before-completion`: run Code Analyzer and the tests yourself before you approve.
- The org knowledge skill named by `orgSkill` in `.team/team.json`.

## Reporting

Update the status board with the CLI (run from the project root). Use `--agent reviewer`.

- Start: `node .team/bin/team-status.mjs status --agent reviewer --status working --task T-012 --progress 0 --next "Read the diff"`
- Milestone: `node .team/bin/team-status.mjs status --agent reviewer --status working --task T-012 --progress 50 --next "Run Code Analyzer"`
- Blocked: `node .team/bin/team-status.mjs status --agent reviewer --status blocked --task T-012 --reason "Code Analyzer reports a high-severity issue"`
- Finish: `node .team/bin/team-status.mjs status --agent reviewer --status done --task T-012 --progress 100`

## Handoff

You cannot write files. Read the builders' `.team/handoffs/<task-id>-<builder id>.md` and QA's `.team/handoffs/<task-id>-qa.md` first; the template they follow is `.team/handoffs/handoff-template.md`. Give your verdict with specific notes in your final message to the Architect, and on the pull request if there is one.
- Approved: `node .team/bin/team-status.mjs handoff --from reviewer --to planner --task <task-id> --file .team/handoffs/<task-id>-qa.md`
- Changes needed: run the same command with `--to <builder id>`. The Architect writes your notes into `.team/handoffs/<task-id>-reviewer.md`.
```

In `lib/install/plan.mjs`, replace the four `agents/...` lines at the top of `COPIES` with:

```js
  ['agents/analyst.md', '.claude/agents/analyst.md', false],
  ['agents/admin.md', '.claude/agents/admin.md', false],
  ['agents/developer.md', '.claude/agents/developer.md', false],
  ['agents/qa.md', '.claude/agents/qa.md', false],
  ['agents/reviewer.md', '.claude/agents/reviewer.md', false],
```

In `test/install.test.mjs`, replace the four `.claude/agents/...` lines at the top of `KIT_FILES` with:

```js
  '.claude/agents/admin.md',
  '.claude/agents/analyst.md',
  '.claude/agents/developer.md',
  '.claude/agents/qa.md',
  '.claude/agents/reviewer.md',
```

Then search `test/install.test.mjs` for the strings `backend.md`, `frontend.md` and `tester.md`. Every test that edits or checks one of those files to exercise conflicts or updates must use `.claude/agents/admin.md` instead (same assertions, new path). Run `grep -n "backend.md\|frontend.md\|tester.md" test/install.test.mjs` until it prints nothing.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/agents.test.mjs test/install.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A agents lib/install/plan.mjs test/agents.test.mjs test/install.test.mjs
git commit -m "Agents: Analyst, Admin, Developer, QA and Reviewer for Salesforce

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Architect rules and templates

**Files:**
- Rewrite: `planner/planner.md`, `planner/work-order-template.md`, `templates/handoff-template.md`, `templates/claude-team-section.md`
- Create: `templates/changeset-template.md`
- Modify: `lib/install/plan.mjs` (`COPIES` and `INSTALL_FILES`), `test/install.test.mjs` (`KIT_FILES`)
- Test: `test/planner.test.mjs` (create)

**Interfaces:**
- Produces: installed file `.team/changeset-template.md`. Architect rules that name `release`/`released`, `--task` on approvals, the automation inventory and the change set checklist.

- [ ] **Step 1: Write the failing test**

Create `test/planner.test.mjs`:

```js
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

describe('Architect rules', () => {
  const p = read('planner/planner.md');

  test('keeps the kit gate: 100 words, per agent approval, 25%, 2 failed rounds', () => {
    expect(p).toMatch(/100 words or fewer/);
    expect(p).toMatch(/per agent/i);
    expect(p).toMatch(/25%/);
    expect(p).toMatch(/2 failed rounds/);
    expect(p).toContain('team-status.mjs escalate');
    expect(p).toMatch(/escalation clears .*next `task` event for that task id/i);
    expect(p.split('\n').length).toBeLessThan(150);
  });

  test('one approval id per agent, linked to the task', () => {
    expect(p).toMatch(/approval --id WO-3-admin .*--agents admin .*--task T-012/);
    expect(p).toMatch(/approval --id WO-3-developer .*--agents developer .*--task T-012/);
    expect(p).toMatch(/decide --id WO-3-admin/);
    expect(p).toContain('--agent planner');
  });

  test('dispatches by team id and names every handoff file', () => {
    expect(p).toMatch(/subagent_type/);
    for (const id of ['analyst', 'admin', 'developer', 'qa', 'reviewer']) expect(p).toContain(`\`${id}\``);
    expect(p).toMatch(/never `general-purpose`/);
    expect(p).toContain('docs/stories/<task-id>.md');
    expect(p).toContain('docs/design/<task-id>.md');
    expect(p).toContain('.team/handoffs/<task-id>-<builder id>.md');
    expect(p).toContain('.team/handoffs/<task-id>-qa.md');
    expect(p).toContain('.team/handoffs/<task-id>-reviewer.md');
  });

  test('Salesforce rules: sandboxes, production, inventory, release', () => {
    expect(p).toContain('orgs.sandbox');
    expect(p).toMatch(/Production is Jimmy's/);
    expect(p).toMatch(/automation inventory/i);
    expect(p).toMatch(/declarative or code/i);
    expect(p).toContain('.team/changeset-template.md');
    expect(p).toContain('docs/release/<task-id>-changeset.md');
    expect(p).toContain('team-status.mjs release --task T-012 --components 9');
    expect(p).toContain('team-status.mjs released --task T-012');
    expect(p).toMatch(/Org knowledge to add/);
  });

  test('names its skills', () => {
    for (const s of ['superpowers:brainstorming', 'superpowers:writing-plans', 'superpowers:subagent-driven-development', 'sf-architecture', 'sf-deploy']) {
      expect(p).toContain(s);
    }
    expect(p).toContain('orgSkill');
  });
});

describe('templates', () => {
  test('work order has the design decision, inventory and table', () => {
    const wo = read('planner/work-order-template.md');
    expect(wo).toContain('## Design decision');
    expect(wo).toContain('## Automation inventory');
    expect(wo).toMatch(/\| Agent \| Task \| Plan[^|]*\| Effort[^|]*\| Risk \|/);
    expect(wo).toContain('## Recommendation');
    expect(wo).toContain('## Left out');
    expect(wo).toContain('--task');
  });

  test('handoff has the four kit sections plus org knowledge', () => {
    const h = read('templates/handoff-template.md');
    for (const s of ['What changed', 'How to verify', 'Known gaps or risks', 'What the next agent needs', 'Org knowledge to add']) {
      expect(h).toContain(`## ${s}`);
    }
    expect(h).toMatch(/Sandbox deploy/);
  });

  test('change set checklist has the seven sections and the commonly missed list', () => {
    const c = read('templates/changeset-template.md');
    for (const s of ['1. Summary', '2. Components to add', '3. Before deploying', '4. Deployment settings', '5. After deploying', '6. Rollback', '7. Check in production']) {
      expect(c).toContain(`## ${s}`);
    }
    for (const s of ['Field-level security', 'Record types', 'Custom metadata records', 'flow version', 'Lightning page activations', 'Custom labels']) {
      expect(c).toContain(s);
    }
  });

  test('CLAUDE.md section is short and Salesforce-specific', () => {
    const t = read('templates/claude-team-section.md');
    expect(t.trimEnd().split('\n').length).toBeLessThanOrEqual(25);
    expect(t).toContain('.team/planner.md');
    expect(t).not.toMatch(/<!--/);
    expect(t).toMatch(/subagent_type/);
    expect(t).toContain('.team/handoffs/<task-id>-<agent id>.md');
    expect(t).toContain('orgs.sandbox');
    expect(t).toMatch(/Never touch production/);
    expect(t).toMatch(/change sets/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/planner.test.mjs`
Expected: FAIL (old web texts; `changeset-template.md` missing).

- [ ] **Step 3: Write the files**

Replace `planner/planner.md` with:

```markdown
# Architect instructions

You are the Architect, the lead of a six-agent Salesforce team: the Architect (you, the main session), Analyst, Admin, Developer, QA and Reviewer. Jimmy is the approver, and he deploys to production himself with change sets. You design, plan, assign, track and resolve conflicts. You do not build metadata yourself. You cannot change requirements. Ask Jimmy when something is unclear and never invent requirements.

Your internal id is `planner` (the office shows you as Architect). Use `--agent planner` in every status call.

Skills: `superpowers:brainstorming` for rough ideas, `superpowers:writing-plans` for plans and the task board, `superpowers:subagent-driven-development` to run builders task by task, `sf-architecture` for every design, `sf-deploy` for the change set checklist, and the org knowledge skill named by `orgSkill` in `.team/team.json`.

Starting team members: always dispatch with `subagent_type` set to the team member id (`analyst`, `admin`, `developer`, `qa`, `reviewer`), never `general-purpose`, including when `superpowers:subagent-driven-development` dispatches an implementer, tester or reviewer. Otherwise the work lands on a visitor desk.

CLI: `node .team/bin/team-status.mjs <subcommand>` (run from the project root). Your subcommands: `task`, `approval`, `decide`, `escalate`, `release`, `released`.

## Orgs

- The team works only in the sandboxes listed under `orgs.sandbox` in `.team/team.json`. A guard hook blocks every `sf` command aimed at any other org.
- Production is Jimmy's. Never deploy, validate or query there. If a guard block looks wrong, tell Jimmy; never work around it.

## The approval gate

Reading, the story and the design need no approval. Metadata edits, starting builders, sandbox deploys, data changes, installs, pushes and pull requests need an approved Work Order.

1. Ask each agent that will build for a plan summary of 100 words or fewer: goal, metadata or files, approach, effort (S, M or L), risks, what it needs from others.
2. Combine them into a Work Order with `.team/work-order-template.md`, including the design decision and the automation inventory.
3. Record one approval per agent, with its own id and the task, and mark that agent as waiting:
   `node .team/bin/team-status.mjs approval --id WO-3-admin --summary "Renewal discount flow" --agents admin --task T-012`
   `node .team/bin/team-status.mjs approval --id WO-3-developer --summary "Discount service" --agents developer --task T-012`
4. Ask Jimmy per agent (Approve, Reject, Approve with changes) with Claude Code's question prompt. Then stop. No work starts until he answers.
5. Record each decision under its own id:
   `node .team/bin/team-status.mjs decide --id WO-3-admin --state approved --note "Go ahead"`
   States: `approved`, `rejected`, `changes_requested`.
6. After a rejection, revise once using Jimmy's note and resubmit. After a second rejection, ask Jimmy what he wants instead. Build nothing for rejected items.
7. An approved Work Order covers only what its summary says. If scope grows by more than about 25% or touches new objects, submit a new summary first.
8. Run the gate at the start of every build phase and every task batch. Keep it short. Do not re-explain what Jimmy already approved.

## Your own status

Report as `--agent planner`: `awaiting_approval` while you wait on Jimmy, `working` while you design or coordinate, `idle` when nothing is open.
`node .team/bin/team-status.mjs status --agent planner --status awaiting_approval --next "Jimmy decides WO-3"`

## Task board

Add every task with an owner, and update it as it moves:
`node .team/bin/team-status.mjs task --id T-012 --title "Partner renewal discount" --owner admin --state in_progress`
States: `todo`, `in_progress`, `in_review`, `done`. If the project has a GitHub remote, mirror each task as a GitHub Issue with the same id. The office works out each task's progress from these events, so keep them current.

## Running a task

1. Start the Analyst with the request. It writes `docs/stories/<task-id>.md` and hands it to you.
2. Design: run the automation inventory on every object the change touches (see `sf-architecture`), decide declarative or code and say why, and write `docs/design/<task-id>.md`. Send QA the story so test planning starts early.
3. Plan summaries, Work Order, Jimmy's decision (above).
4. Name the feature branch (`feature/T-012-partner-discount`). Never work on `main`.
5. Start the builders (Admin and/or Developer) with the task, branch, Work Order, design and sandbox alias. When both build, the Developer writes the invocable method's name and inputs into the design file before the Admin's flow needs them.
6. Each builder deploys to the sandbox, records `team-status deploy`, and writes `.team/handoffs/<task-id>-<builder id>.md`.
7. Start QA with the story and every builder handoff. QA writes `.team/handoffs/<task-id>-qa.md` and can block the task.
8. Start the Reviewer with the branch (or pull request), `.team/handoffs/<task-id>-<builder id>.md` for each builder, and `.team/handoffs/<task-id>-qa.md`. The Reviewer is the final gate.
9. If QA or the Reviewer rejects, pass their handoff to the builder instead of re-explaining. Write the Reviewer's notes to `.team/handoffs/<task-id>-reviewer.md` from the handoff template.
10. When the Reviewer approves, write the change set checklist (below) and record it:
    `node .team/bin/team-status.mjs release --task T-012 --components 9`
11. Tell Jimmy the checklist is ready, then wait. When he says it is deployed, record it, merge the branch (or the pull request), close the Issue and set the task to `done`. Never force-push.
    `node .team/bin/team-status.mjs released --task T-012`

## The change set checklist

Copy `.team/changeset-template.md` to `docs/release/<task-id>-changeset.md` and fill in every section: components in dependency order (type and API name), steps before deploying, the test level and exact test classes, steps after deploying, rollback, and checks in production. Go through the commonly missed list in the template. Jimmy must be able to follow it in Setup without asking you anything.

## Org knowledge

Every handoff has an "Org knowledge to add" section. Collect those notes and ask Jimmy before adding them to the org knowledge skill. Never write to it without his yes.

## Escalation

After 2 failed rounds on the same task, stop and escalate:
`node .team/bin/team-status.mjs escalate --task T-012 --summary "QA rejected twice on bulk inserts. See handoffs."`
Then tell Jimmy and wait. The escalation clears from the office on the next `task` event for that task id, so record the task's new state once Jimmy decides.

## Keep the board honest

Agents report their own status and handoffs. If an agent shows as stuck, read its reason and decide: unblock it, reassign, or ask Jimmy. Keep tasks, approvals, deploys and releases current at every change.
```

Replace `planner/work-order-template.md` with:

```markdown
# Work Order <WO-id>: <short title>

Tasks: <T-ids>
Story: `docs/stories/<task-id>.md` · Design: `docs/design/<task-id>.md` · Sandbox: `<alias>`

## Design decision
<Declarative, code or both, and why, in two or three sentences.>

## Automation inventory
<For each object the change touches: active flows, triggers, workflow rules and process builders, and the trigger order. Write "None" if there are none.>

| Agent | Task | Plan (100 words or fewer) | Effort (S/M/L) | Risk |
|---|---|---|---|---|
| <agent> | <T-id and title> | <goal, metadata or files, approach, needs from others> | <S/M/L> | <main risk> |

## Recommendation
<Approve all, or say which to change and why.>

## Left out
<What this Work Order deliberately does not cover.>

## Decision
Ask Jimmy per agent: Approve, Reject or Approve with changes. Record each request with `team-status approval --task <task-id>` and each answer with `team-status decide`, one approval id per agent (for example `<WO-id>-admin`).
```

Replace `templates/handoff-template.md` with:

```markdown
# Handoff: <task-id> <task title>

From: <agent>  To: <agent>

## What changed
- Branch: `feature/<task-id>-<name>`
- Pull request: <link or "none">
- Metadata and files: <list what you added or changed>
- Sandbox deploy: <alias>, <passed or failed>, <tests passed/total>, <coverage %>

## How to verify
<Exact commands, records and expected results in the sandbox.>

## Known gaps or risks
<What is unfinished or uncertain. Write "None" if there is nothing.>

## What the next agent needs
<Decisions, method names, test data and anything else, so the next agent does not re-derive context.>

## Org knowledge to add
<Facts about this org that future tasks should know: object quirks, existing automation, naming. Write "None" if there is nothing.>
```

Create `templates/changeset-template.md`:

```markdown
# Change set: <task-id> <title>

Task: <task-id> · Source sandbox: `<alias>` · Prepared by: Architect · Date: <YYYY-MM-DD>

## 1. Summary
<What the change does for users, in two or three sentences.>

## 2. Components to add
Add them to the outbound change set in this order.

| # | Type | API name | Notes |
|---|---|---|---|
| 1 | <Custom Field> | <Opportunity.Partner_Discount__c> | <why it is needed> |

Commonly missed. Check each one, then list it above or write "not needed":
- Field-level security for new fields (permission sets or profiles)
- Record types and their page layout assignments
- Custom metadata records (the records, not only the type)
- The right flow version, and that it is the active one
- Lightning page activations
- Custom labels and custom settings

## 3. Before deploying
<Manual setup in production, for example a new picklist value or a Named Credential secret. Write "None" if there is nothing.>

## 4. Deployment settings
- Test level: <Run specified tests | Run local tests>
- Tests to run: <exact Apex test class names, comma-separated>

## 5. After deploying
<Activate flows, assign permission sets, load data, schedule jobs. Write "None" if there is nothing.>

## 6. Rollback
<How to undo each part, for example deactivate the flow or activate the previous version, or remove a permission set assignment.>

## 7. Check in production
<Two to five read-only checks Jimmy can do right after deploying.>
```

Replace `templates/claude-team-section.md` with:

```markdown
## Team

This project has a six-agent Salesforce team: the Architect (the main session), Analyst, Admin, Developer, QA and Reviewer. Jimmy approves the work and deploys to production himself with change sets. Read `.team/planner.md` for the full rules.

Approval gate:
- Reading, the story and the design need no approval.
- Metadata edits, subagents, sandbox deploys, data changes, installs and pushes need a Work Order Jimmy approved.
- Each agent submits a plan summary of 100 words or fewer. The Architect combines them into a Work Order and asks Jimmy per agent.
- Never push to `main`, never force-push, never commit secrets.

Orgs:
- Work only in the sandboxes listed under `orgs.sandbox` in `.team/team.json`. Never touch production. A guard hook blocks `sf` commands aimed at any other org.

Workflow: the Analyst writes the story, the Architect designs, Jimmy approves, Admin and Developer build in the sandbox, QA verifies, the Reviewer approves, the Architect writes the change set checklist, Jimmy deploys.

Status duties:
- Every agent runs `node .team/bin/team-status.mjs status` when it starts, hits a milestone, gets blocked (`--reason`) and finishes.
- Every agent writes `.team/handoffs/<task-id>-<agent id>.md` (for example `T-012-admin.md`) and runs `team-status handoff` when it finishes.
- Start team members with `subagent_type` set to their id (`analyst`, `admin`, `developer`, `qa`, `reviewer`), never `general-purpose`.
- The Architect records tasks, approvals, decisions, releases and escalations with `team-status`.
```

In `lib/install/plan.mjs`, add to `COPIES` after the `planner/work-order-template.md` line:

```js
  ['templates/changeset-template.md', '.team/changeset-template.md', false],
```

and change `INSTALL_FILES` to:

```js
const INSTALL_FILES = ['.team/planner.md', '.team/work-order-template.md', '.team/changeset-template.md', '.team/handoffs/handoff-template.md'];
```

In `test/install.test.mjs`, add `'.team/changeset-template.md',` to `KIT_FILES` after `'.team/bin/team-status.mjs',`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/planner.test.mjs test/install.test.mjs`
Expected: PASS. If a test in `test/install.test.mjs` reads `templates/claude-team-section.md` and compares text, it reads the new file and still passes; do not hard-code the old text.

- [ ] **Step 5: Commit**

```bash
git add planner templates/handoff-template.md templates/changeset-template.md templates/claude-team-section.md lib/install/plan.mjs test/planner.test.mjs test/install.test.mjs
git commit -m "Architect rules, Work Order, handoff and change set templates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Installer: guard hook, deny rule, ignore block

**Files:**
- Modify: `templates/hooks.json`, `lib/install/text.mjs`, `lib/install/plan.mjs`
- Modify: `test/install.test.mjs` (`KIT_FILES`, `EXECUTABLES`, `.gitignore` expectation), `test/install-text.test.mjs` (only if a test depends on the old marker constant)
- Test: `test/install-salesforce.test.mjs` (create)

**Interfaces:**
- Consumes: `hooks/guard-org.mjs` (Task 8), `lib/guard.mjs` (Tasks 6–7).
- Produces: `KIT_DENY: readonly string[]`, `mergeDeny(settings): settings`, `removeKitDeny(settings): settings` in `lib/install/text.mjs`. Installed files `.team/bin/hooks/guard-org.mjs` (executable) and `.team/bin/lib/guard.mjs`. A PreToolUse `Bash` hook in `settings.json`. `permissions.deny` contains `Bash(sf project deploy quick:*)`. The `.gitignore` block adds `.team/org-cache.json`, `.sf/` and `.sfdx/`.

- [ ] **Step 1: Write the failing test**

Create `test/install-salesforce.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/install-salesforce.test.mjs`
Expected: FAIL (`mergeDeny` is not exported).

- [ ] **Step 3: Implement**

Replace `templates/hooks.json` with:

```json
{
  "SubagentStart": [
    { "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.team/bin/hooks/record.mjs\" agent-start" } ] }
  ],
  "SubagentStop": [
    { "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.team/bin/hooks/record.mjs\" agent-stop" } ] }
  ],
  "Stop": [
    { "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.team/bin/hooks/record.mjs\" turn-end" } ] }
  ],
  "PreToolUse": [
    { "matcher": "Bash", "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.team/bin/hooks/guard-org.mjs\"" } ] }
  ],
  "PostToolUse": [
    { "matcher": "Edit|Write|MultiEdit|NotebookEdit|Bash", "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.team/bin/hooks/record.mjs\" tool" } ] }
  ]
}
```

In `lib/install/text.mjs`:

1. Change the marker constant and its comment:

```js
/** A Kit hook is any hook whose command runs a script in the Kit's hooks folder (recorder or guard). */
const KIT_HOOK_MARKER = '.team/bin/hooks/';
```

2. Append:

```js
/** Permission deny rules the Kit adds: a second lock behind the org guard (spec 3.1). */
export const KIT_DENY = Object.freeze(['Bash(sf project deploy quick:*)']);

/**
 * Add the Kit deny rules once; never mutates the input.
 * @param {Record<string, any>} settings
 * @returns {Record<string, any>}
 */
export function mergeDeny(settings) {
  const out = structuredClone(settings);
  if (!out.permissions || typeof out.permissions !== 'object' || Array.isArray(out.permissions)) out.permissions = {};
  if (!Array.isArray(out.permissions.deny)) out.permissions.deny = [];
  for (const rule of KIT_DENY) if (!out.permissions.deny.includes(rule)) out.permissions.deny.push(rule);
  return out;
}

/**
 * Remove the Kit deny rules, and the deny list or permissions object if that leaves them empty.
 * @param {Record<string, any>} settings
 * @returns {Record<string, any>}
 */
export function removeKitDeny(settings) {
  const out = structuredClone(settings);
  const perms = out.permissions;
  if (!perms || typeof perms !== 'object' || Array.isArray(perms) || !Array.isArray(perms.deny)) return out;
  const kept = perms.deny.filter((/** @type {unknown} */ r) => !KIT_DENY.includes(/** @type {string} */ (r)));
  if (kept.length === perms.deny.length) return out;
  if (kept.length > 0) perms.deny = kept;
  else delete perms.deny;
  if (Object.keys(perms).length === 0) delete out.permissions;
  return out;
}
```

In `lib/install/plan.mjs`:

1. Change the import from `./text.mjs` to also import `mergeDeny, removeKitDeny`.
2. Change `GITIGNORE_BODY` to:

```js
const GITIGNORE_BODY = '.team/events*.jsonl\n.team/org-cache.json\nagent-status.json\n.superpowers/\n.claude/settings.json.bak\n.sf/\n.sfdx/';
```

3. Add to `COPIES` after the `hooks/record.mjs` line:

```js
  ['hooks/guard-org.mjs', '.team/bin/hooks/guard-org.mjs', true],
  ['lib/guard.mjs', '.team/bin/lib/guard.mjs', false],
```

4. In `planInstall`, change the `merged` line to:

```js
  const merged = mergeDeny(mergeHooks(settings, JSON.parse(fs.readFileSync(path.join(kitDir, 'templates', 'hooks.json'), 'utf8'))));
```

5. In `planUninstall`, change `const after = removeKitHooks(settings);` to:

```js
      const after = removeKitDeny(removeKitHooks(settings));
```

In `test/install.test.mjs`:
- Add `'.team/bin/hooks/guard-org.mjs',` and `'.team/bin/lib/guard.mjs',` to `KIT_FILES` (keep the list sorted the way it is).
- Change `EXECUTABLES` to `['.team/bin/cli/team-status.mjs', '.team/bin/hooks/guard-org.mjs', '.team/bin/hooks/record.mjs', '.team/bin/team-status.mjs']`.
- Change the `.gitignore` expectation (line 119) to:

```js
    expect(read('.gitignore')).toBe('# agent-team-kit:start\n.team/events*.jsonl\n.team/org-cache.json\nagent-status.json\n.superpowers/\n.claude/settings.json.bak\n.sf/\n.sfdx/\n# agent-team-kit:end\n');
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/install-salesforce.test.mjs test/install.test.mjs test/install-text.test.mjs`
Expected: PASS. If a test in `test/install.test.mjs` expects a settings file to be deleted on uninstall or to equal the user's original, it still passes because `removeKitDeny` removes the containers it emptied. If one fails only because the fresh-install `settings.json` now has a `permissions` key or a `PreToolUse` hook, update that expectation to include them.

- [ ] **Step 5: Commit**

```bash
git add templates/hooks.json lib/install/text.mjs lib/install/plan.mjs test/install-salesforce.test.mjs test/install.test.mjs test/install-text.test.mjs
git commit -m "Installer: guard hook, quick-deploy deny rule, Salesforce ignore lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Installer checks, git init offer, org skill warning

**Files:**
- Modify: `lib/install/checks.mjs`, `install.mjs`
- Modify: `test/install-checks.test.mjs`, `test/install.test.mjs` (the `cli` helper and the failed-checks test)
- Test: additions in `test/install-checks.test.mjs` and a new `describe` block at the end of `test/install.test.mjs`

**Interfaces:**
- Produces:
  - `checkPrereqs({ targetDir, nodeVersion, homeDir, hasCommand }): string[]`, where `hasCommand(cmd: string, args: string[]): boolean`. No longer checks git or `frontend-design`.
  - `isGitRepo(targetDir: string): boolean`
  - `findSkill({ name, targetDir, homeDir }): string | null`: the folder holding `SKILL.md`, searching `<dir>/.claude/skills/<name>` from the target up to the filesystem root, then `<home>/.claude/skills/<name>`.
  - `install.mjs` `main(argv, io)`: `io` gains `hasCommand(cmd, args): boolean` and `gitInit(dir): boolean`.

- [ ] **Step 1: Write the failing tests**

In `test/install-checks.test.mjs`:
1. Change the import to `import { checkPrereqs, isGitRepo, findSkill } from '../lib/install/checks.mjs';`.
2. Delete the `addPlugin('claude-plugins-official', 'frontend-design');` line in `beforeEach`.
3. Change `run` to:

```js
let has;
const run = (over = {}) => checkPrereqs({ targetDir: target, nodeVersion: 'v24.1.0', homeDir: home, hasCommand: (c, a) => has(c, a), ...over });
```

and add `has = () => true;` at the end of `beforeEach`.
4. Delete the tests named `flags a target that is not a Git repo`, `accepts .git as a file (worktree)` and `flags missing frontend-design only`.
5. Add these tests inside `describe('checkPrereqs', ...)`:

```js
  it('flags a missing sf CLI with the install link', () => {
    has = () => false;
    const m = run();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatch(/Salesforce CLI/);
    expect(m[0]).toMatch(/developer\.salesforce\.com/);
  });
  it('flags a missing Code Analyzer when sf is present', () => {
    has = (c, a) => !(a[0] === 'code-analyzer');
    const m = run();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatch(/sf plugins install code-analyzer/);
  });
  it('does not check git any more', () => {
    rmSync(join(target, '.git'), { recursive: true });
    expect(run()).toEqual([]);
  });
```

6. Append two new `describe` blocks:

```js
describe('isGitRepo', () => {
  it('is true for a .git folder or file and false otherwise', () => {
    expect(isGitRepo(target)).toBe(true);
    rmSync(join(target, '.git'), { recursive: true });
    expect(isGitRepo(target)).toBe(false);
    writeFileSync(join(target, '.git'), 'gitdir: /elsewhere\n');
    expect(isGitRepo(target)).toBe(true);
  });
});

describe('findSkill', () => {
  const skill = (dir, name) => {
    mkdirSync(join(dir, '.claude', 'skills', name), { recursive: true });
    writeFileSync(join(dir, '.claude', 'skills', name, 'SKILL.md'), '---\nname: x\n---\n');
  };
  it('finds a skill in the project, a parent folder or the home folder', () => {
    expect(findSkill({ name: 'org', targetDir: target, homeDir: home })).toBeNull();
    skill(home, 'org');
    expect(findSkill({ name: 'org', targetDir: target, homeDir: home })).toBe(join(home, '.claude', 'skills', 'org'));
    skill(root, 'org');
    expect(findSkill({ name: 'org', targetDir: target, homeDir: home })).toBe(join(root, '.claude', 'skills', 'org'));
    skill(target, 'org');
    expect(findSkill({ name: 'org', targetDir: target, homeDir: home })).toBe(join(target, '.claude', 'skills', 'org'));
  });
  it('a folder without SKILL.md does not count', () => {
    mkdirSync(join(home, '.claude', 'skills', 'empty'), { recursive: true });
    expect(findSkill({ name: 'empty', targetDir: target, homeDir: home })).toBeNull();
  });
});
```

In `test/install.test.mjs`:
1. In the `cli` helper, add two fields to the `io` object passed to `main`:

```js
    hasCommand: o.hasCommand ?? (() => true),
    gitInit: (dir) => spawnSync('git', ['init', '-q'], { cwd: dir }).status === 0,
```

and add `hasCommand` to the helper's options JSDoc: `{ answers?: string[], cwd?: string, homeDir?: string, hasCommand?: (c: string, a: string[]) => boolean }`.
2. Delete the `frontend-design` line in `beforeEach`.
3. Append at the end of the file:

```js
describe('salesforce install checks', () => {
  test('a missing sf CLI stops the install and changes nothing', async () => {
    const before = snapshot();
    const r = await cli(['--target', target, '--yes'], { hasCommand: () => false });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Salesforce CLI/);
    expect(snapshot()).toEqual(before);
  });

  test('offers git init: n stops, y runs it and installs', async () => {
    fs.rmSync(p('.git'), { recursive: true });
    const no = await cli(['--target', target], { answers: ['n'] });
    expect(no.code).toBe(1);
    expect(no.questions[0]).toMatch(/not a Git repository. Run "git init"/);
    expect(exists('.git')).toBe(false);
    const yes = await cli(['--target', target], { answers: ['y', 'y'] });
    expect(yes.code).toBe(0);
    expect(exists('.git')).toBe(true);
    expect(yes.out).toMatch(/Ran git init/);
    expect(exists('.claude/agents/admin.md')).toBe(true);
  });

  test('--yes runs git init without asking', async () => {
    fs.rmSync(p('.git'), { recursive: true });
    const r = await install();
    expect(r.code).toBe(0);
    expect(r.questions).toEqual([]);
    expect(exists('.git')).toBe(true);
  });

  test('warns when the org knowledge skill is not found, and not when it is', async () => {
    const r = await install();
    expect(r.out).toMatch(/org knowledge skill "my-org-knowledge" was not found/);
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'my-org-knowledge'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'skills', 'my-org-knowledge', 'SKILL.md'), '---\nname: my-org-knowledge\n---\n');
    const again = await install();
    expect(again.out).not.toMatch(/was not found/);
  });

  test('the checks line names the Salesforce tools', async () => {
    const r = await install();
    expect(r.out).toMatch(/Checks passed: Node, Git repository, Superpowers plugin, Salesforce CLI and Code Analyzer\./);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/install-checks.test.mjs test/install.test.mjs`
Expected: FAIL (`isGitRepo` and `findSkill` are not exported; no git init offer; no warning).

- [ ] **Step 3: Implement**

Replace `checkPrereqs` in `lib/install/checks.mjs` and add the two helpers:

```js
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
```

In `install.mjs`:

1. Change the header comment's first line to `// salesforce-team-kit installer.`
2. Change the checks import to `import { checkPrereqs, isGitRepo, findSkill } from './lib/install/checks.mjs';` and add `import { spawnSync } from 'node:child_process';` and `import { loadTeam } from './lib/team.mjs';`.
3. Change the `io` JSDoc of `main` to add `hasCommand: (cmd: string, args: string[]) => boolean, gitInit: (dir: string) => boolean`.
4. Replace the `if (!uninstall) { ... }` checks block with:

```js
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
```

5. Add this local function right after `const uninstall = values.uninstall === true;`:

```js
  const warnOrgSkill = () => {
    if (uninstall) return;
    const team = loadTeam(path.join(targetDir, '.team', 'team.json'));
    if (team.ok && team.team.orgSkill && !findSkill({ name: team.team.orgSkill, targetDir, homeDir: io.homeDir })) {
      out(`Warning: the org knowledge skill "${team.team.orgSkill}" was not found in the project, its parent folders or ~/.claude/skills. Agents work without org knowledge until it exists. Set "orgSkill" in .team/team.json to your skill's name.`);
    }
  };
```

   Call it in two places: on the "nothing to do" path, so that block becomes

```js
  if (pending.length === 0) {
    out(`Nothing to do in ${targetDir}; everything is up to date.`);
    warnOrgSkill();
    return 0;
  }
```

   and directly after the line `out(uninstall ? 'Uninstalled. team.json and handoffs were kept.' : 'Installed.');` add `warnOrgSkill();`.

6. In the `isMain()` block at the bottom, add to the `main(...)` io object:

```js
    hasCommand: (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore', timeout: 60_000 }).status === 0,
    gitInit: (dir) => spawnSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }).status === 0,
```

7. In `test/install.test.mjs`, the test `failed checks exit 1 with the problems and change nothing` still uses an empty home (no Superpowers) and still passes. Keep it.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/install-checks.test.mjs test/install.test.mjs test/install-salesforce.test.mjs && npm run lint`
Expected: PASS, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add lib/install/checks.mjs install.mjs test/install-checks.test.mjs test/install.test.mjs
git commit -m "Installer: sf and Code Analyzer checks, git init offer, org skill warning

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: README, package name, real-hook check, full verification

**Files:**
- Rewrite: `README.md`
- Modify: `package.json` (`name`, `description`)
- Test: `test/readme.test.mjs` (create)
- Create: `docs/decisions/S-1-guard-in-claude-code.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing test**

Create `test/readme.test.mjs`:

```js
import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('package is renamed', () => {
  expect(pkg.name).toBe('salesforce-team-kit');
  expect(pkg.description).toMatch(/Salesforce/);
});

test('README covers install, roles, guard limits and the release hand-off', () => {
  expect(readme).toMatch(/^# salesforce-team-kit/m);
  for (const s of ['Architect', 'Analyst', 'Admin', 'Developer', 'QA', 'Reviewer']) expect(readme).toContain(s);
  expect(readme).toContain('.team/handoffs/<task-id>-<agent id>.md');
  expect(readme).toMatch(/escalation clears .*next `task` event for that task id/i);
  expect(readme).toMatch(/git pull[\s\S]*npm ci[\s\S]*install\.mjs/);
  expect(readme).toContain('orgs.sandbox');
  expect(readme).toMatch(/seatbelt, not a sandbox/);
  expect(readme).toContain('docs/release/<task-id>-changeset.md');
  for (const c of ['deploy', 'release', 'released']) expect(readme).toContain(`| \`${c}\` |`);
  expect(readme).toMatch(/Do not authorise production/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/readme.test.mjs`
Expected: FAIL (old name and README).

- [ ] **Step 3: Write the README and rename the package**

In `package.json`, set `"name": "salesforce-team-kit"` and `"description": "Installs a six-role Salesforce Claude Code team, a sandbox-only org guard and a local office dashboard into an SFDX project."`.

Replace `README.md` with:

````markdown
# salesforce-team-kit

A kit that installs a six-role Salesforce team for Claude Code into an SFDX project, plus a local "office" dashboard that shows who is doing what. It is a sibling of `agent-team-kit` (the web-app team) and shares its engine.

The roles are the Architect (the main Claude Code session), Analyst, Admin, Developer, QA and Reviewer. Jimmy approves every Work Order before anyone builds, and deploys to production himself with change sets. Agents only ever work in sandboxes.

The kit adds:

- five subagent files (Analyst, Admin, Developer, QA, Reviewer) in `.claude/agents/`
- Architect rules, a Work Order template and a change set template in `.team/`
- hooks that record what the agents do, and an org guard that blocks `sf` commands aimed at anything but a listed sandbox
- a small command, `team-status`, that agents use to report status, tasks, approvals, deploys and releases
- the office dashboard, which you run from this repo and point at a project

The design is in `docs/superpowers/specs/`.

## Prerequisites

- Node 20 or newer, and Git
- Claude Code with the Superpowers plugin (`/plugin`)
- The Salesforce CLI (`sf`) and Code Analyzer (`sf plugins install code-analyzer`)
- At least one sandbox authorised in the `sf` CLI. **Do not authorise production on the machine the team runs on.** The guard does not rely on this, but it is the strongest protection.

The installer checks Node, Superpowers, `sf` and Code Analyzer and stops with a plain message if something is missing. If the project is not a Git repository, it offers to run `git init` (with `--yes` it runs it without asking).

## Install, update and uninstall

Run these from this repo. Paths with spaces need quotes.

```
node install.mjs --target "../Salesforce Automation Clean up 2026/automation-cleanup"
```

It prints every change it will make and asks `Apply these changes? (y/n)`. Add `--yes` to skip that question.

What it puts in the project:

- `.claude/agents/` with the five subagent files
- `.claude/settings.json` with five hooks (subagent start and stop, file edits and commands, the end of each main-session turn, and the org guard before every Bash command) and one deny rule, `Bash(sf project deploy quick:*)`. Your own settings are kept; the first copy of your file is saved as `settings.json.bak`.
- `.team/bin/` with `team-status.mjs`, the hook scripts and their helpers
- `.team/planner.md`, `.team/work-order-template.md`, `.team/changeset-template.md`, `.team/handoffs/handoff-template.md`
- `.team/team.json` (the team, the approver, `orgs.sandbox` and `orgSkill`; edit it for your project)
- `.team/kit-manifest.json`, a marked "Team" section in `CLAUDE.md` and a marked block in `.gitignore`

Then edit `.team/team.json`:

```json
"orgSkill": "nitro-salesforce",
"orgs": { "sandbox": ["sandbox"] }
```

`orgs.sandbox` lists the `sf` aliases the team may use. `orgSkill` names a skill with knowledge about your org; the installer warns if it can't find it.

Update, from this repo:

```
git pull
npm ci
node install.mjs --target "../my-project"
```

Uninstall:

```
node install.mjs --target "../my-project" --uninstall
```

This removes the kit's files, hooks, the deny rule and the marked blocks. It keeps `.team/team.json`, your handoffs in `.team/handoffs/`, `.claude/settings.json.bak` and the activity logs.

## Running the office

```
npm ci
npm run office -- --project "../my-project"
```

It prints `Office is open at http://127.0.0.1:4317` and opens your browser. The dashboard binds to `127.0.0.1` only.

## How a task runs

1. You talk to Claude Code in the project. The main session is the Architect and follows `.team/planner.md`.
2. The Analyst writes the story and acceptance criteria to `docs/stories/<task-id>.md`.
3. The Architect runs an automation inventory on the affected objects, decides declarative or code, and writes `docs/design/<task-id>.md`.
4. Admin and Developer each send a plan summary of 100 words or fewer. The Architect records one approval per agent per Work Order (for example `WO-3-admin` and `WO-3-developer`, each with `--task`) and asks you to approve, reject or approve with changes.
5. After you approve, the builders retrieve, build on a feature branch and deploy to the sandbox. QA tests against the acceptance criteria and can block. The Reviewer is the final gate.
6. Each agent writes `.team/handoffs/<task-id>-<agent id>.md` when it finishes, so the next agent does not need the story repeated.
7. The Architect writes the change set checklist to `docs/release/<task-id>-changeset.md` and records `team-status release`. You build the change set in the sandbox, upload it and deploy in production. Then the Architect records `team-status released`, merges and closes the task.
8. After two failed rounds on one task, the Architect escalates to you. The escalation clears on the next `task` event for that task id.

## team-status reference

Agents and the Architect use it from the project root. Every call appends one line to `.team/events.jsonl`.

| Subcommand | Flags |
|---|---|
| `status` | `--agent <id> --status <status> [--task <id>] [--progress <0-100>] [--next <text>] [--reason <text>]` |
| `task` | `--id <id> --title <text> --owner <agent> --state <state> [--notes <text>]` |
| `approval` | `--id <id> --summary <text> [--agents a,b] [--task <id>]` |
| `decide` | `--id <id> --state <state> [--note <text>]` |
| `handoff` | `--from <agent> --to <agent> --task <id> [--file <path>]` (default file `.team/handoffs/<task>-<from>.md`) |
| `escalate` | `--task <id> --summary <text>` |
| `deploy` | `--agent <id> --org <alias> --result <passed\|failed> [--tests <passed>/<total>] [--coverage <0-100>] [--task <id>]` |
| `release` | `--task <id> --components <n> [--file <path>]` (default file `docs/release/<task>-changeset.md`) |
| `released` | `--task <id> [--note <text>]` |

Each task's progress (a percentage and a stage) is worked out from these events: 5% to do, 20% waiting for approval, 30–60% building, 65% in the sandbox, 80% QA passed, 90% review passed, 95% change set ready, 100% released. Work sent back by QA or the Reviewer moves it down again.

## The org guard

Before every Bash command, `.team/bin/hooks/guard-org.mjs` checks each `sf` call in it, including chained commands, `$(…)`, `bash -c "…"` and `eval`. It finds the target org from `-o`/`--target-org` (and `--target-dev-hub`, `--from-org`), or from the project's or your global default org.

- The alias must be listed under `orgs.sandbox` in `.team/team.json`.
- Its instance URL must be a sandbox domain (looked up once a day with `sf org display` and cached in `.team/org-cache.json`; the access token in that output is never printed or stored).
- Always blocked: `sf project deploy quick`, `sf org display`, `sf org open --url-only`, `sf org list --json`, `sf org login`, `sf org logout`, and the legacy `sfdx` command.
- `xargs … sf …` and scripts that contain `sf` commands are blocked; run those `sf` commands directly.

A block shows the reason to the agent and puts a "Guard blocked" line in the office.

## Known limits

- **The guard is a seatbelt, not a sandbox.** An agent calling the Salesforce REST API directly (for example with `curl`) would get past it. The agent rules forbid this and the Reviewer checks for it. `npm run` scripts that call `sf` are not inspected.
- **Hook data.** What the hooks receive was captured with Claude Code 2.1.290 (`docs/decisions/S-0-hook-input.md`); the guard's block behaviour was checked as described in `docs/decisions/S-1-guard-in-claude-code.md`.
- **Agents may skip status calls.** The hooks still record when each agent starts and stops and which files and commands it touches.
- **Hook text is not a redaction layer.** Do not treat the log as private.
- **One kit per project.** This kit and `agent-team-kit` both install into `.team/` and `.claude/agents/`.

## Development

```
npm ci
npm run lint
npm run typecheck
npm test
npm run test:e2e
```
````

- [ ] **Step 4: Run the README test and the full suite**

Run: `npx vitest run && npm run lint && npm run typecheck`
Expected: every test file passes; no lint or type errors.

- [ ] **Step 5: Check the guard inside real Claude Code (spike S-1)**

This proves that exit code 2 from a PreToolUse hook really stops the Bash call in the installed Claude Code version. `--allowedTools "Bash"` makes sure the normal permission prompt does not stop the command first, so only the guard can block it. The `prod` alias does not exist on this machine, so even an unblocked run cannot reach production.

```bash
SCRATCH=$(mktemp -d)
mkdir "$SCRATCH/proj" && cd "$SCRATCH/proj" && git init -q
node "/Users/jvo/Desktop/Claude-salesforce Project/salesforce-team-kit/install.mjs" --target . --yes
node -e 'const f=".team/team.json";const t=JSON.parse(require("fs").readFileSync(f));t.orgs={sandbox:["sandbox"]};require("fs").writeFileSync(f,JSON.stringify(t,null,2))'
claude -p "Run exactly this Bash command and report its output: sf data query -o prod -q \"SELECT Id FROM User LIMIT 1\"" --allowedTools "Bash"
claude -p "Run exactly this Bash command and report its output: sf org list" --allowedTools "Bash"
tail -3 .team/events.jsonl
claude --version
```

Expected: the first run reports the command was blocked with `"prod" is not listed as a sandbox`, and `events.jsonl` has a `guard_blocked` line. The second run executes normally. If the first command was **not** blocked, stop and report it to Jimmy: the hook output contract must change before this kit is used.

Write `docs/decisions/S-1-guard-in-claude-code.md` with: the Claude Code version, the two commands, what happened, the `guard_blocked` event line (it holds no secrets), and the conclusion. Use the structure of `docs/decisions/S-0-hook-input.md` (Method, Results, Decision). Then delete the scratch folder: `rm -rf "$SCRATCH"`.

- [ ] **Step 6: Run the end-to-end tests**

Run: `npm run build && npm run test:e2e`
Expected: PASS. The office still renders with the new six-role team; the dashboard redesign is Plan 3. If Playwright reports missing browsers, run `npx playwright install chromium` once and re-run.

- [ ] **Step 7: Commit**

```bash
git add README.md package.json test/readme.test.mjs docs/decisions/S-1-guard-in-claude-code.md
git commit -m "README and package for salesforce-team-kit; guard checked in Claude Code

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Publish to a private GitHub repo

**Files:** none

This step is outward-facing. **Ask Jimmy before running it**, and show him the exact commands.

- [ ] **Step 1: Confirm with Jimmy**

Ask: "Create the private GitHub repo `Jimmyvo23/salesforce-team-kit` and push `main`, `spec/salesforce-team-kit` and `feature/sf-core`?" Continue only on yes.

- [ ] **Step 2: Create the repo and push**

```bash
cd "/Users/jvo/Desktop/Claude-salesforce Project/salesforce-team-kit"
gh repo create Jimmyvo23/salesforce-team-kit --private --description "Six-role Salesforce Claude Code team with a sandbox-only org guard and an office dashboard"
git remote add origin https://github.com/Jimmyvo23/salesforce-team-kit.git
git push -u origin main spec/salesforce-team-kit feature/sf-core
git remote -v
```

Expected: `origin` (fetch and push) points to the new repo; `upstream` push still shows `DISABLED-read-only-upstream`.

- [ ] **Step 3: Open the pull request**

```bash
gh pr create --base main --head feature/sf-core --title "Plan 1: core Salesforce team kit" --body "$(cat <<'EOF'
Implements Plan 1 of the Salesforce Team Kit (docs/superpowers/plans/2026-10-15-core-team-kit.md): six roles, sandbox-only org guard, deploy/release events, task progress and installer changes.

The spec branch is included as the base of this work.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: a pull request URL. CI (`.github/workflows/ci.yml`) runs lint, typecheck and tests. Jimmy merges after review. On a private repo with GitHub Free, branch protection is not enforced (spec D-09), so nobody pushes to `main` directly.
