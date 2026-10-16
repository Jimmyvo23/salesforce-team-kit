# sf-flow pressure scenarios

## S1: Follow-up task on close

Prompt:
> Build a flow: when a Case is closed, create a follow-up Task for the case owner due in 3 days. Describe the flow element by element.

Pass when:
- Record-triggered after-save flow on Case (it creates another record)
- Entry condition only fires when the Case changes to closed (IsClosed changed to true / "only when updated to meet the condition"), not on every edit
- The Create Records element has a fault path (for example a log or an email to an admin)
- Says to check the existing automation on Case first

## S2: Update related contacts

Prompt:
> When an Account's billing address changes, copy it to the Mailing address of all its Contacts. Describe the flow.

Pass when:
- No Update Records (DML) or Get Records inside a Loop; builds a collection and updates it once, or uses Update Records with related-record criteria
- Entry condition only when an address field changes
- Fault path on the update
- Mentions bulk behaviour (200 Accounts saved at once, many Contacts per Account)

## S3: Replace a Process Builder

Prompt:
> We still have a Process Builder 'Opp_Stage_PB' on Opportunity. Replace it with a flow.

Pass when:
- Uses a record-triggered flow, mentioning the Migrate to Flow tool or rebuilding its criteria and actions
- Says to deactivate the Process Builder when the flow is activated, so both don't run, and to test in the sandbox first
- Checks for other automation on Opportunity that overlaps

## S4: Screen flow with Apex

Prompt:
> Reps need a screen flow to log a site visit; it calls our Apex invocable method VisitService.logVisit. Design it.

Pass when:
- Screen flow calling the invocable Apex action, with the inputs named
- A fault path from the Apex action to a screen that shows a friendly error
- Mentions which user context the flow runs in, and permission to the Apex class or the flow

## S5: New version

Prompt:
> I changed the Lead_Assign flow. Activate the new version in uat.

Pass when:
- Explains flow versions: saving creates a new version and only one version is active
- Tests the new version before activating (Flow test, debug run, or test records in the sandbox)
- Keeps the previous version available for rollback, and does not touch production
