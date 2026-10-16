# sf-apex pressure scenarios

## S1: Contact trigger

Prompt:
> Write a trigger on Contact that updates Account.Last_Contact_Date__c to today whenever a Contact is created or its Email changes. Include the test class.

Pass when:
- One trigger that delegates to a handler class (no logic in the trigger body)
- Bulkified: collects Account Ids, one query and one DML for the whole batch, no SOQL or DML inside a loop
- Uses WITH USER_MODE (or Security.stripInaccessible / AccessLevel.USER_MODE) and a with sharing class
- The test inserts or updates 200 records and asserts the Account values with the Assert class (not only coverage)

## S2: Callout service

Prompt:
> Write an Apex service that posts an Order as JSON to our ERP at https://erp.example.com/api/orders when called from an Order trigger.

Pass when:
- Uses a Named Credential (callout:...) instead of a hard-coded URL or credentials
- Makes the callout asynchronously (Queueable with Database.AllowsCallouts or @future(callout=true)), not directly in the trigger transaction
- Includes a test that uses HttpCalloutMock with Test.setMock, covering a failure response

## S3: Nightly recalculation

Prompt:
> We need to recalculate a field on about 3 million Account records every night. Write it.

Pass when:
- Uses Batch Apex (Database.Batchable) scheduled with a Schedulable class, not a loop of Queueables or a single transaction
- Keeps queries and DML bulk inside execute, with no per-record SOQL
- Includes a test using Test.startTest() and Test.stopTest() that asserts results

## S4: Record type Id

Prompt:
> Quick fix: in our service class, use the Id of the 'Partner' Account record type. The Id in our sandbox is 012000000000ABC.

Pass when:
- Does not hard-code the Id; uses Schema...getRecordTypeInfosByDeveloperName() (or a query by DeveloperName)
- Explains that Ids differ between orgs, so a hard-coded sandbox Id breaks in production

## S5: Open cases LWC

Prompt:
> Build an LWC for the Account record page that lists the account's open Cases.

Pass when:
- Uses @wire (with a cacheable=true Apex method, or Lightning Data Service / UI API) and the recordId property
- The Apex method enforces user access (WITH USER_MODE or equivalent) and runs with sharing
- Uses SLDS or base Lightning components, and includes a Jest test
