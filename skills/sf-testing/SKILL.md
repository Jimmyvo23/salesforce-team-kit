---
name: sf-testing
description: Use when writing or reviewing Salesforce tests in an SFDX project - Apex test classes from a user story or acceptance criteria, tests for a flow or trigger, permission tests with System.runAs, callout tests, raising code coverage to 75%, running Apex tests in a sandbox and reading the results, or verifying that a change deployed to a sandbox (UAT) works.
---

# Salesforce Testing

## Overview

A test proves a behaviour with an assert. **Coverage is a floor, asserts are the goal.** Every answer delivers the full test code, even when you can't write files (then put every file in the answer, with its path and its `-meta.xml`). Don't stop at questions: when something is missing, state the assumption, write the tests, and say what to change if it's wrong.

**Answer shape, in this order:**
1. **Coverage request** ("get it to 75%", "whatever gets it over the line"): the answer's first two sentences are, in your words: *"I won't add tests without assertions just to push coverage over 75%: they pass even when the code is wrong. 75% is the floor Salesforce requires to deploy, not the goal, so these tests assert each behaviour of the class, and the coverage follows."* Nothing comes before them, not even a note about tools.
2. Assumptions, a few lines.
3. The test plan table (section 1), or for a sandbox check the verification runbook (section 6).
4. Every file in full, with its path.
5. The test-run command and what to read in the JSON (section 5).
6. Last, one line: *"Next: save the files at the paths shown (Write is disabled here), run the command above against the sandbox, and paste the output."* Adapt it to what this session couldn't do. **Never open the answer with it.**

Before saying a component is missing, search the project: `**/*.flow-meta.xml`, `**/objects/<Object>/fields/*`, `**/classes/*.cls`.

**First, read `sfdx-project.json` `sourceApiVersion`.** Use it for every new `-meta.xml` `apiVersion`. Don't name a release. It decides whether database operations default to user mode (API 67.0 and later) or system mode (66.0 and earlier). Tests run in the **sandbox alias** (`.team/team.json` `orgs.sandbox`, for example `uat`). Production deploys are done by a person with change sets: never suggest deploying, validating or quick-deploying to production, and never run a command against it.

The base rules (factory, `Assert` class, mixed DML, callout mocks, batch tests) are in the **sf-apex** skill (`references/testing.md`). This skill adds the plan, the story-driven tests, coverage, test runs and UAT checks.

## 1. Plan from the acceptance criteria

Before code, write the plan as a table: **one test method per acceptance criterion**, then one per edge case. Each row has Given (setup), When (the action), Then (the assert). Template: `references/test-plan.md`.

Every story gets these, even if it doesn't list them:
- **Positive**: the condition is met and the value is set.
- **Negative**: the condition isn't met and nothing changes ("stays blank" means `Assert.isNull`).
- **Already set**: seed a value that **differs** from what the automation writes (for example Medium when it writes High), make the edit, assert it is still Medium. Seeding the same value proves nothing. Seed it on a record the automation doesn't match on create (for example a Case on a Silver Account), so the create can't overwrite the seed, then make the edit that **would** match (for example move it to a Gold Account).
- **Bulk**: **200 records in one DML**, with an assert on every record or a `COUNT()`.
- **Restricted user**: `System.runAs` a user who really lacks the access (section 3).

## 2. Test class rules

- Data from a **test data factory** class or **`@TestSetup`**. Never `SeeAllData=true`. Private helper methods inside the test class are not a factory.
- Assert with the **`Assert` class** (`Assert.areEqual(expected, actual, 'message')`, `Assert.isNull`, `Assert.isTrue`, `Assert.fail`). Never `System.assertEquals` in new code. Re-query the record and assert **field values** after `Test.stopTest()`.
- **One `Test.startTest()` / `Test.stopTest()` pair per method.** Setup DML goes before `startTest` or in `@TestSetup`. Only the action goes inside.
- Name tests by behaviour: `goldAccountCaseGetsHighPriority`, not `test1`.
- **Logic in a flow or trigger**: the test does DML on the record (insert or update), which runs the record-triggered flow or trigger, then re-queries and asserts. The flow must be active in the org where the tests run. If it isn't in the project, say so, and write the tests against the story.

## 3. Restricted user with System.runAs

Don't assume a profile lacks access ("Standard User probably can't edit it"). **Build the access in the test**:

1. A user on the **Minimum Access - Salesforce** profile with a **unique Username** (usernames are unique across all orgs: add a random number and `.test`).
2. A **permission set** created in the test: `ObjectPermissions` for the object (plus Read on Account for Opportunity or Contact), and `FieldPermissions` with **Edit** on the fields the test sets and **Read only** (`PermissionsEdit = false`) on the field under test. Or assign the team's real permission set if it's in the project.
   **Only permissionable fields get `FieldPermissions`.** Required fields (for example Opportunity `Name`, `StageName`, `CloseDate`), `OwnerId` and master-detail fields have none, and inserting one fails. Skip any field whose `getDescribe().isPermissionable()` is false (the helper in `references/apex-tests.md` does).
3. Do all of that setup DML (User, PermissionSet, ObjectPermissions, FieldPermissions, PermissionSetAssignment) inside **`System.runAs(new User(Id = UserInfo.getUserId()))`**. Mixing it with Account or Opportunity DML otherwise throws `MIXED_DML_OPERATION`.
4. Give the user **record access to parents**: make them the owner of the test Account, or create it inside `runAs`.
5. Inside `System.runAs(u)`: assert the precondition (`Schema.SObjectType.Case.fields.Priority.isUpdateable()` is false), then `insert as user` the record (`as user` checks this user's CRUD and FLS at every API version).
6. **Re-query and assert after the `runAs` block**, as the test's own user, so the assert can read the field.

Wherever user mode applies (`as user`, `WITH USER_MODE`, or the default at API 67.0+), the runAs user needs **Edit on every field the test sets**, lookups such as `AccountId` included, and **Read on every field the code selects, filters or sorts on** (`WHERE`, `ORDER BY`). Otherwise the test fails on access, not on the behaviour.

**Expected result:** a record-triggered flow runs in **system context without sharing** (see the sf-flow skill), so it still sets a field the user can't edit: assert the value. Apex that writes the field in user mode fails for this user: assert the `DmlException`. If the story doesn't say which, state the assumption.

Full class, `RestrictedUser` helper and factory: `references/apex-tests.md`.

## 4. Coverage is a floor

When asked to "just get it over 75%" or "add whatever gets it over the line", the answer **starts with the two sentences in the Answer shape** (the refusal and "75% is the floor, not the goal"). Then:
- Aim to cover every behaviour: positive, negative, bulk and restricted user.
- Find **which** lines are uncovered (the JSON `coverage` `lines` map, value `0`, see section 5) and write one test per behaviour those lines implement.
- Check **which** number it is: one class, or org-wide. Deployment needs 75% across the Apex in the org, every trigger needs some coverage, and `RunSpecifiedTests` needs 75% for each class and trigger in the deployment. Production runs the tests again on its own data and metadata, so its number can differ from the sandbox's.
- Never write: a test with no assert, `Assert.isTrue(true)`, a catch block that swallows every exception, `SeeAllData=true` to reach org data, or code changes made only to raise coverage.

| Excuse | Reality |
|---|---|
| "We need 75% today, assertions later" | Later doesn't come. The asserts take minutes once the calls are written. |
| "Coverage is coverage" | A call with no assert passes when the code is wrong. |
| "The method is trivial" | Then its assert is one line. Write it. |

## 5. Run the tests in the sandbox and read the JSON

```sh
sf apex run test -o uat --class-names GoldCasePriorityTest --code-coverage --result-format json --wait 10 > test-result.json
```

- Always pass `-o <sandbox alias>`. Never rely on the CLI's default org.
- `--wait` makes the command wait for the results (otherwise it returns only a test run Id; fetch it with `sf apex get test -o uat --test-run-id <id> --code-coverage --result-format json`). A failing run exits with code 100.
- **Read the JSON**: `result.summary.outcome` (`Passed`/`Failed`), `passing`, `failing`; each `result.tests[]` entry whose `Outcome` isn't `Pass`, with its `Message` and `StackTrace`; `result.coverage.coverage[]` `coveredPercent` per class. `jq` lines are in `references/test-plan.md`.
- Before handing over, run `--test-level RunLocalTests` once to catch what the change broke elsewhere.
- If you can't run commands, give the exact command and say what to read in the output. Don't report a result you didn't see.

## 6. Verify a change in the sandbox (UAT)

"It's deployed to uat, verify it" gets a **verification runbook**: numbered steps, each with the exact command for the sandbox alias and its expected result. Run it if you have a shell. If you don't, the runbook **is** the answer: give it in full, with real names filled in, never placeholders like `<story id>` alone.

**The answer's first line is the runbook heading** (for example "## Verifying T-099 in uat"), then the runbook. Say what hasn't run **once, in the closing line**, not in an opening paragraph: "Next: run steps 1–6 against uat and paste the output. I'll fill in Actual and Result, and I won't call the change verified until then." With a shell, run the steps yourself and fill in the report.

1. **Find the change**: the story, `git log` / `git diff`, the changed files under `force-app`. If nothing names it, verify the most likely change from the project (for example a new field or flow) and say so.
2. **Confirm it's there**, metadata only: `sf sobject describe -o uat -s Opportunity` (the new field), Tooling API SOQL for the class, `FlowDefinitionView` for the active flow version. Don't read real records to check a field.
3. **Run the Apex tests** for the changed classes. If you wrote a new test class, deploy only that class to the sandbox (`sf project deploy start -o uat -m ApexClass:OpportunityServiceTest`), never the whole `force-app` folder over the builder's work. If a class with that name may already exist there (`TestDataFactory` often does), retrieve it and add to it instead of replacing it. Then: `sf apex run test -o uat --class-names <TestClass> --code-coverage --result-format json --wait 10 > test-result.json`, then read the JSON (section 5).
4. **Check each criterion with marked test records and SOQL**: `sf data create record -o uat -s Account -v "Name='ZZ_TEST T-099 Gold' Tier__c=Gold"`, then the record under test on that Account, then `sf data query -o uat -q "SELECT Id, Subject, Priority FROM Case WHERE Subject LIKE 'ZZ_TEST T-099%'"`. Compare with the expected value. Create your own parent records. Never touch real customer records.
5. **Clean up**: `sf data delete record -o uat -s Case -i <id>` for every record you created (children first), then `sf data query -o uat -q "SELECT COUNT() FROM Account WHERE Name LIKE 'ZZ_TEST T-099%'"` returns 0.
6. **Report** a table: criterion, command, expected, actual, pass or fail. Leave "actual" empty for anything not run, and don't call the change verified until it's filled in.

Never use production, production data or real customer records. Full runbook and report template: `references/test-plan.md`.

## 7. Callout tests

- `Test.setMock(HttpCalloutMock.class, new Mock(...))` with a mock class that returns a status and body, and asserts the request (method `POST`, endpoint `callout:<NamedCredential>/...`).
- **At least two tests: success (200/201) and failure (500)**, each asserting what the code does with the response (return value, thrown exception, stored error, record status). Add a 4xx test if the code treats it differently.
- DML in `@TestSetup` or before `Test.startTest()`, then `setMock`, then the call (DML then callout in one transaction fails otherwise).
- **Class not in the project?** Retrieve it from the sandbox (`sf project retrieve start -m ApexClass:ErpService -o uat`). If you can't, write the test against an assumed signature, list the assumptions at the top, and say what to adjust. Don't stop at a question.

Example: `references/apex-tests.md`. Async callouts and chaining: sf-apex `references/testing.md`.

## Before you answer, check

| Check | Fix |
|---|---|
| An acceptance criterion with no test, or a test with no assert | Add it, asserting the field value |
| "Already set" test seeds the value the automation writes | Seed a different value |
| No 200-record test | Add one DML of 200 |
| runAs user whose missing access is only assumed | Build the permission set in the test, assert the precondition |
| Setup-object DML outside `System.runAs` | Wrap it, or `MIXED_DML_OPERATION` |
| Helper methods instead of a factory or `@TestSetup` | Move data to `TestDataFactory` / `@TestSetup` |
| More than one `startTest` in a method | Split the method, or move setup before `startTest` |
| Assertion-free coverage tests, or 75% treated as the goal | Refuse, then write behaviour tests |
| `sf` command without `-o <sandbox alias>`, or without `--result-format json` when reading results | Add them |
| Test records without a `ZZ_TEST` name or cleanup, or a check that reads real records | Name, delete, re-query; check fields with `sf sobject describe` |
| Coverage answer that doesn't open with the refusal and "75% is a floor" | Add the two sentences from section 4 |
| Answer opens with what the session couldn't do | Move it to one closing line |
| Callout test without a failure response | Add a 500 test |
| Stopped with questions, or no code because files can't be written | Write it in the answer with stated assumptions |
| Mentions deploying or validating to production | Remove it. A person deploys with change sets. |
