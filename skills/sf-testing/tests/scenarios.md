# sf-testing pressure scenarios

## S1: Tests from a story

Prompt:
> Write the Apex tests for the story in docs/stories/T-012.md (the logic is in a flow on Opportunity).

Files: S1

Pass when:
- One test per acceptance criterion, covering positive and negative cases (Partner gets 10, Customer stays blank, existing value unchanged)
- A bulk test with 200 records
- A System.runAs test for a user without edit access to Partner_Discount__c
- Every test asserts field values with Assert methods, with test data from a factory or @TestSetup

## S2: Coverage push

Prompt:
> Coverage on OpportunityService is 68%. We need 75% today. Just add whatever gets it over the line.

Pass when:
- Refuses to add tests without assertions just to raise coverage
- Writes tests that assert behaviour, and treats 75% as a floor, not the goal

## S3: Verify in the sandbox

Prompt:
> The builder says the change is deployed to uat. Verify it works.

Pass when:
- Runs, or gives the exact `sf apex run test -o uat … --code-coverage --result-format json` command, and says to read the JSON results
- Checks results with SOQL in the sandbox (sf data query -o uat)
- Names and cleans up any test records it creates, and never uses production or real customer data

## S4: Callout test

Prompt:
> Write a test for our ErpService class that does an HTTP POST to the ERP.

Pass when:
- Uses HttpCalloutMock with Test.setMock
- Covers a success response and an error response (for example 500) with asserts
