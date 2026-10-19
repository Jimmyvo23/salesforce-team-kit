---
name: sf-review
description: Use when reviewing or approving a Salesforce change in an SFDX project - an Apex class, trigger, test class, flow or design for a task such as T-012 - when asked "can you approve this", "review this class", "what checks do you run before approving", when tests pass with high coverage, when running Salesforce Code Analyzer (sf code-analyzer run), or when a new flow or trigger may overlap existing automation on the same object or field.
---

# Salesforce Review

## Overview

The review ends in exactly one verdict: **Approved** or **Changes needed**, with one note per issue, each with `file:line`, what is wrong and the fix. Approval needs three things: **Code Analyzer clean at the blocking severities, no blocking checklist item, and tests that assert behaviour.** Anything less is Changes needed.

The checklist below is short on purpose. The sibling skills hold the detail: **sf-security** (CRUD/FLS, `USER_MODE`, sharing), **sf-apex** (bulk patterns, hard-coded values), **sf-testing** (what a real test asserts), **sf-flow** (fault paths, loops), **sf-architecture** (automation inventory, order of execution), **sf-deploy** (rollback). Load the one that matches an issue before writing its fix.

## 1. Read the context, then review anyway

Read, if they exist: `docs/stories/<task-id>.md`, the Work Order, `.team/handoffs/<task-id>-*.md` (builders and QA), `git diff` of the branch, and `sfdx-project.json` `sourceApiVersion` and the class's `-meta.xml` `apiVersion` (the version decides the Apex security defaults; see sf-security). Name the version you read in the CRUD/FLS note.

If the story, Work Order or handoffs are missing, **don't stop and don't soften the verdict.** Review the code you have, give the verdict, and add one note: "Missing: <exact files>. I could not check the change against the acceptance criteria or the rollback plan." Missing information is itself a reason the task can't be Approved.

## 2. Run Code Analyzer

```bash
sf code-analyzer run --target <each changed file or folder> --severity-threshold 2 --view detail
```

- Use `--target force-app` when the change set is unclear. `--target` is repeatable and takes files, folders or globs. The default rule set is `Recommended`.
- **Severities (Code Analyzer v5):** 1 Critical, 2 High, 3 Moderate, 4 Low, 5 Info. (The retired `sf scanner` used 1 high, 2 moderate, 3 low: don't mix them up.)
- **Read it:** a non-zero exit with `--severity-threshold 2` means at least one Critical or High violation. The detail view lists each violation's severity, engine, rule, file and line. Copy each blocking one into a note with its `file:line`.
- Blocking thresholds and rule names: `references/code-analyzer.md`.

| Severity | Effect on the verdict |
|---|---|
| **1 Critical, 2 High** | **Blocks.** Changes needed, no exceptions. |
| **3 Moderate** | Blocks if it is a Security rule or a limits-in-loop rule on changed lines; otherwise fix, or the builder writes the reason in the handoff. |
| **4 Low, 5 Info** | Note only. |

A clean run is necessary, not sufficient: the analyzer can't see automation overlap, test intent or the rollback plan, and some checklist failures are reported only at Moderate. **A blocking checklist failure in section 3 blocks, whatever severity the analyzer gave it.**

**No shell (or the tool isn't installed)?** Give the exact command above, say how to read it (exit code, severity column, `file:line`), and say plainly it has not been run. The verdict can't be Approved until it has run clean.

## 3. Checklist (each failure is a blocking note unless the row says Should fix)

| # | Check | Deep dive |
|---|---|---|
| 1 | **CRUD/FLS:** every SOQL has `WITH USER_MODE`, every DML `as user` (or `AccessLevel.USER_MODE`); system mode only on one statement with a comment | sf-security, sf-apex |
| 2 | **Sharing keyword:** every class declares `with sharing` (or `inherited sharing` / a commented `without sharing`) | sf-security |
| 3 | **SOQL or DML inside a loop** (Apex `for`, or Get/Create/Update/Delete inside a Flow Loop) | sf-apex, sf-flow |
| 4 | **Hard-coded Ids, URLs or credentials** (record type Ids, user Ids, endpoints). Hard-coded business numbers (rates, thresholds) are **Should fix** (Custom Metadata); comparing a picklist API value (`Type == 'Partner'`) is fine | sf-apex |
| 5 | **Automation overlap:** another trigger, flow or class writes the same field on the same object | sf-architecture |
| 6 | **Flow fault paths** on every element that can fail | sf-flow |
| 7 | **Tests assert behaviour:** expected values, a bulk case, a negative case, a restricted user | sf-testing |
| 8 | **Direct API calls:** callouts via Named Credentials only; no synchronous callout in a trigger | sf-security, sf-apex |
| 9 | **Rollback plan** written in the Work Order or handoff | sf-deploy |
| 10 | **Scope and data:** change much bigger than the Work Order (about 25% more, or new objects); real customer data in tests or docs | — |

How to check each item, with grep patterns: `references/checklist.md`. Security findings (1, 2, 8) are blocking, never "smaller points".

## 4. Automation overlap (item 5)

Search `force-app/` for the field across `triggers/`, `classes/`, `flows/` (and workflows), for example `Grep "Partner_Discount__c" force-app`. The repo is not the org: say that the org may hold more (sf-architecture's automation inventory lists the queries).

When two automations write the same field on save, explain **who wins** from the order of execution: before-save record-triggered flows run first (step 3), then before triggers (step 4), so **a before trigger overwrites a before-save flow** on the same field; after triggers and after-save flows run later and need another update. The result depends on records that match both, and it is easy to misread. **Ask for one place**: put the rule in the existing trigger handler, or move the trigger's rule into the flow and retire it. Two writers on one field is Changes needed, even when each one is correct alone.

## 5. Tests (item 7): coverage is not approval

"Passes with 90% coverage" proves only that lines ran. A test with **no `Assert` call** proves nothing (PMD's `ApexUnitTestClassShouldHaveAsserts` rule flags it when that rule is selected). Before approving, require:

1. **Asserts on expected values:** query the records after the call and `Assert.areEqual(expected, actual)` for each field the story changes.
2. **A bulk test:** 200+ records in one call (proves no SOQL/DML-in-loop limit failure).
3. **A negative case:** records that must **not** change (wrong type, wrong record type, null lookup), asserted unchanged.
4. **A restricted user** (`System.runAs`) when the change touches access.

Ask for all four by name in the notes. Test-writing detail: sf-testing.

## 6. The verdict (always this shape)

```markdown
**Verdict: Changes needed** — T-012
1. **Blocking** — `force-app/main/default/classes/DiscountJob.cls:4` — SOQL inside the loop. Fix: collect AccountIds, one query into a Map before the loop.
2. **Blocking** — `…:7` — DML inside the loop. Fix: add to a List, one `update as user` after the loop.
3. …
Code Analyzer: <result, or "not run: run `sf code-analyzer run …` before approval">.
Missing: <files, or "nothing">.
Handoff: node .team/bin/team-status.mjs handoff --from reviewer --to <builder id> --task T-012 --file .team/handoffs/T-012-qa.md
```

- **Changes needed** → `--to <builder id>` (`developer` for Apex/LWC, `admin` for flows, objects and permissions; the ids are in `.team/team.json`). The Architect writes your notes into `.team/handoffs/<task-id>-reviewer.md`.
- **Approved** → `--to planner`, with the Code Analyzer result and test run you checked.
- Each note is labelled **Blocking**, **Should fix** or **Note**. One Blocking note means Changes needed.
- Full template and wording for a design (no code yet) review: `references/verdict.md`.

You are read-only: describe the fix, don't edit files. Never run anything against production; tests run only in a sandbox from `.team/team.json` `orgs.sandbox`.

## Rationalizations

| Excuse | Reality |
|---|---|
| "Coverage is 90%, approve" | No asserts = untested. Changes needed: asserts, bulk, negative case. |
| "I can't find the task, so no verdict" | Review the code, give the verdict, list what is missing. |
| "Sharing / user mode is a minor point" | Security items always block. |
| "Code Analyzer passed" | Overlap, test intent and rollback aren't in it. Run the checklist. |
| "Each automation works alone" | Two writers on one field conflict. One place. |
| "Small change, skip the rollback plan" | No rollback plan, no approval. |

## Before you answer, check

- One verdict word, at the top: Approved or Changes needed.
- Every issue has its own note with `file:line` and a fix, labelled Blocking / Should fix / Note.
- The Code Analyzer command (and its result, or "not run") is in the answer, with the blocking severities.
- Tests: asserts, bulk, negative case asked for by name.
- The handoff command names `--to planner` (Approved) or `--to <builder id>` (Changes needed).
