# Decision rules

## Which tool for record-triggered automation

| Need | Use | Why not the others |
|---|---|---|
| Set fields on the **same record** that is being saved | **Before-save record-triggered flow** (fast field updates), or the existing trigger handler's before logic if the object already uses Apex | Needs no extra DML and no second save. An after-save flow or after trigger has to update the record again, which runs the whole save order a second time. |
| A value derived only from fields on the record, needed only for display or reports | **Formula field** (no stored value) | No automation at all. You can't index it or use it in some filters, and it is limited by compile size. |
| Create, update or delete **other** records, send email, call actions, subflows | **After-save record-triggered flow** (or Apex after trigger) | A before-save flow **cannot** create, update or delete other records. It allows only Assignment, Decision, Get Records and Loop, plus changes to `$Record`. |
| Complex logic, many objects, savepoints or partial success, heavy volume, reuse from other code | **Apex**: one trigger per object, with a handler class | Flow has no `Database.setSavepoint` or `rollback` and no partial-success DML. |
| Medium complexity inside a simple flow | Flow that calls **invocable Apex** | Keeps the entry point declarative and the hard part testable. |
| Callout to an external system | Asynchronous only (see Integration) | You can't make a callout before the transaction commits. |
| Work later or after commit | Flow **Run Asynchronously** or a scheduled path, Queueable, or Platform Event | The Run Asynchronously path runs in its own transaction after the commit. |

Choose **one entry point per object**. If the object already has an Apex trigger with a handler, add the logic to the handler. If it is flow-based, add a flow with an explicit `TriggerOrder`, or extend an existing flow. Avoid mixing many flows and triggers that write the same fields.

New work never uses Workflow Rules or Process Builder. Both are retired. Flag existing ones found by the inventory as migration candidates.

## Entry conditions

- Fire on the **change**, not on every save. In a flow, set the condition and choose **"Only when a record is updated to meet the condition requirements"**. In a formula condition, use `ISCHANGED({!$Record.StageName})` with the new value, or `AND(ISCHANGED(...), ...)`. In Apex, compare `Trigger.oldMap` with the new values.
- Guard the target as well. For example, "only if `Customer_Since__c` is blank" goes in the Update Records filter or a Decision, so the update is idempotent.
- Prefer stable fields such as `IsWon` and `IsClosed` to picklist labels.

## Bulk, recursion, order of execution

- Every design must state its bulk behaviour. Saves arrive in chunks of up to 200 records (Data Loader, API, mass edit). Many children can point to the same parent, so collect parent Ids, query once, and update once. No SOQL or DML inside loops.
- Recursion: an after-save update to the **same** record runs the save again. Before triggers, after triggers and flows run again, and a workflow field update re-runs update triggers once more. Use before-save for same-record changes. In Apex, use a static guard or compare old and new values.
- Order of execution, short form (Apex Developer Guide, "Triggers and Order of Execution"):
  1. System validation.
  2. **Before-save flows**.
  3. **Before triggers**.
  4. Validation rules and duplicate rules.
  5. Save (not yet committed).
  6. **After triggers**.
  7. Assignment rules, auto-response rules, **workflow rules** (field updates re-fire update triggers once).
  8. Escalation rules.
  9. **Process Builder**.
  10. **After-save flows**.
  11. Entitlement rules.
  12. Roll-up summaries to the parent and then the grandparent (each goes through its own save).
  13. Criteria-based sharing.
  14. **Commit**.
  15. Post-commit: email, Queueable and future jobs, async flow paths.
- Updating a related record runs **that** object's full order of execution, including its own flows, triggers and validation rules. That is why the inventory covers it too.

## Integration patterns

| Pattern | Use when |
|---|---|
| Queueable that implements `Database.AllowsCallouts` (enqueued from the trigger handler, or a flow's async path calling invocable Apex) | Salesforce pushes a record to an external API after the save. Chain or re-enqueue for retries. |
| `@future(callout=true)` | Simple fire-and-forget. Prefer Queueable, which you can monitor and chain, and which takes non-primitive parameters. |
| Platform Event (publish behaviour **Publish After Commit**) with a subscriber (Apex trigger, flow, or external client over Pub/Sub API) | You want to decouple from the transaction, or several consumers. Only committed data is sent. Subscriber Apex triggers can retry with `EventBus.RetryableException`. |
| Change Data Capture (`<Object>ChangeEvent`) | The external system subscribes to record changes itself (Pub/Sub API). Select the object on the CDC setup page. Change event triggers run asynchronously after commit. |
| Flow HTTP Callout action | Simple callouts from flows, on an async or scheduled path only. |

Rules:
- **Never** make a synchronous callout in a trigger or a before-save context. Callouts from triggers must be asynchronous, and you can't make a callout with uncommitted work pending.
- Endpoint and authentication go in a **Named Credential** with an **External Credential** (and a principal mapped through a permission set). In code, use `callout:Named_Credential/path`. Never hard-code URLs, tokens or passwords in Apex, custom settings or flows.
- Failure handling is part of the design. Plan the following:
  - status fields on the record, such as `Sync_Status__c` and `Last_Sync_Error__c`, or an integration log object;
  - capped retries with backoff on 5xx errors and timeouts;
  - no retry on 4xx errors, which need a fix;
  - idempotency, such as an external Id or idempotency key, so a retry doesn't create duplicates;
  - an alert, or a scheduled sweep of failed records.
- State the limits: 100 callouts per transaction, a 120-second total callout timeout, and 50 Queueable jobs enqueued per transaction.

## Formula gotchas

Current limits (from the Formula Size tip sheet, Winter '27):

| Limit | Value |
|---|---|
| Characters | 3,900 |
| Saved size | 4,000 bytes |
| **Compiled size** | **15,000 bytes** |

Older documentation and many answers quote 5,000 compiled characters. Check the current Help page "Formula Field Limits and Restrictions" for your release, and treat the compile limit as the binding one.

- The compiled size **includes every field and formula it references**. A formula that references 15 other formulas carries all 15 compiled sizes. Moving logic into helper formula fields does **not** reduce compile size. It helps only with the 3,900-character limit.
- Date functions, `TEXT()`, `DATEVALUE()` and nested `IF`s compile large. `CASE` is usually smaller than nested `IF`s.
- An object can have at most 15 unique cross-object relationship references across its formulas.
- If the limit is hit, or is likely to be, **store the value instead**:
  - a before-save flow that calculates and writes a Number field when the inputs change;
  - Apex, in the trigger handler or a batch job for recalculation;
  - a scheduled flow or batch job when inputs live on other records.

  A stored value can also be indexed and reported on.

## Lookup vs master-detail

| | Lookup | Master-detail |
|---|---|---|
| Sharing | Child has its own owner and sharing | Child inherits the parent's sharing, with no Owner field |
| Ownership | Own owner, so ownership skew is possible | Owner is always the master's owner |
| Cascade delete | Optional (clear the value, or restrict delete). Cascade is off by default | Deleting the parent deletes all children |
| Roll-up summary | No (use Flow or Apex, or a tool such as DLRS) | Yes (COUNT, SUM, MIN, MAX) |
| Required parent | Optional | Always required |
| Limits | Up to 40 relationships per object | Up to 2 master-detail relationships per object |
| Existing data | Add any time | Can't add to an object with records without a lookup-then-convert step |

## Large data volumes and data skew

- **Data skew**: more than about **10,000 child records under one parent**, or one user owning more than 10,000 records. The Large Data Volumes guide says to keep each parent under 10,000 children.
- Effects:
  - **Record locking.** Inserting or updating a child locks the parent, so parallel loads and integrations get `UNABLE_TO_LOCK_ROW`.
  - **Sharing recalculation.** Changing the parent's owner, or the sharing of a master-detail parent, recalculates access for every child, which can take a long time.
  - Roll-up recalculations on a very large parent.
  - Slow related lists.
- Mitigations:
  - Use a lookup instead of master-detail for skewed parents.
  - Spread children across several parents if the business allows it.
  - Group loads by parent Id.
  - Use deferred sharing calculation for big loads.
  - Use selective, indexed queries (custom indexes, skinny tables from Support).
  - Use Bulk API 2.0 for loads.
  - Archive old records (Big Objects or an external store).
- Rule of thumb: at **millions of children with parents over 10,000**, prefer a **lookup**, with a private or controlled-by-parent model chosen on purpose, and roll-ups done by an asynchronous flow or Apex. Use master-detail only when child counts per parent stay well under 10,000 and you need inherited sharing, cascade delete and native roll-ups.
