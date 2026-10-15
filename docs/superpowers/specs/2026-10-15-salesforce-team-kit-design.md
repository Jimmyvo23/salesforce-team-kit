# Salesforce Team Kit — Design Spec

- **Date:** 2026-10-15
- **Status:** Draft, awaiting Jimmy's review
- **Owner:** Jimmy (approver)
- **Author:** Brainstorming session (Claude Code)
- **Visual reference:** [2026-10-15-salesforce-team-kit-office-mockup.html](2026-10-15-salesforce-team-kit-office-mockup.html) (approved direction: isometric studio on a cloud, mood follows the clock). Open it in a normal browser, not the VS Code preview.
- **Based on:** [2026-10-05-agent-team-kit-design.md](2026-10-05-agent-team-kit-design.md), the web-app kit this repo was cloned from.

---

## 1. Purpose

Jimmy wants a **Salesforce expert team** of Claude Code agents: an architect, a business analyst, an admin, a developer, a QA and a reviewer. The team works the way his `agent-team-kit` web team does (Work Order approval, handoffs, a live office dashboard), but its knowledge, rules and safety are built for Salesforce work in sandboxes.

This is a **new repo**, `salesforce-team-kit`. It starts as a clone of `agent-team-kit` with full history. `agent-team-kit` stays unchanged and is the read-only `upstream` remote, so engine fixes can be pulled in later. Nothing is ever pushed to it.

### Success criteria

1. One command installs the Salesforce team into any SFDX project (offering `git init` when needed); re-running updates cleanly; uninstall leaves the project as it was.
2. Agents can only touch orgs listed as sandboxes. Any `sf` command aimed at another org, including production, is blocked by a hook, and the block shows in the office.
3. Every finished task ends with a change set checklist that Jimmy can follow in Setup without asking questions.
4. In skill pressure tests, agents with the Salesforce skills avoid the failures recorded without them (for example: no automation inventory, SOQL in loops, missing FLS checks, coverage-only tests).
5. The office shows the team as an isometric studio on a cloud whose colours follow the time of day, with the sandbox deploy state, the change set hand-off and guard blocks visible at a glance.
6. All existing engine tests (state, server, CLI, hooks, installer) still pass, plus the new tests in section 9.

---

## 2. Requirements, preferences, assumptions, recommendations

### Requirements (stated by Jimmy)
- R1. A Salesforce team, built from the agent-team-kit approach, as a separate repo saved locally and on his GitHub.
- R2. Roles: Architect, Business Analyst, Admin, Developer, QA, Reviewer.
- R3. **Agents always work in sandboxes.** Jimmy personally deploys to production using change sets.
- R4. Version control: git required in each project, GitHub optional.
- R5. Generic Salesforce expertise ships with the kit; org knowledge (such as the `nitro-salesforce` skill) plugs in per project.
- R6. Agents use the `sf` CLI and Salesforce Code Analyzer.
- R7. The dashboard is redesigned with Impeccable, is fun to watch, and has a light Salesforce flavour.

### Preferences (chosen during brainstorming)
- P1. Office style: **isometric studio** (design 1), floating **on a cloud** (design 5).
- P2. Colour: the office **mood follows the clock**, blending Sunrise, Mint morning, Twilight and Night shift.
- P3. Characters, desks and chips stay as in the approved mockup.

### Assumptions (to confirm)
- A1. The `sf` CLI (v2) and Code Analyzer v5 (`sf code-analyzer`) are installed on Jimmy's machine before the build.
- A2. Change sets can't be created through the `sf` CLI, so building and uploading the change set stays manual.
- A3. Production is not authorised in the `sf` CLI on this machine. The guard does not rely on this (see section 5), but the README recommends it.
- A4. The Claude Code hook input format captured in `docs/decisions/S-0-hook-input.md` still holds for PreToolUse on Bash.

### Recommendations (adopted unless Jimmy objects)
- Rec1. Keep the main session's internal id `planner` (display name "Architect") so the engine code stays identical to upstream.
- Rec2. Developer and Reviewer run on opus; Analyst, Admin and QA on sonnet.
- Rec3. Don't authorise production in the `sf` CLI at all on the machine the team runs on.
- Rec4. Decide whether the GitHub repo is public or private before the first push. The kit is public for free branch protection; keep org-specific details out of this repo either way (they live in the org skill).

---

## 3. Repo and what changes

```
salesforce-team-kit/
  agents/       analyst.md admin.md developer.md qa.md reviewer.md      replaces backend/frontend/tester/reviewer
  planner/      planner.md (Architect rules), work-order-template.md     rewritten for Salesforce
  skills/       sf-architecture/ sf-apex/ sf-flow/ sf-security/
                sf-testing/ sf-deploy/ sf-review/                         new; installed to .claude/skills/
  hooks/        record.mjs (unchanged), guard-org.mjs                     guard is new
  templates/    team.json, handoff-template.md, changeset-template.md, claude-team-section.md
  lib/install/  checks.mjs, plan.mjs                                      new checks and copy list
  cli/          team-status.mjs                                           three new subcommands
  lib/state.mjs                                                           three new event types
  dashboard/    server unchanged; view rebuilt as IsoOffice
```

### 3.1 Engine changes (kept small for upstream merges)
- **Installer copy list** (`lib/install/plan.mjs` `COPIES`): the five new agent files, `guard-org.mjs`, the seven skill folders (`.claude/skills/<name>/…`, added to `INSTALL_DIRS` so update and uninstall handle them), and `changeset-template.md`.
- **Installer checks** (`lib/install/checks.mjs`): Node 20+, git (if the target is not a repo, offer `git init` and continue on yes), `sf` CLI present, Code Analyzer present, Superpowers plugin. The `frontend-design` check is removed. A warning (not a stop) when `orgSkill` from `team.json` is not found in the project's or the user's `.claude/skills`.
- **Hooks** (`templates/hooks.json`): adds a PreToolUse hook for Bash that runs `guard-org.mjs`. The existing four recording hooks are unchanged.
- **Settings deny rules:** the installer adds `Bash(sf project deploy quick:*)` to `permissions.deny`, tracked like the kit's hooks so uninstall removes it. Deny rules match command prefixes only, so they are a best-effort second lock; the guard is the real check.
- **.gitignore block:** adds `.sf/` and `.sfdx/` to the kit's marked block.

### 3.2 `team.json`
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
The shipped template uses neutral example values. In Jimmy's projects, `orgSkill` is `nitro-salesforce`. `lib/team.mjs` reads `orgs` and `orgSkill`; the CLI and state engine ignore them.

---

## 4. Roles and rules

| Role | Id | Model | Can change | Can't change | Skills |
|---|---|---|---|---|---|
| Architect (main session) | `planner` | session | plans, Work Orders, `docs/design/`, `docs/release/` | metadata (delegates) | brainstorming, writing-plans, subagent-driven-development, `sf-architecture`, `sf-deploy`, org skill |
| Analyst | `analyst` | sonnet | `docs/` only | `force-app/` | `sf-architecture`, org skill |
| Admin | `admin` | sonnet | declarative metadata: flows, objects, fields, validation rules, formulas, permission sets, layouts, Lightning pages, reports, custom metadata | Apex, LWC | `sf-flow`, `sf-security`, `sf-deploy`, verification, org skill |
| Developer | `developer` | opus | Apex classes and triggers, LWC, integrations, Apex tests for its own code | flows, declarative config | `sf-apex`, `sf-security`, `sf-deploy`, test-driven-development, systematic-debugging, org skill |
| QA | `qa` | sonnet | test classes and Flow tests only | other metadata | `sf-testing`, verification, systematic-debugging, org skill |
| Reviewer | `reviewer` | opus | nothing (no Edit or Write tool) | everything | `sf-review`, `sf-security`, requesting-code-review, org skill |

### 4.1 Task flow
1. **Analyst** writes the user story and acceptance criteria (Given/When/Then) to `docs/stories/<task-id>.md`.
2. **Architect** writes the design to `docs/design/<task-id>.md`. It must include the **declarative-vs-code decision** with its reason and an **automation inventory** of the affected objects (existing flows, triggers, legacy workflow rules and process builders, trigger order).
3. Plan summaries, Work Order, and Jimmy's decision per agent, exactly as in the kit's approval gate.
4. **Admin** and/or **Developer** retrieve the latest metadata from the sandbox, build on `feature/<task-id>-<name>`, deploy to the sandbox, and write a handoff.
5. **QA** tests against the acceptance criteria in the sandbox. It can block the task and send it back.
6. **Reviewer** gives the verdict: a PR comment when the project has a GitHub remote, otherwise in its final message, with the Architect writing `.team/handoffs/<task-id>-reviewer.md`.
7. **Architect** writes the change set checklist (section 6) and records `team-status release`.
8. **Jimmy** builds the change set, uploads it and deploys in production. Then he tells the Architect, who records `team-status released` and sets the task to `done`. The Architect merges the branch (or the PR).

### 4.2 Shared rules (all agents)
Kept from the kit: no work before approval, never push to `main`, never force-push, never commit secrets, stop and tell the Architect if scope grows by about 25%, escalate after two failed rounds, always hand off with a file.

Added for Salesforce:
- Work only in orgs listed under `orgs.sandbox`. Never call Salesforce APIs directly with `curl` or similar.
- Retrieve before editing, so changes others made in the sandbox are not overwritten.
- Never use real customer data in tests or documents; use test data factories and made-up records.
- Handoffs get a new section, **"Org knowledge to add"**. The Architect asks Jimmy before updating the org skill.

---

## 5. Org safety: `guard-org.mjs`

A PreToolUse hook on every Bash call. It reads the command from the hook input, splits it on `&&`, `||`, `;`, `|` and `$(…)`/backticks, and checks every `sf` or `sfdx` invocation.

### 5.1 Target org
- `--target-org <alias>` or `-o <alias>` on the command.
- Otherwise the project default: `target-org` in `.sf/config.json`.
- Otherwise the global default (`~/.sf/config.json`).
- No resolvable target: treated as an unknown org.

### 5.2 Decision table

| Target | Read (`project retrieve`, `data query`, `org display`, `apex run test`, `code-analyzer`) | Write (`project deploy start/validate`, `project delete source`, `data create/update/delete/upsert/import/bulk`, `apex run`, `package install`, `org delete`) |
|---|---|---|
| Alias listed in `orgs.sandbox` with a sandbox instance URL | allow | allow |
| Any other alias, or none | **block** | **block** |
| Listed alias whose instance URL is not a sandbox domain | **block** | **block** |

Always blocked, whatever the target: `project deploy quick`, `org display --verbose`, and any `org` auth command run with `--json` (these print auth tokens or URLs).

Commands outside the `sf` CLI's org-free subcommands (`sf project generate`, `sf --version`, `sf help` and similar) pass without a target check.

### 5.3 Sandbox URL check
For each command on a listed alias, the guard resolves the instance URL once per alias with `sf org display -o <alias> --json` and caches it in `.team/org-cache.json` (git-ignored) for 24 hours. A sandbox URL contains `.sandbox.my.salesforce.com` (or the legacy `cs<NN>.salesforce.com` and `<domain>--<sandbox>.my.salesforce.com` patterns, kept in one list in `guard-org.mjs`). Anything else is treated as production and blocked.

### 5.4 Fail-closed cases
- `sf` run through `eval`, `xargs`, `bash -c`, `sh -c`, or a script file: blocked unless the command is clearly a read.
- The hook can't read `team.json` or the cache, or `sf org display` fails: block, with a reason telling the agent what to fix.

### 5.5 What a block does
- Returns the PreToolUse "deny" decision with a plain reason, for example: "Blocked: `uat2` is not listed as a sandbox in .team/team.json. Ask Jimmy to add it."
- Appends a `guard_blocked` event (agent, command summary, reason) to `.team/events.jsonl`, using the same redaction as the recording hook.

### 5.6 Known limit
The guard is a seatbelt, not a sandbox. An agent that calls the Salesforce REST API directly would get around it. The agent rules forbid this and the Reviewer checks for it. The README says so, the same way the kit documents its hook limits.

---

## 6. The change set checklist

Change sets can't be created through the CLI, so the hand-off to Jimmy is a document: `docs/release/<task-id>-changeset.md`, from `templates/changeset-template.md`.

1. **Summary:** what the change does, the task id, the source sandbox.
2. **Components to add**, in dependency order, as a table: type, API name, notes. The template lists the commonly missed items: field-level security (via profiles or permission sets), record types, custom metadata records, flow versions, Lightning page activations, custom labels.
3. **Pre-deploy steps** (manual setup in production, such as a picklist value or a Named Credential secret).
4. **Deployment settings:** test level and, for "Run specified tests", the exact class list.
5. **Post-deploy steps:** activate flows, assign permission sets, load data, schedule jobs.
6. **Rollback:** how to undo each part (deactivate the flow or revert to the previous version, remove a permission set assignment, and so on).
7. **Verification in production:** two to five read-only checks Jimmy can do after deploying.

The Architect also runs `team-status release --task <id> --components <n> --file <path>`.

---

## 7. Skills

Seven skills in `skills/`, installed to the project's `.claude/skills/`. Each is a short `SKILL.md` plus reference files. They read the API version from `sfdx-project.json` (`sourceApiVersion`) instead of naming a release.

| Skill | Used by | Covers |
|---|---|---|
| `sf-architecture` | Architect, Analyst | Before-save flow vs after-save flow vs Apex decision rules; order of execution; one trigger per object with a handler; the automation inventory procedure (Tooling API queries for flows, triggers, workflow rules and process builders on an object, plus trigger order); lookup vs master-detail; large data volumes; integration patterns (Platform Events, change data capture, Named Credentials); platform gotchas such as formula compiled size and before-save flow limits. |
| `sf-apex` | Developer | Bulkification; no SOQL or DML in loops; `WITH USER_MODE` and `Security.stripInaccessible`; `with sharing` by default; choosing Queueable, Batch or Scheduled; custom metadata instead of hard-coded values; no hard-coded IDs; test data factory; `Assert` class; `HttpCalloutMock`; LWC basics (wire, Lightning Data Service, SLDS, Jest). |
| `sf-flow` | Admin | Flow type choice; tight entry conditions; fault paths on every write or callout; no DML in loops; subflows; naming; versions and activation; Flow tests; replacing retired Workflow Rules and Process Builder. |
| `sf-security` | Admin, Developer, Reviewer | CRUD/FLS; sharing; permission sets and permission set groups instead of profiles; guest users; SOQL injection; LWC XSS; secrets only in Named Credentials. |
| `sf-testing` | QA | Test plans from acceptance criteria; positive, negative, 200-record bulk and `System.runAs` permission tests; coverage as a floor and asserts as the goal; running tests in the sandbox and reading JSON results; UAT checks with SOQL. |
| `sf-deploy` | Admin, Developer, Architect | Retrieve before editing; manifests; `--dry-run` first; dependency order; reading deploy errors; the change set checklist format. |
| `sf-review` | Reviewer | The review checklist (CRUD/FLS and `USER_MODE`, sharing keywords, SOQL or DML in loops, hard-coded IDs, automation overlap, test asserts, direct API calls, rollback plan); running `sf code-analyzer run`; severity thresholds that block a task; the verdict format. |

### 7.1 How the skills are built and checked
Each skill is written with `superpowers:writing-skills`:
1. Write 3–5 pressure scenarios per skill, for example "Add a field update when an Opportunity closes" (does the agent run an automation inventory first?) or "Write a trigger for Contacts" (bulkified, handler, `USER_MODE`?).
2. Run each scenario with a subagent that has no skill. Record the failures.
3. Write the skill to fix those failures, using current Salesforce documentation (checked while writing, not from memory).
4. Re-run the scenarios with the skill. A skill is done when all its scenarios pass.

Scenarios and results are kept in `skills/<name>/tests/` so they can be re-run when a skill changes.

### 7.2 Org skill
`team.json` `orgSkill` names a skill that every agent file loads. It is not shipped in this repo. The installer only checks that it exists.

---

## 8. Dashboard: the isometric cloud office

### 8.1 Kept
The server, state engine, API, 3-second polling, and the logic of `Clipboard`, `Lobby` (task board), `ListView`, `NeedsYouSign`, `PreviewCard` and `StatusOverlay`.

### 8.2 Replaced
`Building`, `Room`, `Figure` and `MailTube` are replaced by `IsoOffice`, an SVG scene built from `team.json`:
- One desk per member, three per row, in `team.json` order. The approver sits in a glass corner office.
- The office floats on a cloud. A **sandbox cloud** sits top right and a **production vault cloud** bottom right ("Production · deployed by Jimmy via change set").
- Each person has a chip: status dot, name, current task. Working people type; blocked people get a red monitor and a blinking dot.
- Layout maths live in a pure module, `iso.ts` (projection, desk positions for any member count), so they can be unit tested.

### 8.3 Events shown in the office

| Office shows | Source |
|---|---|
| Status chip and animation | `status` events (unchanged) |
| A person walking a folder from one desk to the next | `handoff` events (replaces the mail tube) |
| A parcel flying to the sandbox cloud, then ✓ or ✗ with tests and coverage | new `deploy` event |
| A parcel on Jimmy's desk: "Change set ready · N components" | new `release` event |
| The parcel moves into the production vault | new `released` event |
| "🛡 Guard blocked" bubble at the agent's desk, for about a minute | new `guard_blocked` event (from the hook) |
| The bobbing "Jimmy · WO-n ✋" sign | pending approvals and escalations (unchanged) |

### 8.4 New CLI subcommands
| Subcommand | Flags |
|---|---|
| `deploy` | `--agent <id> --org <alias> --result passed\|failed [--tests <passed>/<total>] [--coverage <0-100>] [--task <id>]` |
| `release` | `--task <id> --components <n> [--file <path>]` (default `docs/release/<task>-changeset.md`) |
| `released` | `--task <id> [--note <text>]` |

`lib/state.mjs` folds these into `state.deploys` (latest per org), `state.releases` (per task: `ready` or `released`) and `state.guardBlocks` (last 10). The Clipboard shows an agent's last deploy; the List view gets a "Releases" section.

### 8.5 Day cycle
`mood.ts` exports `moodAt(date)`, a pure function that returns a blended palette. Keyframes in local time:

| Hour | 0–5 | 7–9.5 | 10.5–16.5 | 17.5–19.5 | 21–24 |
|---|---|---|---|---|---|
| Mood | Night shift | Sunrise | Mint morning | Twilight | Night shift |

Between keyframes, every colour blends linearly; stars, lamp glow and the sun or moon fade in and out. The scene re-renders the palette once a minute. The four palettes are the ones in the mockup.

The theme picker replaces Cozy day / Night shift / Pastel with **Auto** (default) plus the four moods to pin. The choice is stored in `localStorage` (wrapped in try/catch). Page chrome (toolbar, clipboard, board, list view) takes its tokens from the current mood, so Night shift gives dark panels.

### 8.6 Interaction and accessibility
- Desks are focusable buttons. Click or Enter opens the Clipboard. Each has an accessible label such as "Developer, blocked: 1 Apex test failing".
- With `prefers-reduced-motion`, nothing walks, drifts, flies or bobs; states change in place.
- Below 480px the page opens in List view (unchanged).
- Status is never shown by colour alone: chips carry text and the List view has the same information.

### 8.7 Impeccable
During the build: install the Impeccable plugin, run `/impeccable init` with this spec and the mockup as context, then run `critique`, `audit` and `polish` on the office scene, the Clipboard, the board and the List view. The mockup is a sketch; Impeccable sets the final type, spacing and detail.

---

## 9. Testing

| Area | Tests |
|---|---|
| Guard | Table-driven tests with about 40 real commands: chained commands, `-o` vs `--target-org`, project and global defaults, unknown aliases, the mislabelled-alias case (mocked `sf org display`), `eval`/`bash -c`, always-blocked commands, cache expiry. |
| Installer | Existing tests updated for the new copy list; new tests for the `sf`/Code Analyzer checks, the `git init` offer, deny rules added and removed, and the org skill warning. |
| CLI and state | New tests for `deploy`, `release`, `released` and `guard_blocked`; all existing state, server and CLI tests pass unchanged. |
| Dashboard units | `moodAt` (keyframes, blends, midnight wrap), `iso.ts` layouts for 3, 6 and 9 members. |
| End to end | Playwright specs updated for the new office; screenshots of all four moods with a fixed clock; reduced-motion run; phone width opens List view. |
| Skills | Pressure scenarios per skill (section 7.1). |
| CI | The kit's existing workflow: lint, typecheck, unit tests, e2e. |

---

## 10. Out of scope (for now)
- Any production access by agents, including validate-only deploys.
- Creating change sets automatically.
- The Salesforce MCP connector.
- Extra roles (release manager, data and integration specialist, org auditor). They can be added later as new members.
- Running the web team and the Salesforce team in the same project.
- Approving Work Orders from the dashboard (approvals stay in Claude Code, as in the kit).

---

## 11. Decisions log
| # | Decision | Why |
|---|---|---|
| D-01 | New repo cloned from `agent-team-kit` with history; upstream is read-only (push URL disabled) | Keep engine fixes mergeable without risking the original kit |
| D-02 | Six roles: Architect, Analyst, Admin, Developer, QA, Reviewer | Jimmy's choice; Analyst picked from the optional roles |
| D-03 | Agents use sandboxes only; Jimmy deploys to production with change sets | Jimmy's rule |
| D-04 | Git required, GitHub optional | Most of Jimmy's SFDX projects aren't on GitHub yet |
| D-05 | Generic skills in the kit, org knowledge as a plug-in skill | Reusable for other orgs; org knowledge grows over time |
| D-06 | `sf` CLI plus Code Analyzer; no MCP | Commands a hook can read and block |
| D-07 | Isometric studio on a cloud, mood follows the clock | Chosen from five designs and four moods |
| D-08 | Keep `planner` as the Architect's internal id | Engine stays identical to upstream |
