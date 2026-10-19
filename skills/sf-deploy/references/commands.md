# Deploy and retrieve commands

Every command names the sandbox with `-o <alias>` (from `.team/team.json` `orgs.sandbox`). None of these is ever run against production. Check flags with `sf <command> --help`: the installed CLI is the reference.

## Retrieve

| Goal | Command |
|---|---|
| Components into the project (before editing) | `sf project retrieve start -m ApexClass:PartnerDiscountService -m Flow:Renewal_Discount -o uat` |
| The org's copy into another folder (after editing, to compare) | `sf project retrieve start -m ApexClass:PartnerDiscountService -r ../uat-compare -o uat` |
| Everything in a manifest | `sf project retrieve start -x manifest/package.xml -o uat` |
| A permission set with its field permissions | Retrieve it **with** the fields or objects it grants access to (`-m PermissionSet:Partner_Manager -m CustomField:Opportunity.Partner_Discount__c`). Field permissions only come back for components in the same retrieve. |

- `retrieve start` overwrites local files. Retrieve into the project only when you have no unsaved edits, or commit them first so `git diff` shows what the org changed.
- `-r/--output-dir` can't be one of the package directories in `sfdx-project.json`.
- Scratch orgs and Developer/Developer Pro sandboxes can have source tracking: then `sf project deploy preview -o <alias>` and `sf project retrieve preview -o <alias>` list conflicts. Full and Partial Copy sandboxes have no source tracking, so nothing warns you: retrieve and compare.

## Manifest

```bash
sf project generate manifest -m CustomField:Opportunity.Partner_Discount__c \
  -m PermissionSet:Partner_Manager -m ApexClass:PartnerDiscountService \
  -m ApexClass:PartnerDiscountServiceTest -m Flow:Renewal_Discount -d manifest
```

Produces `manifest/package.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types><members>PartnerDiscountService</members><members>PartnerDiscountServiceTest</members><name>ApexClass</name></types>
    <types><members>Opportunity.Partner_Discount__c</members><name>CustomField</name></types>
    <types><members>Renewal_Discount</members><name>Flow</name></types>
    <types><members>Partner_Manager</members><name>PermissionSet</name></types>
    <version><!-- sourceApiVersion from sfdx-project.json --></version>
</Package>
```

Metadata type names you'll use most: `ApexClass`, `ApexTrigger`, `CustomField` (`Object.Field__c`), `CustomObject`, `Flow` (the flow's API name, no version number), `PermissionSet`, `Layout` (`Object-Layout Name`), `FlexiPage`, `CustomMetadata` (`Type.Record`), `CustomLabels`, `RecordType` (`Object.Name`).

## Deploy

```bash
# 1. Dry run: compiles, runs the tests, saves nothing
sf project deploy start --dry-run -o uat -x manifest/package.xml \
  --test-level RunSpecifiedTests --tests PartnerDiscountServiceTest --wait 30
# 2. Real deploy: same command without --dry-run
sf project deploy start -o uat -x manifest/package.xml \
  --test-level RunSpecifiedTests --tests PartnerDiscountServiceTest --wait 30
```

| Flag | Use |
|---|---|
| `-m Type:Name` (repeat) or `-x package.xml` | Exactly the components of the task. |
| `--dry-run` | Validate and run tests without saving. Always first. |
| `-l/--test-level` | `RunSpecifiedTests` with `-t/--tests` (each class and trigger in the deploy needs 75% coverage from those tests). `NoTestRun` is the sandbox default; `RunLocalTests` is what production runs by default for Apex; `RunRelevantTests` is beta. |
| `-w/--wait` | Minutes to wait. If it times out, `sf project deploy report -o uat --job-id <Deploy ID>`. |
| `--json` | Machine-readable result: `result.success`, `result.details.componentFailures`, `result.details.runTestResult`. |
| Never | `-c/--ignore-conflicts` (overwrites the org's version), `-r/--ignore-errors` (partial deploy), a deploy of the whole `force-app`. |

A deploy rolls back completely when any component or test fails (unless `-r`), so components that depend on each other can go in one deploy.

## Deleting components

Deletions use a destructive manifest (`--pre-destructive-changes` / `--post-destructive-changes` with `sf project deploy start`). Plan them in the review; they are rare and hard to undo.
