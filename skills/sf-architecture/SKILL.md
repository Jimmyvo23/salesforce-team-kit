---
name: sf-architecture
description: Use when deciding how to build a Salesforce change in an SFDX project - record-triggered automation (before-save flow, after-save flow, Apex trigger), field updates on the same or related records, formula fields, lookup or master-detail relationships, large data volumes, or sending data to or receiving it from an external system - and before writing a design or any metadata.
---

# Salesforce architecture

## Overview

A Salesforce design is only correct relative to what already runs on the object. Choose the tool from the rules below, never from habit, and show the reasoning.

**The design starts with the automation inventory, before any recommendation.** The repo is not the org. An SFDX project with no `triggers/` or `flows/` folder says nothing about what is active in the sandbox.

Read the API version from `sfdx-project.json` (`sourceApiVersion`) for any metadata you describe. Don't name a release. All work targets the sandbox alias. Production deploys are done by a person with change sets, so never plan, validate or deploy to production.

## Step 1: Automation inventory (always first)

For every object the change touches (the object that triggers it, every object it writes to, and parents with roll-ups):

1. Record-triggered flows with their `TriggerType` and `TriggerOrder`.
2. Process Builder processes.
3. Apex triggers, with their events.
4. Workflow rules.
5. Validation rules.

The exact `sf data query --use-tooling-api -o <alias> -q "…"` commands are in `references/automation-inventory.md`. Use them as written.

- If you can run commands, run them against the **sandbox alias** and put the results table in the design.
- If you can't (read-only tools, no org), write the queries out with the real object names and alias. Ask the user to run them. Label the recommendation **provisional until the inventory is back**, and say what result would change it (for example, "an existing Opportunity trigger means this goes in its handler").

The inventory section comes **before** the recommendation in your answer, not as a later "check for conflicts" step.

## Step 2: Choose the tool

| The change… | Build it as |
|---|---|
| sets fields on the **same record** being saved | **Before-save record-triggered flow** (fast field updates), or the existing trigger handler's before logic |
| is only a calculation for display or reporting | **Formula field** (if within compile size, see below) |
| creates, updates or deletes **another** record (parent, child, related) | **After-save record-triggered flow**, or an Apex after trigger via the handler |
| needs complex logic, savepoints, partial success, heavy volume | **Apex**: one trigger per object, logic in a handler class |
| calls an external system | **Asynchronous** callout (see Integration) |

Say **why** the choice beats the alternatives, in one or two lines:
- **Before-save vs after-save, same record:** before-save needs no extra DML and no second save. An after-save update re-runs the whole save order on the same record. Apex adds code and tests for no gain.
- **What before-save can't do:** a before-save flow **cannot create, update or delete other records**. It has no actions and no subflows. It changes only `$Record` (values are applied without an Update Records element) and can block the save with a Custom Error element. So a cross-object update is always after-save (or Apex), and you say that this is the reason.
- **Existing entry point:** if the inventory shows an Apex trigger on the object, add to its handler and never add a second trigger, because the order between triggers is not guaranteed. If the object is flow-based, give the new flow an explicit `TriggerOrder`.
- **Run context:** record-triggered flows run in system context without sharing, and Apex triggers run without sharing; their queries and DML run in system mode only at API 66.0 and earlier, and default to user mode at 67.0 and later (read `sourceApiVersion`; see the sf-apex / sf-security table). Say so when the change writes records the user can't edit.
- Never add Workflow Rules or Process Builder. Both are retired.

Details and edge cases are in `references/decision-rules.md`.

## Step 3: Design details every automation must state

- **Entry condition on the change, not every save.**
  - In a flow, use "Only when a record is updated to meet the condition requirements".
  - In a formula, use `ISCHANGED()` with the new value.
  - In Apex, compare against `Trigger.oldMap`.
  - Make the target write idempotent, for example "only if the field is blank".
- **Bulk.** Records arrive in chunks of up to 200, and many can share one parent. Say how it behaves when, for example, 200 Opportunities on 50 Accounts close at once: one query, one update, no SOQL or DML in loops.
- **Recursion and order of execution.** Say where it runs in the order of execution: before-save flows, then before triggers, then validation, then after triggers, then after-save flows, then roll-ups, then commit. Updating a related record runs **that** object's flows, triggers and validation rules too. Say what stops a loop.
- **Tests.** Cover the bulk case, the "already set" case, and the "condition not newly met" case.

## Integration (outbound calls, ERP, middleware)

- **No synchronous callout in a trigger, before-save flow or the save transaction.** Use one of:
  - a **Queueable** with `Database.AllowsCallouts`, enqueued from the trigger handler or invocable Apex on a flow's Run Asynchronously path;
  - a **Platform Event** (Publish After Commit) with a subscriber;
  - **Change Data Capture** when the external system subscribes itself.
- **Named Credential plus External Credential** hold the endpoint and authentication (a permission set grants the principal). Code calls `callout:<Named_Credential>/path`. Never hard-code the URL, tokens or passwords in Apex, flows or custom settings.
- **Failure handling** is part of the design:
  - a status and last-error field, or a log object;
  - capped retries with backoff for timeouts and 5xx errors;
  - no blind retry on 4xx errors;
  - an idempotency key or external Id so retries don't duplicate;
  - an alert or a scheduled sweep of failed records.
- Mention the limits that apply: 100 callouts and a 120-second cumulative timeout per transaction, and 50 `System.enqueueJob` calls per transaction.

## Formula fields (sizes and the alternative)

Before proposing a formula that combines other formulas, warn about **compile size**. The current limit is **15,000 bytes compiled**. Older docs and many answers say 5,000, so confirm against the current "Formula Field Limits and Restrictions" page. There is also a 3,900-character limit and a 4,000-byte saved size.

- The compiled size **includes the compiled size of every formula field it references**. Fifteen formula inputs carry fifteen compiled sizes.
- Splitting into helper formulas does **not** reduce compile size. It helps only with the character limit.
- Offer the fallback up front: a **stored Number field calculated by a before-save flow**, or by Apex or a batch job when the inputs are on other records. A stored value can also be indexed and filtered. If the inputs are time-based (`TODAY()`, `NOW()`) or come from other records, a save-time calculation goes stale, so add a scheduled recalculation (scheduled flow or batch). Verify in the sandbox that the input formulas read current values in the before-save context.

## Relationships and data volume

Compare lookup and master-detail on four points:
- **sharing**: master-detail children inherit the parent's sharing;
- **ownership**: master-detail children have no owner of their own;
- **cascade delete**: master-detail always cascades, lookup is optional;
- **roll-up summaries**: native only on master-detail.

Then check volume:
- **Data skew**: more than about **10,000 children on one parent**. It causes parent **record locking** (`UNABLE_TO_LOCK_ROW` during loads and integrations) and long **sharing recalculation** when the parent's owner or sharing changes. Very large parents also slow roll-up recalculation.
- **Ownership skew**: more than **10,000 records of one object owned by one user**. Don't solve parent skew by giving everything to one integration user. If one integration owner can't be avoided, give that user **no role** (or a role at the top of the hierarchy in its own branch, outside the groups used for sharing rules), and avoid owner changes and moving that user, because they trigger sharing recalculation.
- Give **one recommendation with the reason**. With millions of children and parents over 10,000, choose a lookup, compute roll-ups asynchronously, and load grouped by parent.

## Design output (in this order)

1. Goal and assumptions (questions for anything unclear; don't invent requirements).
2. Automation inventory: the queries and results, or the queries and "provisional".
3. Recommendation and why, including what was rejected and why.
4. Entry criteria, logic, bulk and recursion behaviour, and the place in the order of execution.
5. Failure handling and limits.
6. Test cases for the sandbox.
7. Components for the change set. A person deploys it to production.

## Common mistakes

| Mistake | Fix |
|---|---|
| "No triggers in the repo, so none exist" | Run or request the inventory queries. The repo is not the org. |
| Inventory as a step after the design ("check for conflicts later") | Inventory first, and the recommendation depends on it. |
| Picking after-save without saying why | "It updates a different record, and before-save can't." |
| Same-record update in an after-save flow | Before-save flow. Mention that before-save can't touch other records. |
| A second trigger on an object | Add to the existing handler, since trigger order isn't guaranteed. |
| "Split the formula into helper formulas" to beat compile size | That doesn't reduce compile size. Store the value with a before-save flow or Apex. |
| Lookup vs master-detail without the volume | Raise skew over 10,000, locking and sharing recalculation, then recommend. |
| A callout in a trigger, or a hard-coded endpoint | Queueable, Platform Event or CDC, plus Named and External Credential, plus retries and an error record. |
