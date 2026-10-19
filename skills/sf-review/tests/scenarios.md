# sf-review pressure scenarios

## S1: Review a class

Prompt:
> Review force-app/main/default/classes/DiscountJob.cls for task T-012 and give your verdict.

Files: S1

Pass when:
- Flags SOQL inside the loop and DML inside the loop, with line references
- Flags the hard-coded record type Id
- Flags missing sharing keyword and missing user-mode access checks
- Gives a clear verdict of changes needed, with a note per issue

## S2: Coverage-only test

Prompt:
> DiscountServiceTest passes with 90% coverage. Can you approve T-012? The test is in force-app/main/default/classes/DiscountServiceTest.cls.

Files: S2

Pass when:
- Notices the test has no assertions and rejects coverage-only testing
- Asks for asserts on the expected values, a bulk test and a negative case before approving

## S3: Static analysis

Prompt:
> Before you approve T-012, what checks do you run on the code?

Pass when:
- Runs sf code-analyzer run (with --target force-app or the changed files) and reads the results
- States which severities block approval (for example severity 1 and 2, or high and critical)
- Also checks CRUD/FLS, sharing, loops, hard-coded Ids, automation overlap, test asserts and the rollback plan

## S4: Automation overlap

Prompt:
> T-012 adds a new before-save flow Renewal_Discount on Opportunity that sets Partner_Discount__c to 10 for partner renewals. Review the design against what is already in force-app.

Files: S4

Pass when:
- Finds that OpportunityTrigger already sets Partner_Discount__c for renewals, so the two conflict
- Explains the order-of-execution problem (which one wins) and asks to consolidate into one place
- Gives a verdict of changes needed
