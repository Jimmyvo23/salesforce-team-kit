---
name: sf-deploy
description: Use when deploying or retrieving Salesforce metadata in an SFDX project - deploying a flow, Apex class, field or permission set to a sandbox such as uat, building a package.xml manifest, reading a failed deploy (Component Failures, "Variable does not exist", missing dependency), writing the change set checklist for a production release, or when someone asks to deploy straight to production.
---

# Salesforce Deploy

## Overview

A sandbox deploy is **retrieve, dry-run, deploy**, always naming the org and the exact components. Production is never deployed by an agent: **a person (the approver in `.team/team.json`, for example Jimmy) deploys to production with a change set**, and your job is the change set checklist.

**First, read:**
- `sfdx-project.json` `sourceApiVersion`: use it for new `-meta.xml` files. Don't name a release.
- `.team/team.json` `orgs.sandbox`: the sandbox alias (for example `uat`). Pass it with `-o` on **every** command. Never rely on a default target org: the CLI may have one set to another org.

## 1. Production requests: refuse, then give the checklist

"Deploy it to production", "it's urgent", "just run `sf project deploy start` against prod":

1. Say plainly: *"I don't deploy to production, and I won't run a validate-only or quick deploy against it either. Jimmy deploys to production himself with a change set."* (Use the approver's name from `.team/team.json`.)
2. **Write the change set checklist now** (section 5), or if the components aren't known, offer it as the next step and ask only for the task's component list.
3. Optionally offer the sandbox dry-run (section 3) so the change set is known to be good.

Never ask for a production alias, offer to log in to production, or show a command with a production org. Urgency doesn't change who deploys.

| Excuse | Reality |
|---|---|
| "It's urgent" | The change set checklist is the fast path: it is ready in minutes. |
| "I'd just need the prod alias" | Asking for it is offering a production deploy. Don't. |
| "A validate-only/`--dry-run` against prod is harmless" | It is still a production deployment command. Not ours to run. |
| "`sf project deploy quick` reuses a validation" | Same rule: production, so no. |

## 2. Answer shape for a sandbox deploy

Give the **full command sequence** for the named components, in this order, even if you can't run commands (then say once: *"Not run: no shell in this session. Run these in order and paste the output."*):

1. **Retrieve** (protect other people's sandbox changes).
2. **Dry-run** deploy with `--dry-run`, `-o <alias>`, the exact components, and the tests.
3. **Real deploy**: the same command without `--dry-run`.
4. **After the deploy**: what to check (flow active, tests passed, permission set assigned).

If the files aren't in the project, don't stop: that's another reason to retrieve. State the assumed paths, give the sequence, and say what to check.

## 3. The commands

**Retrieve before editing.** Full and Partial Copy sandboxes (most UAT orgs) have **no source tracking**, so a deploy doesn't detect conflicts: it overwrites whatever is in the org, including a teammate's change made since you last retrieved.

- Not edited yet: retrieve into the project, then edit.
  ```bash
  sf project retrieve start -m Flow:Renewal_Discount -m ApexClass:PartnerDiscountService -o uat
  ```
- Already edited: retrieve the org's copy **into another folder** (retrieve into the project overwrites your edits), compare, and merge anything someone else changed.
  ```bash
  sf project retrieve start -m Flow:Renewal_Discount -m ApexClass:PartnerDiscountService -r ../uat-compare -o uat
  ```
  Then compare each retrieved file with yours (for example with `diff`), and delete the folder afterwards.

**Dry-run, then deploy, with exactly those components** (`-m` per component, or `-x manifest/package.xml`):

```bash
sf project deploy start --dry-run -o uat \
  -m Flow:Renewal_Discount -m ApexClass:PartnerDiscountService \
  --test-level RunSpecifiedTests --tests PartnerDiscountServiceTest --wait 30
# Dry run passed? Same command without --dry-run:
sf project deploy start -o uat \
  -m Flow:Renewal_Discount -m ApexClass:PartnerDiscountService \
  --test-level RunSpecifiedTests --tests PartnerDiscountServiceTest --wait 30
```

- **Tests**: `RunSpecifiedTests` with the test class of every Apex class in the deploy, plus any test that exercises the flow. It needs 75% coverage for **each** class and trigger in the deploy. Sandboxes default to `NoTestRun`, so name the tests: production will run them.
- **Exactly those components**: never deploy the whole `force-app` folder or use `--ignore-conflicts` to make a deploy "go through".
- Many components or a change set coming: generate a manifest. `sf project generate manifest -m <Type:Name> ... -d manifest`.
- More flags and the manifest format: `references/commands.md`.

## 4. Reading a failed deploy

Read the `Component Failures` table: **Type, Name, Problem (line:column)**. Most failures are a missing dependency: the component refers to something that isn't in the deploy **and** isn't in the target org.

Steps:
1. Name what's missing. *"`Variable does not exist: Partner_Discount__c (12:24)` in `PartnerDiscountService`: line 12 of the class refers to the field `Partner_Discount__c`, which isn't in uat and wasn't in this deploy."* (Or the name is misspelled, or on another object: check line 12.)
2. Search the project for it (`**/objects/*/fields/Partner_Discount__c.field-meta.xml`). Missing locally? Retrieve it from the sandbox where it was built. **Don't retrieve the failed component into the project**: the deploy rolled back, so the org still has the old version, and retrieving it would overwrite your edits (if its file isn't in this project, ask where the edited copy is).
3. **Fix the order**: deploy the field **with** the class (one deploy, both `-m` flags) or before it. One deploy is all or nothing, so the field and the class land together.
4. **Field-level security**: a new field has no access for anyone. Add the field to the permission set (`fieldPermissions`) and put the permission set in the **same** dry-run and deploy. Compiling doesn't need FLS, but users and user-mode Apex do.
5. **Re-run the `--dry-run`** with the fixed component list, then the real deploy.

```bash
sf project deploy start --dry-run -o uat \
  -m CustomField:Opportunity.Partner_Discount__c -m PermissionSet:Partner_Manager \
  -m ApexClass:PartnerDiscountService \
  --test-level RunSpecifiedTests --tests PartnerDiscountServiceTest --wait 30
```

Other errors (no such column, test failures, coverage below 75%, flow version errors): `references/errors.md`.

## 5. Change set checklist

When a task is approved for production, write the checklist **using the seven sections of `.team/changeset-template.md`**, in its order and with its headings: 1. Summary, 2. Components to add, 3. Before deploying, 4. Deployment settings, 5. After deploying, 6. Rollback, 7. Check in production. Read the template first; if it isn't installed, these seven are its sections all the same: say you used the change set template's sections. How to fill each section: `references/changeset-checklist.md`.

The parts people miss:
- **Components in dependency order**, numbered: fields and objects first, then the permission set that grants their FLS, then Apex classes with their test classes, then flows, then layouts and Lightning pages. Say it's dependency order and why (for example *"field first: the class and the flow refer to it"*).
- **Every commonly-missed item**, answered: field-level security, record types and layouts, custom metadata records, **the right flow version and that it's active**, Lightning page activations, custom labels and settings. Write "not needed" when one doesn't apply.
- **Test level** `Run specified tests` with the **exact test class names**.
- **After deploying**: activate the flow (change sets deploy flows inactive unless production has "Deploy processes and flows as active" on), assign the permission set.
- **Rollback** for each part.

## Common mistakes

| Mistake | Fix |
|---|---|
| Deploy without retrieving first | Retrieve, compare, then deploy. No source tracking means no conflict check. |
| Straight to the real deploy | `--dry-run` first, same flags. |
| No `-o`, or `-o` copied from another task | `-o <sandbox alias>` from `.team/team.json` on every command. |
| Whole `force-app` or `--ignore-conflicts` | `-m` per component or a manifest. |
| New field deployed without FLS | Permission set with `fieldPermissions`, in the same deploy. |
| Checklist sections invented | The template's seven sections, in order. |
