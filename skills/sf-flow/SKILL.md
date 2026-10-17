---
name: sf-flow
description: Use when building, changing, activating or replacing a Salesforce flow in an SFDX project - record-triggered flows (before-save, after-save, scheduled paths), screen flows, autolaunched flows and subflows, flows that call invocable Apex, flow versions and activation, Flow tests and debug runs, or migrating Process Builder processes and Workflow Rules to Flow.
---

# Salesforce Flow

## Overview

A flow is correct only if it fires **on the change, not on every save**, survives **200 records at once**, **never fails silently**, and fits **what already runs on the object**. Every answer gives the full design element by element, even when the request is short or the flow isn't in the repo. Don't stop at questions: state your assumptions, design it, then list what to confirm.

**First, read `sfdx-project.json` `sourceApiVersion`.** Use it as the flow's `apiVersion`. Don't name a release. Some options depend on it (see Run context). All work, tests and activation happen in the **sandbox alias**. Production deploys are done by a person with change sets: never suggest deploying, validating or quick-deploying to production.

## Step 1: Check the existing automation on the object (always first)

Before designing, list what already runs on every object the flow triggers on or writes to: record-triggered flows (with `TriggerType` and `TriggerOrder`), Process Builder processes, Workflow Rules, Apex triggers and validation rules. The queries are in `references/checklist.md`. If you can't run them (no shell or org), write them out with the real object name and sandbox alias, ask the user to run them or to open **Setup > Flow Trigger Explorer**, and say what result would change the design (for example, "an existing Case after-save flow that creates Tasks means we add a path to it, not a new flow"). Put this section **before** the design in your answer.

## Step 2: Choose the flow type

| The flow… | Type |
|---|---|
| sets fields on the **same record** being saved | Record-triggered, **before-save** (Fast Field Updates) |
| creates, updates or deletes **other** records, sends email, calls Apex or a subflow | Record-triggered, **after-save** (Actions and Related Records) |
| runs later, or does a callout | Record-triggered **scheduled path** or **asynchronous path** |
| runs on a timetable over many records | Schedule-triggered (or Batch Apex for large volumes) |
| needs user input | **Screen flow** |
| is reused logic called by other flows or Apex | **Autolaunched flow** (no trigger), called as a **subflow** |

A before-save flow can't create, update or delete other records, and has no actions or subflows. It changes `$Record` directly. Say why you chose the type. Details and run contexts: `references/flow-types.md`.

## Step 3: Entry conditions fire on the change

- **Target state** ("when a Case is closed"): set the condition on the state, such as Case `IsClosed` Equals `true`, and choose **"Only when a record is updated to meet the condition requirements"** (`doesRequireRecordChangedToMeetCriteria` = true). It runs once when the Case becomes closed, not on later edits. If records can be created already in that state, trigger on **created or updated** with the same condition. A new record that meets the condition counts as a change, so nothing else is needed. Don't use `OR(ISNEW(), ISCHANGED(…))` for a target state: it fires on every new record and on a change away from the state, such as a reopen.
- **"Any of these fields changed"** (address fields, several fields): use **Formula evaluates to true** with `OR(ISCHANGED({!$Record.BillingStreet}), ISCHANGED({!$Record.BillingCity}), …)` and trigger **A record is updated**. `ISCHANGED` is never true on create. If create matters, use `OR(ISNEW(), ISCHANGED(…))` with "created or updated". If the formula also needs a target state, AND it in: `AND({!$Record.IsClosed}, OR(ISNEW(), ISCHANGED(…)))`.
- Never leave the condition at "None" or "every time a record is updated" for work that should happen once.
- Make the write idempotent where you can (only if the target is blank or different).

## Step 4: Fault path on every element that can fail

Every **Create, Update, Delete, Get Records**, **Apex action**, **subflow**, **email** or **callout** element gets a **fault connector**. Name the fault target in the design. Without one, the user sees a generic error and the whole save fails. This includes **Get Records in a before-save flow**: before-save flows can query, so a before-save Get Records needs a fault connector too.

- **Record-triggered flows:** choose one, and say which:
  - **Log and continue:** the fault path sends an email to an admin (include `{!$Flow.FaultMessage}`, the record Id and the element name), or publishes a log platform event set to **Publish Immediately**. The triggering save still succeeds, and only the failed element's changes are lost. So don't also say a related-record error "rolls back the whole save" in that design.
  - **Block the save:** the fault path ends in a **Custom Error** element with a clear message. The whole transaction rolls back, **including any record the fault path created and any email it sent**: email from a transaction is sent only when it commits. So on this path, log only with a platform event set to **Publish Immediately**, which is published even if the transaction rolls back. Confirm that in the sandbox by forcing the error.
- **Screen flows:** the fault path goes to an **error screen** with a friendly message ("We couldn't save the visit. Your entries are kept. Try again or contact your admin.") and a Back or Finish button. Put `{!$Flow.FaultMessage}` in the admin email or log, not in front of the rep.
- **The fault path's own elements need fault connectors too.** A Send Email or log element with no fault connector fails the whole flow, and the save, if it fails. Connect its fault connector to the end (record-triggered) or the error screen (screen flow). Never leave it off "so a failed email can't break the save": leaving it off is what breaks the save.
- Label elements descriptively (`Create Follow-Up Task`, not `Create Records 1`). Error emails name the element.

## Step 5: No Get, Create, Update, Delete, Apex action or subflow inside a Loop

Never put a **Get, Create, Update or Delete Records**, **Apex action** or **subflow** inside a Loop. The loop body builds collections (Assignment, Decision and similar elements).

- **Best:** one **Update Records** element with criteria, for example Contacts where `AccountId` Equals `{!$Record.Id}`, setting the fields. No loop at all.
- **If each record needs logic:** Get Records once before the loop, then in the loop use an Assignment to set fields on the loop variable and **add it to a collection variable**. After the loop, one Update Records on that collection.
- **Bulk behaviour (say it in the answer):** a data load or list edit saves up to **200 records per transaction**, and each record runs its own flow interview. Salesforce batches interviews waiting at the same element (don't promise an exact number of statements), but limits are shared by the whole transaction: 100 SOQL queries, 150 DML statements, **10,000 DML rows**. 200 Accounts with 60 Contacts each is 12,000 Contact rows, which fails. If parents can have many children, say so and move the work to an asynchronous path or Batch Apex. A governor-limit error rolls back the whole transaction even when the element has a fault connector. A related update also runs the related object's own automation and validation rules.

## Step 6: Subflows, Apex and naming

- **Subflow** for logic used by more than one flow. A record-triggered flow can call an **autolaunched** subflow from after-save (not before-save). Pass `$Record` into an input variable of the same object type. The subflow must save its own changes with Update Records. At API 61.0 and later it calls the subflow's active version.
- **Invocable Apex action** (`@InvocableMethod`): name each input and output variable in the design. The method takes a list and must return results in the same order and size as the inputs. Prefer an output such as `isSuccess`/`errorMessage` that a Decision checks, **plus** a fault path for thrown exceptions.
- **Naming:** follow the team's existing convention if there is one. Otherwise: flow API name `<Object>_<Timing>_<Purpose>` (`Case_AfterSave_FollowUpTask`), elements as verb plus object, and a description on the flow and every element.
- Don't put Ids, user names or queue names in the flow. Look them up with Get Records by DeveloperName, or use custom metadata.

## Step 7: Run context and access (state it for every flow)

| How the flow starts | Default context |
|---|---|
| Record-triggered, schedule-triggered, platform event | **System context without sharing**. The running user's permissions don't limit it. |
| Screen flow from a Lightning page, quick action, button, utility bar | **User context**: the user's object, field and record access apply |

- A **screen flow's** users need the **Run Flows** permission. If the flow's access override is on, they must also be in a profile or permission set given access to that flow. If it calls Apex, they need **Apex Class Access** to the invocable class in a permission set. Give all of this in one permission set for reps.
- The **Apex** action runs under its own class's sharing keyword and access mode, not the flow's. Say what the class enforces.
- Where Flow Builder offers **How to Run the Flow** (flow properties; it isn't offered for every flow type), change it only on purpose. Tell the user, and say who could see or change what. "User Context—Enforces User Permissions" needs API 68.0 or later.

## Step 8: Versions, testing, activation and rollback

- **Versions:** a flow has versions, up to 50. **Only one version is active.** Activating a new version deactivates the previous one, while running or paused interviews finish on the version they started on. Saving changes to an active version in Flow Builder means **Save As New Version**. The new version is inactive until you activate it.
- **Deploying changes** to a flow in a sandbox also creates a new version (check Setup > Flows > View Details and Versions), and the file's `<status>` decides whether it is active. `<status>Active</status>` activates it **on deploy**, replacing the current version before you've tested it. To test first, deploy with `<status>Draft</status>`, test, then activate. Before deploying, check the file's `<status>`.
- **Any answer about changing or activating a flow starts with a "How versions work" paragraph** covering those points: saving an active flow creates a new, inactive version; only one version is active; and the old one stays for rollback. Write it even if the user seems to know.
- **Test before activating, in the sandbox:**
  - **Flow tests** (Flow Builder > View Tests) for record-triggered and autolaunched flows: one test per path, including "condition not met", with assertions. **Convert to Test** turns a debug run into a test. Flow tests can cover **scheduled paths** (a test chooses the path, API 56.0 and later), but not **Run Asynchronously** paths. Screen flows have no Flow tests: debug them and run them as a rep.
  - **Debug** with a test record (rollback mode keeps the sandbox data clean), then real test records: create or update a few records, and list-edit or load 200.
- **Testing is the gate, not an option.** Activate only after the tests pass. Never offer "or activate straight away", even when the user only said "activate it". If you can't run the tests, list them as the step that comes before activation.
- **Activate** in the sandbox (`uat` or the team's sandbox alias): Setup > Flows > the flow > View Details and Versions > Activate the new version, or click Activate in Flow Builder.
- **Rollback:** keep the previous version. Don't delete it. Write down its version number before you activate. If something breaks, activate the previous version again. Then check what the bad version already changed.
- **Production:** say that a person moves the flow to production with a change set, and decides about activation there. Don't plan it yourself.

## Replacing Process Builder or Workflow Rules (retired)

Salesforce ended support for both on 31 December 2025. Existing ones still run. Never create new ones. To replace one:

1. **Inventory** (Step 1) for the object, so you know which other flows, triggers or rules overlap with the same fields.
2. **Convert:** use **Setup > Migrate to Flow** on the process or rule. It handles record-triggered processes only. It converts scheduled actions only when you migrate a single criterion. Review every item it marks **Needs Review**. If the tool offers **Switch Activations**, use it to activate the flow and deactivate the process together. Otherwise do both by hand at once. If the tool can't convert it, or you can't see it yet, **rebuild it** and give the mapping anyway:
   - each criteria node becomes a Decision outcome, or its own flow;
   - same-record field updates go in a before-save flow;
   - other actions go in an after-save flow;
   - scheduled actions become scheduled paths;
   - "only when specified changes are made" becomes "Only when a record is updated to meet the condition requirements".
3. **Test** the new flow in the sandbox (Flow tests and real records) against the old behaviour.
4. **Activate the flow and deactivate the process in the same step**, in the sandbox, so both never run together. Otherwise every action happens twice. In production, the person deploying does both together.
5. Don't edit retrieved Process Builder metadata (`processType` `Workflow`) by hand. A process edited that way can't be opened in the target org.

## Before you answer, check

| Check | Fix |
|---|---|
| No automation inventory before the design | Add Step 1 with the queries |
| Entry condition fires on every edit | "Only when updated to meet the condition" or `ISCHANGED` formula |
| A Create, Update, Delete, Get, Apex or subflow element with no fault connector | Add it and name the target |
| Get, Create, Update, Delete, Apex action or subflow inside a Loop | Collection plus one element after the loop, or Update Records with criteria |
| No sentence about 200 records and the 10,000-row limit | Add the bulk paragraph |
| No run context or permissions stated | Add Step 7 |
| Activation without a test, a "How versions work" paragraph, or a rollback version | Add Step 8 |
| A Process Builder replacement that leaves both active | Deactivate the process when the flow activates |
| Only questions, no design | Design it with stated assumptions, then ask |
| "Test first or activate straight away?" | Remove the choice. Tests come first. |
| Mentions deploying or validating to production | Remove it. A person deploys to production with change sets. |
