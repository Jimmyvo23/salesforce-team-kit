# Flow checklist and inventory queries

## 1. Automation inventory (before the design)

Run these against the **sandbox alias** (from `.team/team.json` `orgs.sandbox`, for example `uat`), never against production. Replace `Case` with every object the flow triggers on or writes to.

```sh
# Flows on the object, with trigger type and order (standard API, filters on the object API name; confirm this filter once in the sandbox, and if a custom object is relabelled the API name still works)
sf data query -o <alias> -q "SELECT ApiName, Label, ProcessType, TriggerType, RecordTriggerType, TriggerOrder, IsActive, ActiveVersionId, NamespacePrefix FROM FlowDefinitionView WHERE TriggerObjectOrEvent.QualifiedApiName = 'Case' ORDER BY TriggerType, TriggerOrder"

# Active Process Builder processes (then read each one's ObjectType from its Metadata, one Id per query)
sf data query --use-tooling-api -o <alias> -q "SELECT Id, MasterLabel, ProcessType, Status, VersionNumber FROM Flow WHERE ProcessType = 'Workflow' AND Status = 'Active'"
sf data query --use-tooling-api -o <alias> --json -q "SELECT Metadata FROM Flow WHERE Id = '<flow version id>'"

# Apex triggers (for a custom object use its CustomObject Id instead of the name)
sf data query --use-tooling-api -o <alias> -q "SELECT Name, Status, UsageBeforeInsert, UsageAfterInsert, UsageBeforeUpdate, UsageAfterUpdate FROM ApexTrigger WHERE TableEnumOrId = 'Case'"

# Workflow Rules (active state and actions are in Metadata, one Id per query)
sf data query --use-tooling-api -o <alias> -q "SELECT Id, Name FROM WorkflowRule WHERE TableEnumOrId = 'Case'"

# Validation rules (they can block the records the flow writes)
sf data query --use-tooling-api -o <alias> -q "SELECT ValidationName, Active, ErrorMessage FROM ValidationRule WHERE EntityDefinition.QualifiedApiName = 'Case'"
```

Without a shell, write these out and ask the user to run them, or to open **Setup > Flow Trigger Explorer** for the object. Mark the design provisional until the results are back.

How the results change the design:
- An existing flow with the same trigger type that does related work: add a path or Decision outcome to it, or give the new flow an explicit **Trigger Order**.
- An Apex trigger that writes the same fields or records: put the logic in its handler instead (see the Apex skill), or make sure the two don't both write.
- An active Process Builder or Workflow Rule on the object: plan its migration, and make sure it doesn't do the same job.

## 2. Element-by-element design template

For each element give: **type**, **label / API name**, **settings** (object, filters, field values), **connector** and **fault connector**.

Example: a closed Case creates a follow-up Task.
1. **Start:** record-triggered, Case, "A record is updated" (or created or updated), Actions and Related Records (after-save). Condition `IsClosed` Equals `true`, with "Only when a record is updated to meet the condition requirements".
2. **Decision `Owner Is User`:** a Task owner must be a user, and a Case can be owned by a queue. Use the formula `LEFT({!$Record.OwnerId}, 3) = '005'` (the User key prefix is the same in every org). The other outcome assigns the Task to a fallback user from custom metadata, or skips it, and says so.
3. **Formula `fxDueDate`** (Date): `{!$Flow.CurrentDate} + 3`. Say whether it means calendar days or business days.
4. **Create Records `Create Follow-Up Task`:** Task with `OwnerId` = `{!$Record.OwnerId}`, `WhatId` = `{!$Record.Id}`, `ActivityDate` = `{!fxDueDate}`, Subject, Status, Priority. **Fault connector** goes to element 5.
5. **Fault handling:** choose one and say why.
   - **Log and continue:** a Send Email action to the admin with `{!$Flow.FaultMessage}` and `{!$Record.Id}`, with its own fault connector to the end.
   - **Block the close:** a Custom Error. That rolls back emails and records too, so log with a Publish Immediately platform event.

## 3. Bulk check

- Count per transaction: up to 200 triggering records × the children of each.
- Limits are shared by every flow, trigger and process in the transaction: 100 SOQL queries, 150 DML statements, 10,000 DML rows, and CPU time.
- Many children per parent: an asynchronous path, or Batch Apex. Say the threshold you assumed.
- Test with a list edit or data load of 200 records in the sandbox, not one record.

## 4. Test plan (sandbox)

| Flow type | Test |
|---|---|
| Record-triggered, autolaunched | **Flow tests**: one per path, plus "condition not met" and "already in target state". Use assertions on the triggering record and on outputs. Then real records, including a 200-record update. |
| Screen flow | **Debug** in Flow Builder, then run it as a test rep (a user with only the reps' permission set) from the real page or action. Include the Apex failure path. |
| Scheduled path | Flow tests can run a scheduled path (choose it in the test, API 56.0 and later). Also use real records and check the scheduled jobs. |
| Run Asynchronously path | Flow tests don't run it. Use real records and check **Paused and Failed Flow Interviews**. |

## 5. Activation and rollback (sandbox)

1. Note the current active version number (Setup > Flows > the flow > View Details and Versions).
2. Run the tests on the new, inactive version.
3. Activate the new version. The previous one becomes inactive automatically.
4. Re-run a smoke test on real records.
5. To roll back, activate the previous version again. Keep it: don't delete old versions while the new one is unproven.
6. Production: a person moves it with a change set and decides when to activate it there.

## 6. Final review

- [ ] Inventory section comes first, with queries or results
- [ ] Type chosen with a reason (before-save, after-save, screen, autolaunched)
- [ ] Entry condition fires only on the change
- [ ] Every Create, Update, Delete, Get, Apex action, subflow, email and callout has a fault connector
- [ ] No Get, Create, Update, Delete, Apex action or subflow inside a Loop
- [ ] Bulk behaviour stated with numbers
- [ ] Run context and permissions stated
- [ ] No hard-coded Ids, users or queues
- [ ] Naming and descriptions
- [ ] Test plan, activation in the sandbox, rollback version
- [ ] `apiVersion` from `sourceApiVersion`; nothing deployed or validated to production
