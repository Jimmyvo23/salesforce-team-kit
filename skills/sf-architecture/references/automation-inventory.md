# Automation inventory

Run this for **every object the change touches**: the object that triggers the change, every object it writes to, and any parent with roll-up summaries that will recalculate. Run it before you choose before-save, after-save or Apex. The repo (`force-app/`) is not the org. An empty `triggers/` or `flows/` folder proves nothing.

Replace `<alias>` with the sandbox alias from `.team/team.json` (`orgs.sandbox`). Never run these against production.

## 0. Object name or object Id

Standard objects use their API name (`Opportunity`). For a **custom object**, `TableEnumOrId` on `ApexTrigger` and `WorkflowRule` holds the object's Id, not its API name. Get the Id first (`DeveloperName` has no `__c`):

```sh
sf data query --use-tooling-api -o <alias> -q "SELECT Id, DeveloperName, NamespacePrefix FROM CustomObject WHERE DeveloperName = 'Invoice'"
```

## 1. Record-triggered flows (and their trigger order)

`FlowDefinitionView` is documented in the Object Reference (standard API), not the Tooling API, so query it **without** `--use-tooling-api`. It filters on the object **label**. If the object was relabelled (for example Opportunity shown as "Deal"), use the label the org shows.

```sh
sf data query -o <alias> -q "SELECT ApiName, Label, ProcessType, TriggerType, RecordTriggerType, TriggerOrder, IsActive, ActiveVersionId, NamespacePrefix FROM FlowDefinitionView WHERE TriggerObjectOrEventLabel = 'Opportunity' ORDER BY TriggerType, TriggerOrder"
```

How to read it:
- `TriggerType`: `RecordBeforeSave` (fast field updates), `RecordAfterSave` (actions and related records), `RecordBeforeDelete`, `Scheduled`, `PlatformEvent`.
- `RecordTriggerType`: `Create`, `Update`, `CreateAndUpdate`, `Delete`.
- `TriggerOrder` (1 to 2,000): the run order among flows with the same trigger type on the object. Blank means unordered. Give a new flow an explicit order that fits the existing ones.
- `IsActive = false` with an `ActiveVersionId` still set means an older version is live. Count it.
- `NamespacePrefix` set means a managed package owns it. You can't change it, but it still runs.

## 2. Process Builder processes (record change processes)

Processes have `ProcessType = 'Workflow'`. List the active ones in the org:

```sh
sf data query --use-tooling-api -o <alias> -q "SELECT Id, MasterLabel, ProcessType, Status, VersionNumber FROM Flow WHERE ProcessType = 'Workflow' AND Status = 'Active'"
```

The object a process runs on is in its metadata. `Metadata` can be queried for **one record at a time** only, so query each Id from the list above:

```sh
sf data query --use-tooling-api -o <alias> --json -q "SELECT Metadata FROM Flow WHERE Id = '<flow version id>'"
```

In the JSON, the `processMetadataValues` entry named `ObjectType` gives the object. Process Builder is retired for new work. Any process on the object is a migration candidate, and you must not add another one.

## 3. Apex triggers

```sh
sf data query --use-tooling-api -o <alias> -q "SELECT Id, Name, Status, NamespacePrefix, UsageBeforeInsert, UsageAfterInsert, UsageBeforeUpdate, UsageAfterUpdate, UsageBeforeDelete, UsageAfterDelete, UsageAfterUndelete FROM ApexTrigger WHERE TableEnumOrId = 'Opportunity'"
```

For a custom object, use the Id from step 0: `WHERE TableEnumOrId = '01I...'`.

- More than one active trigger for the same event means the order between them **is not guaranteed** (Apex Developer Guide). Put new logic in the existing trigger's handler. Never add a second trigger.
- Read the trigger and its handler class in `force-app/` (or retrieve them) to see what fields they set and which records they write.

## 4. Workflow rules

```sh
sf data query --use-tooling-api -o <alias> -q "SELECT Id, Name, NamespacePrefix FROM WorkflowRule WHERE TableEnumOrId = 'Opportunity'"
```

The list includes inactive rules. Active state and field updates are in `Metadata`, one record per query:

```sh
sf data query --use-tooling-api -o <alias> --json -q "SELECT Metadata FROM WorkflowRule WHERE Id = '<id>'"
```

Look at `active` and at the actions. A workflow field update re-fires before and after update triggers once more (order of execution step 11). Workflow rules are retired for new work, so don't add one.

## 5. Validation rules (they run between before triggers and the save)

```sh
sf data query --use-tooling-api -o <alias> -q "SELECT Id, ValidationName, Active, ErrorMessage FROM ValidationRule WHERE EntityDefinition.QualifiedApiName = 'Opportunity'"
```

An update to a related record runs that record's validation rules. A design that writes to Account must check Account's rules.

## 6. Record the result in the design

Put a table in `docs/design/<task-id>.md` **before** the recommendation:

| Object | Type | Name | Event / trigger type | Order | Active | Touches same fields? |
|---|---|---|---|---|---|---|

Then say how the new automation fits: which existing flow or trigger handler it joins, its `TriggerOrder`, and what runs before and after it.

## When you cannot run the queries

If you have no shell or org access (for example read-only tools), still write the queries above with the real object names and alias, ask the user to run them (or to open **Setup > Flow Trigger Explorer** for each object), and mark the approach as provisional until the results are back. Name what would change the decision. For example: "if an Opportunity trigger already exists, the logic goes in its handler, not in a flow."

## Also check

- Flow Trigger Explorer (Setup) shows the record-triggered flows per object and trigger. Flows created from a template may not appear there, so the query above is the complete list.
- Managed-package triggers and flows (`NamespacePrefix`) run too, so count them in limits and order.
- Roll-up summary fields on the parent: a child save recalculates the parent, and the parent goes through its own save (order of execution step 16).
