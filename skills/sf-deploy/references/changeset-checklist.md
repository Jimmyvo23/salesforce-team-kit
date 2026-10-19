# Filling the change set checklist

The template is `.team/changeset-template.md` (installed from the kit's `templates/changeset-template.md`). Read it, copy its header line and its seven sections **in order with the same headings**, and fill them as below. Save the result where the task's files live (for example `.team/tasks/T-012/changeset.md`), or put it in the answer if you can't write files. The person who deploys (the approver in `.team/team.json`) follows it step by step in Setup, so every line names the exact component, setting or user.

If `.team/changeset-template.md` isn't installed in this project, the template's sections are still these seven, so use them and say *"Sections from the change set template (`templates/changeset-template.md` in the team kit)"*: `## 1. Summary`, `## 2. Components to add`, `## 3. Before deploying`, `## 4. Deployment settings`, `## 5. After deploying`, `## 6. Rollback`, `## 7. Check in production`.

## Header line
Task id, source sandbox alias (where the outbound change set is built, for example `uat`), prepared by, date.

## 1. Summary
Two or three sentences for the deployer: what users will see change, and which objects it touches. No implementation detail.

## 2. Components to add
One numbered table row per component, in **dependency order**: anything referred to comes before what refers to it.

1. Custom objects, then custom fields (`Opportunity.Partner_Discount__c`), record types, picklist value sets, custom metadata types and their records.
2. Permission sets that grant access to them (field-level security, object access, Apex class access). A permission set's field permissions only travel when the field is in the same change set or already in production.
3. Apex classes, each **with its test class** on the next row (`PartnerDiscountService`, `PartnerDiscountServiceTest`), then triggers.
4. Flows (after the fields and the Apex actions they call).
5. Layouts, Lightning pages, tabs, apps.

The Notes column says why the row is there and what it depends on, for example *"field first: the class and the flow refer to it"*.

**Commonly missed list:** answer every item in the template's list, either by listing the component above or writing "not needed" with a reason:
- **Field-level security**: which permission set (or profile) grants Read/Edit on each new field. Without it, nobody sees the field.
- **Record types and their page layout assignments**: record types are components; layout assignments per profile are profile settings in the change set.
- **Custom metadata records**: add the records (`Type.Record`), not only the type.
- **The right flow version, and that it is the active one**: name the version that passed UAT. The change set carries the flow's versions; in production the version is inactive after deploy unless the org has "Deploy processes and flows as active" turned on, so activation goes in section 5.
- **Lightning page activations**: activations and assignments aren't deployed by the page itself; note them in section 5.
- **Custom labels and custom settings**: labels the code uses; custom setting **values** are data, so they go in section 3 or 5.

## 3. Before deploying
Manual steps in production that the change set can't carry, in order: new values in a standard picklist, a Named Credential's secret, a queue or public group, a feature setting. Each step names the Setup page. Write "None" if there is nothing.

## 4. Deployment settings
- Test level: **Run specified tests** when the change set has Apex (list every test class of the classes in it; each class in the change set needs 75% coverage from those tests). Use **Run local tests** only if the review asked for it.
- Tests to run: the **exact** Apex test class names, comma-separated (`PartnerDiscountServiceTest`).
- With no Apex in the change set, say "Default".

## 5. After deploying
In order, each with where to do it: activate the flow version (Setup > Flows > the flow > the version > Activate), assign permission sets (to which users or group), activate Lightning pages, load custom setting or reference data, schedule jobs. Write "None" if there is nothing.

## 6. Rollback
One line per part, saying how to undo it in production:
- Flow: deactivate it, or activate the previous version.
- Permission set: remove the new assignments (or the new field permission).
- Apex: Apex can't be edited in production; roll back by deploying the previous version in a change set from a sandbox that still has it, or by turning off the flow or setting that calls it.
- Field: leave it in place (deleting it deletes its data); remove its field-level security and take it off layouts.
- Data loaded: how to find and delete or restore it.

## 7. Check in production
Two to five **read-only** checks the deployer can do right after deploying: the deploy status shows the tests passed; the flow shows the expected version as Active; a user with the permission set sees the field; one existing record shows the expected value. No test records in production unless the review says so.
