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

The first install into a project runs setup: it asks for the project name, lists the sf aliases on this Mac whose instance URL is a sandbox (production and aliases it can't look up are shown as skipped), and writes the ones you pick to `orgs.sandbox`. It also creates an org knowledge skill skeleton in `.claude/skills/<org>-org/` and the story `docs/stories/T-000-org-discovery.md`; ask the Architect to run T-000 to fill the skill from the sandbox. Neither file is ever overwritten or removed by the installer. Re-run setup any time with `--setup`. With `--yes`, setup asks nothing and chooses no sandboxes, so the guard blocks every org command until you run `--setup`.

Every install is remembered in `~/.salesforce-team-kit/projects.json`. After updating the kit, update every project at once:

```
node install.mjs --update-all
```

What it puts in the project:

- `.claude/agents/` with the five subagent files
- `.claude/skills/` with the seven Salesforce skills (sf-architecture, sf-apex, sf-flow, sf-security, sf-testing, sf-deploy, sf-review)
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

The guard is a seatbelt against honest mistakes, not a sandbox: the real protection is that no production org is authorised on the machine the team runs on.

Before every Bash command, `.team/bin/hooks/guard-org.mjs` checks each `sf` call in it, including chained commands, `$(…)`, `bash -c "…"`, `eval`, commands piped into a shell, `sudo`/`env`/`nohup`-style wrappers and `xargs`/`find -exec`. It finds the target org from `-o`/`--target-org`, `-v`/`--target-dev-hub`, `--from-org` or `--source-org` (the deprecated `-u`/`--targetusername` and `--targetdevhubusername`, the plugin aliases `--fromorg`, `--target-hub-org`, `--dev-hub-org`, `--sourceorg` and `--devops-center-username`, and `-c` on `sf project deploy pipeline`, count too), or, the way `sf` does, from `SF_TARGET_ORG` (or `SFDX_DEFAULTUSERNAME`), then the default org of the SFDX project the command runs in, then your global default org. If neither a flag nor a default org exists, the command is blocked. A default Dev Hub (`SF_TARGET_DEV_HUB` or `target-dev-hub`) must also be a listed sandbox when a command has no org flag. If the new `.sf` and the legacy `.sfdx` config, or the `SF_` and `SFDX_` variables, name different default orgs, a command without `-o` is blocked. As in `sf`, `.sf/config.json` counts only `target-org`/`target-dev-hub` and `.sfdx/sfdx-config.json` counts both those and the legacy names; a legacy name inside `.sf/config.json` (which `sf` ignores) also blocks a command without `-o`. `sf org create snapshot` without `-v` also checks the default Dev Hub. Write each short flag on its own: an org flag inside a group such as `-to prod` is blocked. Any other long flag that mentions org, hub or username is blocked unless the guard knows it is not an org flag. `sf` accepts command words in any order (`sf display org` is `sf org display`) and offers to finish an incomplete command, so every rule compares the command words in any order, and a rule's words that are typed only in part (`sf display -o uat`) count as that command.

- The alias must be listed under `orgs.sandbox` in `.team/team.json`.
- Its instance URL must be a sandbox domain (looked up once a day with `sf org display` and cached in `.team/org-cache.json` together with the username the alias points to in `~/.sfdx/alias.json`; when the alias points to another username, or that file can't be read, the URL is looked up again; the access token in that output is never printed or stored).
- Always blocked:
  - quick deploys (`sf project deploy quick`, `sf deploy metadata quick`, `sf project deploy pipeline quick`)
  - anything that prints tokens: `sf org display` (and `sf org display user`), `sf org auth …` (`show-access-token`, `show-sfdx-auth-url`, `show-user-password`), `sf org open --url-only` (or `-r`, also on `sf org open agent` and the legacy `sf force:source:open`), `sf org list --json`
  - `sf doctor --command`, which runs another `sf` command
  - logins and logouts (`sf org login`, `sf org logout`, and the legacy `sf auth`, `sf login`, `sf logout`)
  - changing the default org or aliases: `sf config set` or `unset` of `target-org`, `target-dev-hub` or their legacy names (`defaultusername` and the like), and `sf alias set` or `unset`
  - the legacy `sfdx` command
- The guard fails closed. It also blocks:
  - `sf` arguments built at run time (any `$` or backtick in an `sf` argument, including inside a SOQL string), and command names built at run time (`$SF …`)
  - a command name with a shell pattern in it (`/usr/local/bin/s?`, `s[f]`, `{sf,x}`, zsh `s(f)` or `=sf`). A pattern in any other word (`ls *`, `rm -rf dist/*`) is expanded against the files in the command's folder, and the line is blocked only if that finds a file named `sf` or `sfdx` (`arch ./tools/s? …`). On a line that changes folder or may create files first (an output redirect, or `touch`, `cp`, `mv`, `ln`, `git` and the like), any pattern that could match `sf` blocks it.
  - `$'…'` quoting is decoded the way bash does (`$'s\x66'` is `sf`) and `$"…"` is read as `"…"`; a `$'…'` the guard can't decode (unterminated, a NUL byte, a bad `\u` code point) is blocked. Here-document bodies are data (only an `sf <word>` in them, or a `$(…)` in an unquoted one, is checked); a body fed to a shell (`bash <<EOF`) is blocked.
  - an incomplete `sf` command (`sf start …`, which `sf` would offer to finish with a prompt) on a line with a pipe or an input redirect. Type the whole command. The list of commands comes from the installed CLI (`node scripts/sf-commands.mjs` regenerates `lib/sf-commands.mjs` after a CLI update; commands it doesn't list are treated as incomplete).
  - shells nested more than three deep, commands piped into a shell (`… | bash`), and scripts that contain `sf` commands
  - any line where it finds more `sf <word>` mentions, or more words that are just `sf` or hold a whole `sf` command (`sh -c 's''f …'`), than `sf` commands it could check, for example `echo "run sf deploy"`, `grep sf notes.txt` or a commit message that mentions `sf deploy`. Rephrase the text or run the `sf` command on its own.
  - every `sf` org command when it cannot find the project folder or read `.team/team.json`, or when its own files fail to load
  - setting `SF_`/`SFDX_` variables on the line (`SF_TARGET_ORG=… sf …`, `env`, `export`, `declare -x`), changing `HOME`, `XDG_CONFIG_HOME` or `XDG_DATA_HOME` on a line that runs `sf`, and `--flags-dir`
  - `sf` org commands without `-o` on a line that changes folder (`cd`, `pushd`, `popd`) or clears variables (`env -i`, `env -u`), or that run in a folder outside the project
  - scripts it can't read (missing, a folder, or a relative script after `cd` on the same line)
- `xargs … sf …` and `find -exec … sf …` are blocked; run those `sf` commands directly.

A block shows the reason to the agent and puts a "Guard blocked" line in the office.

## Known limits

- **The guard is a seatbelt, not a sandbox.** An agent calling the Salesforce REST API directly (for example with `curl`) would get past it. The agent rules forbid this and the Reviewer checks for it. `npm run` scripts that call `sf` are not inspected.
- **Agents can edit the guard's inputs.** `.team/team.json` and `.team/org-cache.json` are ordinary project files. The guard trusts a cached instance URL for 24 hours, so an agent that rewrote both files could get a non-sandbox alias past it. Not authorising production on this machine is what closes this gap.
- **Agents can also remove the guard.** Admin and Developer can edit `.claude/settings.json` and `.team/bin/`, which could remove the hook. A renamed, copied or symlinked `sf` binary, or `sf` started from `node`, `python` or another program, is not inspected. The hook only runs if Claude Code finds it through `$CLAUDE_PROJECT_DIR`. Shell functions and aliases from your own shell setup (for example one that changes folder) are not visible to the guard. Same seatbelt: not authorising production on this machine is the real protection.
- **Hook data.** What the hooks receive was captured with Claude Code 2.1.290 (`docs/decisions/S-0-hook-input.md`); the guard's block behaviour was checked with Claude Code 2.1.300 as described in `docs/decisions/S-1-guard-in-claude-code.md`.
- **Agents may skip status calls.** The hooks still record when each agent starts and stops and which files and commands it touches.
- **Hook text is not a redaction layer.** Do not treat the log as private.
- **One kit per project.** This kit and `agent-team-kit` both install into `.team/` and `.claude/agents/`.
- **Known gaps.** The guard does not model every shell trick. A command name built from a variable or wildcard behind a program the guard doesn't recognise, quoted text that another program runs later (git aliases, ssh, tmux, osascript), interpreters, and renamed sf binaries can get past it. In the other direction, a `*` inside quoted text on a line that may create files (for example `git commit -m "Add * support"`) is blocked; rephrase it.

## Development

```
npm ci
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

Skill pressure tests (spec 7.1) run each skill's scenarios in headless Claude Code, with and without the skill, and record the results in `skills/<name>/tests/results/`:

```
node scripts/skill-pressure.mjs sf-apex baseline
node scripts/skill-pressure.mjs sf-apex with-skill
```
