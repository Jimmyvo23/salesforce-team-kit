# S-1: the org guard blocks inside real Claude Code

- Claude Code version tested: 2.1.300 (`claude --version`, the binary bundled with the VS Code extension)
- Date: 2026-10-16
- Status: decided; the guard's exit-code-2 contract works as built.

## Method

I installed the kit into a throwaway Git project with `node install.mjs --target . --yes`, then set `orgs.sandbox` in `.team/team.json` to `["sandbox"]`. Before any run I checked `sf alias list` and `sf org list`: no alias named `prod`, and the only connected org is a sandbox. I never ran `sf org display` or any `--json` org command.

Headless runs used `claude -p ... --allowedTools "Bash"`, so the normal permission prompt cannot stop the command first and only the guard can block it.

1. `sf data query -o prod -q "SELECT Id FROM User LIMIT 1"`
2. `sf org list`

## Results

- Run 1, first attempt (prompt "Run exactly this Bash command"): the model declined by itself, citing the project's "never touch production" rule, and never called the tool. This tested nothing, so it does not count.
- Run 1, second attempt (prompt explained this is a hook test in a throwaway folder): the Bash call was blocked. The tool returned `PreToolUse:Bash hook error: [node "$CLAUDE_PROJECT_DIR/.team/bin/hooks/guard-org.mjs"]: Blocked by the org guard: "prod" is not listed as a sandbox in .team/team.json (orgs.sandbox). The team only works in listed sandboxes; ask Jimmy to add it if it is one.` `sf` never ran.
- Run 2 (`sf org list`): executed normally and printed the org table (no token in it).

The `guard_blocked` event in `.team/events.jsonl` (no token, no instance URL):

```
{"type":"guard_blocked","agent":"planner","command":"Running sf data","reason":"\"prod\" is not listed as a sandbox in .team/team.json (orgs.sandbox). The team only works in listed sandboxes; ask Jimmy to add it if it is one.","source":"hook","time":"2026-10-16T13:48:53.752Z"}
```

## Decision

Exit code 2 with the reason on stderr from a PreToolUse hook stops the Bash call in Claude Code 2.1.300, shows the reason to the agent, and the office gets a `guard_blocked` event. The hook output contract stays as built. Allowed commands (`sf org list`) are not affected. Note that the model may also refuse such a command on its own from the project rules; that is an extra layer, not a replacement for the guard.
