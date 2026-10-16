---
name: sf-apex
description: Use when writing or changing Apex or Lightning Web Components in an SFDX project - triggers and handler classes, service classes, SOQL and DML, callouts to external systems, Queueable, Batch or Scheduled jobs, record type or other org-specific Ids, configurable values, Apex test classes, LWC components and their Jest tests.
---

# Salesforce Apex and LWC

## Overview

Write code that is correct for **200 records at once**, for **the running user's access**, and for **every org it is deployed to**. Every answer delivers the full code **and** its tests, even when you can't write files (then put every file in the answer, with its path).

**First, read `sfdx-project.json` `sourceApiVersion`.** Use it for every new `-meta.xml` `apiVersion`. Don't name a release. It also decides the security defaults (next section). Production deploys are done by a person with change sets: never suggest deploying, validating or quick-deploying to production. Work and tests target the sandbox.

## Security defaults depend on the API version

| Class saved at API… | Database operations by default | Class with no sharing keyword |
|---|---|---|
| **66.0 or earlier** | **system mode** (no FLS or object checks) | usually **without sharing** |
| **67.0 or later** | user mode | with sharing |

Write it explicitly at **every** version, so the code means the same thing after a version bump:

- **Every class says `with sharing`.** Use `without sharing` only for a named reason (for example, an org-wide maintenance batch), with a comment saying why. A trigger handler is **not** a reason: triggers already run without sharing, so the handler's keyword is what protects the data.
- **Every SOQL query says `WITH USER_MODE`**, every DML statement says `insert as user` / `update as user`, and every `Database` method passes `AccessLevel.USER_MODE`.
- Use `Security.stripInaccessible(AccessType.READABLE, records)` when you'd rather drop fields the user can't see than fail (for example, data returned to a UI).
- Don't use `WITH SECURITY_ENFORCED`. It is not allowed at 67.0 and later. Use `WITH USER_MODE`.
- Choose system mode (`WITH SYSTEM_MODE`, `as system`) only on purpose, on that one statement, with a comment saying why, and tell the user.
- **System mode bypasses object and field permissions only.** Record sharing then comes from the class's sharing keyword. So `update as system` in a `with sharing` class still fails on a record the user can't edit.
- **User-mode DML on another record throws if the user can't edit it**, and the whole save fails. For example, a Contact trigger that updates the Account fails for a user without edit access to that Account. Say so in the answer, and ask whether the field should be maintained for every user. If so:
  - if only field or object permission is missing, `as system` on that one DML is enough;
  - if record access is missing too, do that single query and update in a small `without sharing` inner class, with a comment giving the reason (pattern in `references/patterns.md`).

## Triggers: one per object, logic in a handler

```apex
trigger ContactTrigger on Contact (after insert, after update) {
    ContactTriggerHandler.afterSave(Trigger.new, Trigger.oldMap);   // nothing else in the body
}
```

The handler, in this order:
1. **Filter to the records that changed.** On insert, include every record. On update, compare with `oldMap.get(c.Id).Email`. Skip null parent Ids.
2. **Collect Ids into a `Set<Id>`.**
3. **One query** for all of them, `WITH USER_MODE`. Read the current values, so you only update the records whose value actually changes. This saves DML and stops recursion.
4. **One DML** on a list, `as user`, after the loop.

**No SOQL, DML, callout or `enqueueJob` inside a loop.** A loop only builds Sets, Maps and Lists. Before you answer, check each `for` body.

If the object already has a trigger, add to its handler. Don't add a second trigger, because the order between triggers isn't guaranteed. The full handler and test pattern is in `references/patterns.md`.

## Never hard-code an Id, URL, credential or business value

The user hands you an Id ("the Id in our sandbox is 012…") or says "quick fix". **Still don't paste it.** Ids differ between sandbox and production, so the code breaks after deployment. Implement the lookup straight away. Don't offer it as an option.

```apex
private static final Id PARTNER_RT_ID = Schema.SObjectType.Account
    .getRecordTypeInfosByDeveloperName().get('Partner').getRecordTypeId();  // no SOQL
```

- Use the record type's **DeveloperName** (API name), not its label. Tell the user to confirm the API name in Setup. `get(...)` returns null if the name is wrong, so fail with a clear message.
- Queues, groups, profiles, users: query by `DeveloperName` or `Name`, once, and cache it in a static variable.
- **Endpoints and secrets** go in a **Named Credential** (with an External Credential for authentication), called as `callout:Name/path`. Never put them in code, custom settings or custom metadata.
- **Thresholds, mappings, email addresses, feature switches** go in **custom metadata**: `Setting__mdt.getInstance('DeveloperName')` or `getAll()`. These don't count as SOQL queries. They deploy with the change set, unlike custom settings data.

## Choosing async: Queueable, Batch, Scheduled

| Need | Use |
|---|---|
| Callout or extra work after a trigger or save | **Queueable** (`implements Queueable, Database.AllowsCallouts` for callouts). Enqueue **once per transaction**, passing the `Set<Id>`. |
| Process more records than one transaction can hold (more than about 10,000 rows to update, or millions) | **Batch Apex** (`Database.Batchable<SObject>`). `start` returns `Database.getQueryLocator(...)` (up to 50 million rows), and `execute` works on one scope with bulk DML. |
| Run at a time (nightly) | A **Schedulable** class whose `execute` only calls `Database.executeBatch(new MyBatch(), 200)`. Keep logic out of the Schedulable. |
| Simple fire-and-forget without chaining | `@future(callout=true)` works, but a Queueable is preferred. It can hold non-primitive members (sObjects, Apex objects), it returns a job Id you can monitor, and it can chain. A future method takes only primitives, such as Ids. |

Limits to design around:
- 50 `enqueueJob` calls per transaction, and only **1** from an async context.
- **100 callouts** per transaction, 120 seconds of callout time in total.
- 5 batch jobs queued or active at once, and 100 scheduled jobs.
- No callout after DML in the same transaction until it commits.

Never use a loop of Queueables, or one big transaction, for millions of records. Details and full examples are in `references/patterns.md`.

## Callouts from a trigger

1. The trigger handler filters the records that need sending and enqueues **one** Queueable with their Ids. Better still, it sets a status field such as `Sync_Status__c = 'Pending'`, and the job picks up the pending records.
2. The Queueable queries the records, makes the callouts, **and then** does one DML to save the result status, the external Id and the last error on each record.
3. Size each job's chunk so that **chunk × timeout ≤ 120 seconds** and the chunk is ≤ 100 callouts. For example, 10 records with a 10-second timeout. Chain the next job for the rest. Or send them in one bulk request if the API allows it.
4. Handle failure: treat non-2xx responses as failures, store the error, and retry only 5xx errors and timeouts (with a cap). Never fail silently, and never skip the enqueue without recording the records as pending.

Full example with test: `references/patterns.md`.

## Tests (every answer includes them)

- An `@IsTest` class per class, with records from a **test data factory** (`TestDataFactory`) or `@TestSetup`. **Never `SeeAllData=true`.**
- **Bulk test with 200 records** for every trigger or batch path, plus the "condition not met" case and the "already set" case.
- **Assert with the `Assert` class**: `Assert.areEqual(expected, actual, 'message')`, `Assert.isTrue`, `Assert.isNotNull`, `Assert.fail('Expected exception')`. **Never `System.assertEquals` or `System.assert`** in new code. Assert real field values. A test that only runs the code proves nothing.
- Wrap the code under test in `Test.startTest()` and `Test.stopTest()`. `stopTest()` runs queued async work (Queueable, Batch, future) synchronously, so assert after it.
- **One `startTest`/`stopTest` pair per test method.** Each is allowed only once. Put the setup phase before `startTest` or in `@TestSetup`, or split the phases into separate test methods.
- **Callouts:** use `Test.setMock(HttpCalloutMock.class, mock)` with a success test **and** a failure test (for example a 500 response, asserting the stored error). If the test calls the callout code directly, do the DML before `Test.startTest()`, then call `setMock`. If a trigger enqueues the job, call `setMock`, then do the DML inside the start/stop block. There the callout runs in the async job after `stopTest()`, not after the DML in the same transaction, so DML inside the block is right. Test with fewer records than one job's chunk. A bigger test switches chaining off with a `@TestVisible` flag. Never assert on a chained job, and never claim what tests do with one (see `references/testing.md`).
- **User mode:** test as a user with only the intended permission set, using `System.runAs(user)`. That is the only way to prove the access checks.
- Batch: a test runs **one** `execute`, so insert at most 200 records and pass scope 200.

Factory, mock and runAs patterns are in `references/testing.md`.

## Lightning Web Components

- A record-page component declares `@api recordId` and wires its data reactively with `'$recordId'`.
- **Prefer Lightning Data Service** (`lightning/uiRecordApi`, `lightning/uiRelatedListApi`, or `lightning-record-form`) when it can read the data. Otherwise `@wire` an Apex method that is `@AuraEnabled(cacheable=true)`, `public static`, in a **`with sharing`** class, with **`WITH USER_MODE`**, a `LIMIT` and no DML.
- Build the UI from base components (`lightning-card`, `lightning-datatable`) and SLDS classes. Handle loading, error and empty states.
- `js-meta.xml`: `apiVersion` from `sourceApiVersion`, `isExposed` true, target `lightning__RecordPage` with the object listed.
- **Always include a Jest test** in `__tests__/<name>.test.js` (`@salesforce/sfdx-lwc-jest`). It mocks the Apex method with `createApexTestWireAdapter`, emits data and asserts the rows, and emits an error and asserts the error message. Also include the Apex test for the controller.

Full component, Jest test and Apex test: `references/lwc.md`.

## Before you answer, check

| Check | Fix |
|---|---|
| `without sharing` or no sharing keyword | `with sharing`, or a written reason |
| A query without `WITH USER_MODE`, or DML without `as user` | Add it, or a commented `SYSTEM_MODE` reason |
| SOQL, DML, callout or `enqueueJob` inside a `for` | Move it out, using Sets and Maps |
| A literal Id (`'001…'`, `'012…'`, `'00G…'`) or `https://` endpoint | Describe lookup, query by DeveloperName, Named Credential |
| `System.assertEquals` / `System.assert` | `Assert.areEqual` / `Assert.isTrue` |
| No 200-record test, or no assertion on values | Add it |
| Callout with no failure-path test | `HttpCalloutMock` returning 500, then assert the outcome |
| LWC without a Jest test | Add `__tests__/<name>.test.js` |
| "Want me to do it the safe way instead?" | Do the safe way. Explain the risk in one line. |
| Mentions deploying or validating to production | Remove it. The target is the sandbox, and a person deploys to production. |
