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
