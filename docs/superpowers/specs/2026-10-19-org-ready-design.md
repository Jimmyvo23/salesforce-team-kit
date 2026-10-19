# Org-Ready Setup — Design Spec

- **Date:** 2026-10-19
- **Status:** Draft for Jimmy's review
- **Owner:** Jimmy (approver)
- **Extends:** [2026-10-15-salesforce-team-kit-design.md](2026-10-15-salesforce-team-kit-design.md) (sections 3.2 `team.json`, 5 org guard, 7.2 org skill)

---

## 1. Purpose

Jimmy wants to reuse the team on every Salesforce org he connects, with one SFDX project per org. The kit already installs per project. What is missing is a fast, safe first setup for a new org and a way to update every project after the kit changes.

### Success criteria

1. On a new org's project, one `node install.mjs --target <project>` run asks which sandboxes the team may use, offers only aliases whose instance URL is a sandbox, and writes them to `orgs.sandbox`.
2. The same run creates a skeleton org-knowledge skill in the project and points `orgSkill` at it, plus a ready story `docs/stories/T-000-org-discovery.md` that the team runs to fill the skill.
3. `node install.mjs --update-all` updates every project the kit is installed in.
4. No step prints or stores an access token, and a production alias can never be written to `orgs.sandbox` by setup.

## 2. Decisions (made with Jimmy, 2026-10-19)

- **Only Jimmy uses the kit.** "Jimmy" stays hard-coded in agents, templates and guard messages. No approver-name templating.
- **One SFDX project per org.** No multi-org switching inside a project.
- **Setup lives in the installer** (not a separate command, not an agent conversation), because the alias lookup runs `sf org display`, which the guard forbids agents to run.
- **Aliases: detect, check, confirm.**
- **Org skill: skeleton plus a first discovery task.**
- **Updates: the kit remembers projects; `--update-all` updates them.**

## 3. First-run setup

Setup runs when the install creates `.team/team.json` (a first install), or when `--setup` is passed. It never runs with `--uninstall` or `--update-all`.

### 3.1 Project name

Default: `name` from `sfdx-project.json` when present, otherwise the project folder name. Asked once ("Project name [default]:"); Enter keeps the default. Written to `project` in `team.json`.

### 3.2 Sandbox aliases

1. Read alias → username pairs from `~/.sfdx/alias.json` and `~/.sf/alias.json` (usernames only, no tokens), the same files the guard reads. Merge by alias.
2. For each alias, look up the instance URL with `sf org display -o <alias> --json`, keep only `result.instanceUrl` and discard everything else in memory. Never print the output. Ten-second timeout per alias, as the guard uses.
3. Classify with the guard's `isSandboxUrl` (`lib/guard.mjs`), so setup and guard cannot disagree.
4. Show a numbered list of sandboxes, with already-listed aliases pre-selected, then the skipped aliases with a reason: `not a sandbox (<host>)` or `could not look up`. Jimmy types the numbers to use (comma-separated; Enter keeps the pre-selection).
5. Write the chosen aliases to `orgs.sandbox`, replacing the previous list. Only aliases classified as sandboxes can be chosen.

With `--yes` (no questions) setup chooses no aliases: on a first install `orgs.sandbox` stays `[]` and the installer prints `No sandboxes chosen. Run node install.mjs --target <project> --setup to choose them.` The guard blocks every `sf` org command until then, which is the safe default. On a re-run with `--yes --setup`, the existing list is kept.

When no alias file exists or no sandbox is found, setup says so, explains `sf org login web --alias <name> --instance-url https://test.salesforce.com` (Jimmy runs it himself), and leaves the list as it was.

### 3.3 Org-knowledge skill skeleton

1. Ask for a short org name (default: the project name lower-cased, non-alphanumerics to `-`). The skill is `<org>-org`, at `.claude/skills/<org>-org/SKILL.md` in the project.
2. If `orgSkill` in `team.json` already names a skill that `findSkill` finds, ask before switching (default: keep it).
3. Write the skeleton only when the file does not exist. It is never overwritten, never listed in the kit manifest and never removed by uninstall: it is Jimmy's knowledge.
4. Set `orgSkill` to the skill name.

Skeleton content (frontmatter `name: <org>-org`, `description: Use when working in the <Project> Salesforce org: its sandboxes, automation per object, key objects and fields, Apex and integrations, conventions and known gotchas.`), with these sections, each holding `Not discovered yet — run T-000.`:

1. Org basics (edition, `sourceApiVersion`, sandboxes and their purpose)
2. Automation by object (flows, triggers, validation rules, workflow rules, Process Builder)
3. Key objects and fields
4. Apex and integrations (classes, triggers, Named Credentials, external systems)
5. Conventions (naming, record types, permission sets)
6. Known gotchas
7. Sources (what was queried, from which sandbox, when)

### 3.4 Discovery story

Write `docs/stories/T-000-org-discovery.md` when it does not exist (never overwritten, not in the manifest). It is a normal story in the Analyst's format: the goal (fill the org skill), acceptance criteria (each section filled or marked "none found", sources recorded), and the read-only steps: `sourceApiVersion`, installed packages, objects with custom fields, the automation inventory from sf-architecture per key object, Apex classes and triggers, Named Credentials. Out of scope: any deploy, data change or metadata edit in `force-app/`.

The installer's closing message says: `Org setup done. In Claude Code, ask the Architect to run T-000 to fill <skill>.` Reading needs no Work Order (spec 4.2), so the Architect can run it on request. Jimmy reviews the filled skill as a git diff.

## 4. Project registry and `--update-all`

### 4.1 Registry

`~/.salesforce-team-kit/projects.json`: `{ "projects": ["<absolute path>", …] }`, sorted, no duplicates. A successful install adds the target's real path; a successful uninstall removes it. A missing or unreadable file is treated as empty and rewritten. Paths only, nothing else.

### 4.2 `--update-all`

`node install.mjs --update-all [--yes]`, without `--target`. For each registered project, in order:

- If the folder or its `.team/kit-manifest.json` is missing: report `skipped <path>: not installed any more` and drop it from the registry.
- Otherwise run the normal update (same plan, same conflict handling: interactive asks; `--yes` keeps customised files and reports them). Setup never runs.
- Print one line per project: `updated`, `up to date`, `kept N customised file(s)` or `failed: <reason>`. A failure does not stop the others. Exit code 1 if any project failed.

`--update-all` together with `--target`, `--uninstall` or `--setup` is a usage error.

## 5. Units

- `lib/install/setup.mjs` (new): `readAliases({ homeDir })`, `classifyAliases(aliases, lookup)` → `{ sandboxes, skipped }`, `orgSkillSkeleton({ org, project })`, `discoveryStory({ skill })`, `defaultOrgName(project)`. Pure apart from `readAliases`; `lookup` is injected.
- `lib/install/registry.mjs` (new): `readRegistry`, `addProject`, `removeProject`, given `homeDir`.
- `install.mjs`: flags `--setup` and `--update-all`, the prompts, wiring. The real lookup reuses the guard's `sf org display` call (moved from `hooks/guard-org.mjs` to a shared helper so both use one implementation).

## 6. Testing

Vitest, no real org, a temp home folder:

- `readAliases` merges both alias files and survives missing or broken files.
- `classifyAliases` with a fake lookup: sandbox kept, production skipped with host, failed lookup skipped, output never contains a token field.
- Setup on a first install writes `project`, `orgs.sandbox`, `orgSkill`, the skeleton and the story; a second run never overwrites the skeleton or story; uninstall leaves both.
- `--yes` first install leaves `orgs.sandbox` empty and prints the `--setup` hint; `--yes --setup` keeps the existing list.
- Registry add, remove, dedupe, broken file.
- `--update-all`: two projects updated, one missing project dropped, one failure reported with exit 1, flag conflicts rejected.

Manual check by Jimmy: install into a scratch copy of a project against uat.

## 7. Out of scope

- Approver name templating (only Jimmy uses the kit).
- Several orgs in one project.
- Running discovery automatically from the installer.
- Logging in to orgs (Jimmy runs `sf org login` himself).
