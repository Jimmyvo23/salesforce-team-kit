# Flow types, metadata and run context

Values are from the Metadata API Developer Guide v68.0 (Winter '27). New trigger types are added in most releases, so this is not a complete list. Check the current guide for anything not listed here.

## Record-triggered flows (`processType` `AutoLaunchedFlow`, `start.object` set)

| Flow Builder option | `start.triggerType` | Use for | Can't do |
|---|---|---|---|
| Fast Field Updates | `RecordBeforeSave` | Setting fields on the triggering record. It can still use Get Records (give it a fault connector). | Create, update or delete other records; actions; subflows |
| Actions and Related Records | `RecordAfterSave` | Other records, email, Apex actions, subflows, scheduled and asynchronous paths | Changing `$Record` without another save (that costs a DML and re-runs the save) |
| Record is deleted (before delete) | `RecordBeforeDelete` | Cleanup or a Custom Error before a delete | — |

`start.recordTriggerType`: `Create`, `Update`, `CreateAndUpdate` or `Delete`.

Entry condition fields on `start`:
- `filters` plus `filterLogic` (`and`, `or`, or custom logic such as `1 AND (2 OR 3)`), or `filterFormula` for a formula condition.
- `doesRequireRecordChangedToMeetCriteria` set to `true` means "Only when a record is updated to meet the condition requirements". The condition is true only if the record didn't meet it before the update and does now. A new record that meets it always counts.
- `ISCHANGED`, `ISNEW` and `PRIORVALUE` work in record-triggered flow formulas. `ISCHANGED` is never true on create. Asynchronous paths don't support `ISCHANGED`.

Paths in an after-save flow:
- **Run immediately:** inside the save transaction.
- **Run asynchronously:** after the commit, in its own transaction. Use it for callouts.
- **Scheduled paths:** a time offset from a date field, or from when the record is created or updated. A scheduled path whose time source is "When Record is Created or Updated" needs specific entry-condition settings, such as "Only when a record is updated to meet the condition requirements".

Trigger order: set **Trigger Order** (1 to 2,000) when several flows with the same trigger type exist on the object. Check it in Flow Trigger Explorer.

## Other flow types

| Type | How it starts | Notes |
|---|---|---|
| Screen flow (`processType` `Flow`) | Lightning page, quick action, button, utility bar, Experience Cloud | The only type with screens. It has no Flow tests: debug it and run it as the target user. |
| Autolaunched, no trigger | Subflow element, Apex (`Flow.Interview`), REST, button | Reusable logic. An autolaunched flow can't call a screen flow. |
| Schedule-triggered | `triggerType` `Scheduled` with a schedule | Runs over the records matching its filter. For very large volumes, use Batch Apex. |
| Platform event-triggered | `triggerType` `PlatformEvent` | Runs after the event is published. It can't call subflows. |

## Run context (`runInMode`)

| Value | Flow Builder label | Meaning |
|---|---|---|
| `DefaultMode` (or blank) | User or System Context—Depends on How Flow is Launched | Record-triggered, schedule-triggered and platform event flows run in **system context without sharing**. Screen flows and flows launched from Lightning pages, actions, buttons and REST run in **user context**. A user-context flow called by a system-context caller (another flow or Apex) can inherit the caller's elevated access. |
| `SystemModeWithSharing` | System Context with Sharing—Enforces Record-Level Access | Sharing applies, object and field permissions don't. |
| `SystemModeWithoutSharing` | System Context without Sharing—Access All Data | All data. |
| `UserMode` | User Context—Enforces User Permissions | Always the running user's access, whatever calls it. Screen and autolaunched flows, **API 68.0 and later only**. Check `sourceApiVersion` before suggesting it. |

Access a user needs to run a screen flow:
- the **Run Flows** permission;
- if the flow's access override is on, a profile or permission set given access to that flow;
- **Apex Class Access** to any invocable Apex class the flow calls.

Record-triggered, schedule-triggered and platform event flows don't need Run Flows.

## Invocable Apex in a flow

- The method is `public` or `global` `static`, in an outer class, and is the only `@InvocableMethod` in the class.
- It takes one `List<…>` parameter. The return list must have the same size and order as the inputs, because a record-triggered flow calls it in bulk.
- In the Action element, map each `@InvocableVariable` input by name. Store the outputs in variables.
- Exceptions go to the fault connector. Expected failures are better returned as an output (`isSuccess`, `errorMessage`) that a Decision checks.

## Versions and deploys (Metadata API)

- `Flow.status`: `Active`, `Draft` (shown as Inactive), `Obsolete` (shown as Inactive), `InvalidDraft` (shown as Draft).
- A flow keeps up to 50 versions. Only one is active. Activating one deactivates the previous one. Running and paused interviews keep their version.
- You can't delete an active version, or a version with paused interviews.
- **Sandbox:** deploying changes to an active flow creates a new version. With `<status>Active</status>` in the file, that new version is active at once. A flow file without a status deploys as `Draft` (inactive). Deploy as `Draft` when the version must be tested before activation.
- `FlowDefinition.activeVersionNumber`, if deployed, overrides `status`.
- `FlowTest` metadata (`.flowtest-meta.xml` in `flowtests/`, API 55.0 and later) holds Flow tests for record-triggered, autolaunched and Data Cloud-triggered flows.
- Process Builder processes are stored as `Flow` with `processType` `Workflow` (or `InvocableProcess`). Don't edit their metadata by hand.
