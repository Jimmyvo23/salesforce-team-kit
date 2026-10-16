# Change set: <task-id> <title>

Task: <task-id> · Source sandbox: `<alias>` · Prepared by: Architect · Date: <YYYY-MM-DD>

## 1. Summary
<What the change does for users, in two or three sentences.>

## 2. Components to add
Add them to the outbound change set in this order.

| # | Type | API name | Notes |
|---|---|---|---|
| 1 | <Custom Field> | <Opportunity.Partner_Discount__c> | <why it is needed> |

Commonly missed. Check each one, then list it above or write "not needed":
- Field-level security for new fields (permission sets or profiles)
- Record types and their page layout assignments
- Custom metadata records (the records, not only the type)
- The right flow version, and that it is the active one
- Lightning page activations
- Custom labels and custom settings

## 3. Before deploying
<Manual setup in production, for example a new picklist value or a Named Credential secret. Write "None" if there is nothing.>

## 4. Deployment settings
- Test level: <Run specified tests | Run local tests>
- Tests to run: <exact Apex test class names, comma-separated>

## 5. After deploying
<Activate flows, assign permission sets, load data, schedule jobs. Write "None" if there is nothing.>

## 6. Rollback
<How to undo each part, for example deactivate the flow or activate the previous version, or remove a permission set assignment.>

## 7. Check in production
<Two to five read-only checks Jimmy can do right after deploying.>
