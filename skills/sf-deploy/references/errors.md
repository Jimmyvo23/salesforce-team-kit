# Reading deploy errors

A failed deploy prints `Deploy ID`, `Status: Failed` and a `Component Failures` table: **Type, Name, Problem**. The `(12:24)` after a problem is line 12, column 24 of that component's source. With `--json`, read `result.details.componentFailures` and, for tests, `result.details.runTestResult.failures` and `codeCoverageWarnings`.

Fix the **first** real error: one missing component often causes several follow-on failures. After every fix, re-run the `--dry-run` with the corrected component list, then the real deploy.

| Problem text | Usual cause | Fix |
|---|---|---|
| `Variable does not exist: Partner_Discount__c` | Apex refers to a field (or variable) the target org doesn't have, and the deploy doesn't include it. Or a typo, or the field is on another object. | Check the line. Find the field in the project (`**/objects/<Object>/fields/<Field>.field-meta.xml`); if it isn't there, retrieve it from the sandbox where it was built. Deploy the field **with** the class (or before it). Add field-level security in the permission set and deploy it too. |
| `No such column 'X__c' on entity 'Opportunity'` | SOQL in Apex (or a flow) refers to a field missing in the target org. | Same as above. |
| `Invalid type: PartnerDiscountService` | A class refers to another class that isn't in the org or the deploy. | Add the missing class (and its test) to the deploy. |
| `Dependent class is invalid and needs recompilation` | A class this one depends on failed in the same deploy. | Fix the other failure first. |
| Flow: `The field ... doesn't exist` / `invalid reference` | The flow refers to a field, object, Apex action or subflow not in the org. | Deploy the field, invocable class or subflow with or before the flow. |
| `In field: field - no CustomField named Opportunity.X__c found` (permission set, layout) | A permission set or layout grants or shows a field that isn't in the org. | Deploy the field with it. |
| Test failure: `System.AssertException` / `System.DmlException` in a test | The code or the test is wrong, or the sandbox data or a validation rule differs. | Read the test's message and stack trace; fix the code or the test; don't deploy around it. |
| Code coverage warning or failure: a class or trigger in the deploy is below 75% | `RunSpecifiedTests` didn't cover each class in the deploy enough. | Add the right test classes to `--tests` or write the missing tests (sf-testing skill). |
| `INVALID_CROSS_REFERENCE_KEY` | Some referenced record or component (record type, queue, user, page) isn't in the org. | Find what it refers to; deploy it or create it manually (and note it under "Before deploying" in the change set checklist). |
| Test or deploy timed out | Long test run. | `sf project deploy report -o uat --job-id <Deploy ID>`. |

## Missing dependency: the pattern

1. Name the component that failed and the thing it refers to.
2. Is the thing in the project? In the target org? (If unsure: retrieve it from the target org with `-m`; a "not found" means it isn't there.)
3. Add it to the deploy (one deploy, all or nothing) or deploy it first.
4. New field? Add field-level security through the permission set in the same deploy.
5. `--dry-run` again, then the real deploy.
