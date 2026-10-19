# Verdict format

The verdict goes in your final message to the Architect, and on the pull request with `gh pr review --comment` or `gh pr comment` if there is one (never `--approve` or `--request-changes`).

## Template

```markdown
**Verdict: Changes needed** — <task-id>
Reviewed: <files or branch>, story <docs/stories/<task-id>.md or "missing">, handoffs <list or "missing">.

### Notes
1. **Blocking** — `<path>:<line>` — <what is wrong>. Fix: <what to change>.
2. **Should fix** — `<path>:<line>` — <…>. Fix: <…>.
3. **Note** — <…>.

### Checks
- Code Analyzer: `sf code-analyzer run --target <…> --severity-threshold 2 --view detail` → <Critical n, High n, Moderate n> | not run (why).
- Tests: <class, result, asserts/bulk/negative present?>.
- Rollback plan: <where it is | missing>.
- Missing information: <exact files | nothing>.

### Handoff
node .team/bin/team-status.mjs handoff --from reviewer --to <builder id> --task <task-id> --file .team/handoffs/<task-id>-qa.md
```

## Rules

- First line: `**Verdict: Approved**` or `**Verdict: Changes needed**`. Nothing else ("approve with comments", "LGTM if…") exists.
- One note per issue. Two issues on one line (SOQL and a hard-coded Id) are two notes.
- Labels: **Blocking** (any checklist failure, Critical/High analyzer finding, missing asserts or rollback plan), **Should fix** (Moderate findings outside the blocking rules, readability), **Note** (pre-existing problems in untouched code, suggestions).
- One Blocking note → Changes needed.
- Approved only when: Code Analyzer ran with no Critical/High on changed files, no Blocking note, tests assert expected values with bulk and negative cases, and the rollback plan exists.

## Handoff targets

| Verdict | Command |
|---|---|
| Approved | `node .team/bin/team-status.mjs handoff --from reviewer --to planner --task <task-id> --file .team/handoffs/<task-id>-qa.md` |
| Changes needed | same, with `--to <builder id>`: `developer` (Apex, LWC, integrations) or `admin` (flows, objects, permissions); ids from `.team/team.json` |

The Architect copies your notes into `.team/handoffs/<task-id>-reviewer.md`; you don't write files. Update the status board with `--agent reviewer` (`status --status blocked --reason "<…>"` when a blocking issue stops you).

## Design review (no code yet)

Same shape. Notes point to the design document or the existing file that conflicts (for example `force-app/main/default/triggers/OpportunityTrigger.trigger:3`). A design with two automations writing one field is **Changes needed** until it names the single place the logic lives; the handoff goes to the builder who owns the design (or `--to planner` if the Architect wrote it).
