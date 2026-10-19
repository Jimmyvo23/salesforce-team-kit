# Review checklist: how to check each item

Run every item on every changed file. Each failure is a **Blocking** note (except where an item says Should fix) with `file:line`. The fix detail lives in the sibling skill named in the last column of the SKILL.md table; this file only says how to find the problem.

First read `sfdx-project.json` `sourceApiVersion` and each class's `-meta.xml` `apiVersion`. At API 66.0 and earlier, Apex database operations run in **system mode** by default (no CRUD/FLS checks), so a missing `USER_MODE` really is a hole. At 67.0 and later the default is user mode, but the skill still asks for the explicit keyword so the meaning survives a version change (sf-apex, sf-security).

## 1. CRUD/FLS and user mode

- Grep: `\[SELECT` and `Database.query` without `WITH USER_MODE` (or `AccessLevel.USER_MODE`); `insert |update |upsert |delete ` without `as user`.
- `WITH SECURITY_ENFORCED` is not allowed at 67.0+: ask for `WITH USER_MODE`.
- `WITH SYSTEM_MODE` / `as system` is acceptable only on one statement, with a comment giving the reason.
- Flows: a record-triggered flow runs in system context; check the flow's run mode is stated in the design (sf-flow step 7).
- Code Analyzer: `ApexCRUDViolation` (PMD, Security tag).

## 2. Sharing keyword

- Grep: `^\s*(public|global|private)\s+(virtual\s+|abstract\s+)?class` lines without `with sharing`, `without sharing` or `inherited sharing`.
- Missing keyword: Blocking. The behaviour without a keyword depends on the API version and entry point (sf-security table), so it isn't obvious to the next reader.
- `without sharing` without a comment giving the reason: Blocking.
- Code Analyzer: `ApexSharingViolations`.

## 3. SOQL or DML inside a loop

- Apex: a `[SELECT`, `Database.query`, `insert`/`update`/`upsert`/`delete`, or `Database.*` DML between a `for (` and its closing brace, including in methods called from the loop.
- Flows: Get, Create, Update or Delete Records, Apex actions or subflows inside a Loop element.
- Note both the query line and the DML line separately.
- Code Analyzer: `OperationWithLimitsInLoop` (PMD, Performance).

## 4. Hard-coded values

- Grep: 15- or 18-character Id literals: `'[a-zA-Z0-9]{15}'`, `'[a-zA-Z0-9]{18}'`, prefixes such as `'012` (record type), `'005` (user), `'00G` (queue/group).
- Also URLs (`https://`), usernames, passwords, tokens: Blocking.
- Business numbers (discount rates, thresholds) that belong in Custom Metadata: **Should fix**. Comparing a picklist API value (`a.Type == 'Partner'`) is normal and not a finding.
- Fix direction: record types by DeveloperName (`Schema.SObjectType.<Object>.getRecordTypeInfosByDeveloperName()`), Custom Metadata or Custom Labels for business values, Named Credentials for endpoints.
- Code Analyzer: `AvoidHardcodingId`.

## 5. Automation overlap

- For each field the change writes: `Grep "<Field__c>" force-app` and read every hit in `triggers/`, `classes/`, `flows/`, `workflows/`.
- For each object: list every trigger and record-triggered flow on it (sf-architecture `references/automation-inventory.md`). The repo is not the org; say the org may have more.
- Two writers on one field, or a new automation beside an existing trigger handler for the same object: Blocking. Explain which one wins (SKILL.md section 4) and ask to consolidate into one place.

## 6. Flow fault paths

- Every Create, Update, Delete, Get Records, Apex action, subflow, email and callout element has a fault connector (sf-flow step 4).

## 7. Tests

- Each test method calls `Assert.*` (or `System.assert*`) on the values the story changes.
- A bulk test with 200+ records, a negative case that asserts records did **not** change, and `System.runAs` with a restricted user when access matters (sf-testing).
- Coverage percentage is reported but never decides the verdict.
- Code Analyzer: `ApexUnitTestClassShouldHaveAsserts` (when selected).

## 8. Direct API calls

- `HttpRequest`/`setEndpoint('https://...')` with a literal URL or credentials: Blocking. Endpoints go through Named Credentials (`callout:<Name>`).
- A callout reached synchronously from a trigger or a before-save context: Blocking; it must be asynchronous (Queueable with `Database.AllowsCallouts`).

## 9. Rollback plan

- The Work Order or builder handoff says how to undo the change: which flow version to reactivate, which earlier class version to redeploy to the sandbox, data to restore. Missing: Blocking.

## 10. Scope and data

- Compare the diff with the Work Order. About 25% more than planned, or new objects: say so.
- No real customer names, emails or Ids in tests or docs.
