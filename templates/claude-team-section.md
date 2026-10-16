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
- Every agent except the read-only Reviewer writes `.team/handoffs/<task-id>-<agent id>.md` (for example `T-012-admin.md`) and runs `team-status handoff` when it finishes; the Architect writes the Reviewer's notes.
- Start team members with `subagent_type` set to their id (`analyst`, `admin`, `developer`, `qa`, `reviewer`), never `general-purpose`.
- The Architect records tasks, approvals, decisions, releases and escalations with `team-status`.
