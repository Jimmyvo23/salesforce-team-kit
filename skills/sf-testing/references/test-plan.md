# Test plans, test runs and UAT checks

## Test plan from a story

One row per acceptance criterion, then one row per edge case. Every row names the assert.

| # | Source | Test method | Given (setup, before `startTest`) | When (inside `startTest`/`stopTest`) | Then (assert) |
|---|---|---|---|---|---|
| 1 | AC1 positive | `goldAccountCaseGetsHighPriority` | Gold Account (`@TestSetup`) | insert 1 Case | `Priority` = High |
| 2 | AC2 negative | `silverAccountCaseKeepsChosenPriority` | Silver Account | insert 1 Case with Low | `Priority` = Low |
| 3 | AC3 already set | `existingPriorityIsNotChangedOnEdit` | Case with Medium (differs from High) | update another field | `Priority` = Medium |
| 4 | Edge: bulk | `bulkInsertOf200GoldCasesAllGetHigh` | 200 Cases from the factory | one insert of 200 | COUNT High = 200 |
| 5 | Edge: restricted user | `userWithoutPriorityEditStillGetsHigh` | Minimum Access user + permission set with Read-only on the field | `System.runAs`, `insert as user` | `Priority` = High (flow) or the expected error |

Also add, when the logic has them: a boundary (exactly at a threshold), a null parent, a mix of matching and non-matching records in one 200-record insert, and a record that changes **into** the condition on update.

State every assumption the story leaves open (run context, what a blocked user should see, whether update also counts) in the answer and as a comment on the test.

## Running tests in the sandbox

Always pass the sandbox alias (`.team/team.json` `orgs.sandbox`, for example `uat`) with `-o`. Never rely on the CLI's default target org, and never run against production.

```sh
# The classes the change touched, with coverage, as JSON, waiting up to 10 minutes
sf apex run test -o uat --class-names GoldCasePriorityTest --class-names OpportunityServiceTest \
  --code-coverage --result-format json --wait 10 > test-result.json

# Before handing over: every local test, to catch what the change broke elsewhere
sf apex run test -o uat --test-level RunLocalTests --code-coverage --result-format json --wait 30 > test-result-local.json

# If the wait ran out, the output has a test run Id instead of results
sf apex get test -o uat --test-run-id <id> --code-coverage --result-format json > test-result.json
```

- The command exits with code **100** when a test fails.
- Without `--wait`, the command only returns a test run Id.
- The user running it needs the **View All Data** permission.
- `sf logic run test` (beta) runs Apex tests and Flow tests together. Check `sf logic run test --help` for its flags.

## Reading the JSON

The output is `{ "status": <exit code>, "result": { "summary", "tests", "coverage" } }`:

| Field | Read it for |
|---|---|
| `result.summary.outcome` | `Passed` or `Failed` |
| `result.summary.testsRan`, `passing`, `failing`, `skipped` | Counts |
| `result.tests[]` where `Outcome` is not `Pass` | `FullName`, `Message`, `StackTrace` of each failure (`Fail`, `CompileFail`, `Skip`) |
| `result.coverage.coverage[]` | Per class or trigger: `name`, `coveredPercent`, `totalLines`, `totalCovered`, and `lines` (line number → `1` covered, `0` not covered) |
| `result.summary.testRunCoverage` | Coverage of the classes this run touched |
| `result.summary.orgWideCoverage` | Coverage of all Apex in the org (only with `--code-coverage`) |

```sh
jq '.result.summary | {outcome, testsRan, passing, failing, testRunCoverage, orgWideCoverage}' test-result.json
jq '.result.tests[] | select(.Outcome != "Pass") | {FullName, Outcome, Message, StackTrace}' test-result.json
jq '.result.coverage.coverage[] | select(.name == "OpportunityService") | {coveredPercent, uncovered: [.lines | to_entries[] | select(.value == 0) | .key]}' test-result.json
```

Coverage by Tooling API SOQL (read-only), after a test run:

```sh
sf data query -o uat --use-tooling-api -q "SELECT ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate WHERE ApexClassOrTrigger.Name = 'OpportunityService'"
```

Report in the answer: outcome, counts, every failure with its message, and the coverage of each class the change touched.

## UAT checks with SOQL

1. **Find what changed.** Read the story or ticket, `git log` / `git diff` for the branch, and the changed files under `force-app`. List the components and the acceptance criteria to check. If nothing names the change, say what you looked at and ask for the story while you run the checks below for the latest changes.
2. **Confirm the components are in the sandbox** (read-only):

```sh
sf data query -o uat --use-tooling-api -q "SELECT Name, ApiVersion, LastModifiedDate FROM ApexClass WHERE Name IN ('OpportunityService')"
sf data query -o uat -q "SELECT ApiName, IsActive, ActiveVersionId, LatestVersionId, LastModifiedBy FROM FlowDefinitionView WHERE ApiName = 'Case_Gold_Priority'"
sf sobject describe -o uat -s Account --json | jq '.result.fields[] | select(.name == "Tier__c") | {name, type, updateable}'   # metadata only, no records read
```

   `ActiveVersionId` equal to `LatestVersionId` means the newest flow version is active.
3. **Run the Apex tests** (above) and read the JSON.
4. **Smoke-test each acceptance criterion with marked test records**, then check them with SOQL:

```sh
# Test data only: a test Account named for the story, never a real customer record
sf data create record -o uat -s Account -v "Name='ZZ_TEST T-099 Gold' Tier__c=Gold" --json
sf data create record -o uat -s Case -v "Subject='ZZ_TEST T-099 AC1' AccountId=<test account id> Priority=Low" --json
sf data query -o uat -q "SELECT Id, Subject, Priority FROM Case WHERE Subject LIKE 'ZZ_TEST T-099%'"
```

5. **Clean up** the records you created, then confirm none remain:

```sh
sf data delete record -o uat -s Case -i <case id>
sf data delete record -o uat -s Account -i <account id>
sf data query -o uat -q "SELECT COUNT() FROM Account WHERE Name LIKE 'ZZ_TEST T-099%'"
```

Rules:
- Name every record you create with a `ZZ_TEST <story id>` prefix, keep their Ids, and delete them at the end. Create your own test parent records. Never edit or attach to real customer records, and never copy production data into the sandbox for a test.
- SOQL checks are read-only. Use `LIMIT` and filter by the test prefix.
- Never run a command against production. A person deploys to production with change sets.

## UAT report

| AC | Check | Command | Expected | Actual | Result |
|---|---|---|---|---|---|
| 1 | Gold Case gets High | `sf data query -o uat -q "SELECT Priority FROM Case WHERE Subject = 'ZZ_TEST T-099 AC1'"` | High | | |
| — | Apex tests | `sf apex run test -o uat ... --result-format json` | `outcome` Passed | | |
| — | Cleanup | `SELECT COUNT() ... LIKE 'ZZ_TEST T-099%'` | 0 | | |

If you can't run commands (no shell or no org access), give this table with the exact commands, say that nothing is verified yet, and ask the user to run them and paste the output. Don't report the change as working until the results are in.
