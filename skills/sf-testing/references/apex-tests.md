# Apex test patterns

The general rules (test data factory, `Assert` class, one `startTest`/`stopTest` pair, mixed DML, callout mocks, batch tests) are in the **sf-apex** skill, `references/testing.md`. This file adds what a story-driven test class needs: testing flow or trigger logic from Apex, a restricted user built inside the test, the "already set" case, and a callout test for code you can't see.

The example story here: *"When a Case is created for an Account with `Tier__c` = Gold, set `Priority` to High. Other tiers keep the Priority the user chose. An existing Priority is not changed when the Case is edited. A user without edit access to Priority still gets High."* Swap in your story's objects and fields.

## Factory

```apex
@IsTest
public class TestDataFactory {
    public static Account account(String name, String tier, Id ownerId) {
        Account a = new Account(Name = name, Tier__c = tier);
        if (ownerId != null) { a.OwnerId = ownerId; }
        return a;                                  // caller inserts, so tests choose when DML happens
    }
    public static List<Case> cases(Id accountId, Integer n) {
        List<Case> rows = new List<Case>();
        for (Integer i = 0; i < n; i++) {
            rows.add(new Case(Subject = 'Test case ' + i, AccountId = accountId, Origin = 'Web'));
        }
        return rows;
    }
}
```

Every required field and validation-rule value goes in the factory, so one change fixes every test.

## Test class: one method per acceptance criterion, plus bulk and restricted user

```apex
@IsTest
private class GoldCasePriorityTest {
    @TestSetup
    static void setup() {
        insert new List<Account>{
            TestDataFactory.account('Gold Co', 'Gold', null),
            TestDataFactory.account('Silver Co', 'Silver', null)
        };
    }

    static Id accountId(String name) {
        return [SELECT Id FROM Account WHERE Name = :name LIMIT 1].Id;
    }

    // AC1 (positive): Gold Account -> High
    @IsTest
    static void goldAccountCaseGetsHighPriority() {
        Case c = TestDataFactory.cases(accountId('Gold Co'), 1)[0];
        c.Priority = 'Low';
        Test.startTest();
        insert c;                                   // fires the record-triggered flow or trigger
        Test.stopTest();
        Assert.areEqual('High', [SELECT Priority FROM Case WHERE Id = :c.Id].Priority,
            'Gold Account cases get High');
    }

    // AC2 (negative): other tiers keep the user's value
    @IsTest
    static void silverAccountCaseKeepsChosenPriority() {
        Case c = TestDataFactory.cases(accountId('Silver Co'), 1)[0];
        c.Priority = 'Low';
        Test.startTest();
        insert c;
        Test.stopTest();
        Assert.areEqual('Low', [SELECT Priority FROM Case WHERE Id = :c.Id].Priority,
            'Non-Gold cases keep the chosen Priority');
    }

    // AC3 (already set): seed a value that differs from what the automation would write,
    // so a reset would be visible. Seed DML happens before startTest.
    @IsTest
    static void existingPriorityIsNotChangedOnEdit() {
        Case c = TestDataFactory.cases(accountId('Silver Co'), 1)[0];
        c.Priority = 'Medium';
        insert c;
        Case moved = new Case(Id = c.Id, AccountId = accountId('Gold Co'), Subject = 'Edited');
        Test.startTest();
        update moved;                               // the edit that could re-trigger the logic
        Test.stopTest();
        Assert.areEqual('Medium', [SELECT Priority FROM Case WHERE Id = :c.Id].Priority,
            'An existing Priority survives edits');
    }

    // Edge case: 200 records in one DML (one flow/trigger batch)
    @IsTest
    static void bulkInsertOf200GoldCasesAllGetHigh() {
        List<Case> rows = TestDataFactory.cases(accountId('Gold Co'), 200);
        Test.startTest();
        insert rows;
        Test.stopTest();
        Assert.areEqual(200, [SELECT COUNT() FROM Case WHERE Priority = 'High'],
            'All 200 Gold cases get High');
    }

    // Edge case: a user without edit access to the field
    @IsTest
    static void userWithoutPriorityEditStillGetsHigh() {
        User u = RestrictedUser.create('Case', new List<String>{ 'Subject', 'Origin', 'AccountId' },
                                       new List<String>{ 'Priority' });
        // The user must be able to see the parent: make them its owner (non-setup DML, outside runAs).
        Account gold = TestDataFactory.account('Gold Owned', 'Gold', u.Id);
        insert gold;
        Case c = TestDataFactory.cases(gold.Id, 1)[0];

        System.runAs(u) {
            Assert.isFalse(Schema.SObjectType.Case.fields.Priority.isUpdateable(),
                'Precondition: the user cannot edit Priority');
            Test.startTest();
            insert as user c;                       // as user: checks this user's CRUD/FLS at any API version
            Test.stopTest();
        }
        // Assert outside runAs, as the test's running user, so the assert can read the field.
        Assert.areEqual('High', [SELECT Priority FROM Case WHERE Id = :c.Id].Priority,
            'Automation in system context sets the field the user cannot edit');
    }
}
```

Expected results for the restricted user depend on how the logic runs:
- **Record-triggered flow** (system context without sharing, see the sf-flow skill): the record saves and the field **is** set.
- **Apex with a user-mode DML statement** that writes the field (`update as user`, or plain DML at API 67.0+): the save **fails** for this user. A before-save trigger that only assigns the field on `Trigger.new` does no DML of its own, so no FLS check happens and the value is set. Assert the `DmlException` with `Assert.fail('Expected DmlException')` in a try/catch, or change the code, and say which one the story wants.
- If the story doesn't say, state your assumption in the answer and in a comment on the test.

## Restricted user built inside the test

Setup objects (User, PermissionSet, ObjectPermissions, FieldPermissions, PermissionSetAssignment) can't share a transaction with ordinary records (`MIXED_DML_OPERATION`), so their DML runs inside `System.runAs` as the current user. Classes using them can't be `@IsTest(IsParallel=true)`.

```apex
@IsTest
public class RestrictedUser {
    /** A Minimum Access user with Read/Create on the object, Edit on editFields, Read-only on readOnlyFields. */
    public static User create(String sobjectName, List<String> editFields, List<String> readOnlyFields) {
        Profile p = [SELECT Id FROM Profile WHERE Name = 'Minimum Access - Salesforce' LIMIT 1];
        String unique = String.valueOf(Crypto.getRandomLong()).remove('-');   // usernames are unique across all orgs
        User u = new User(Alias = 'rtest', LastName = 'Restricted', Email = 'rtest' + unique + '@example.com',
            Username = 'rtest' + unique + '@example.com.test', ProfileId = p.Id,
            EmailEncodingKey = 'UTF-8', LanguageLocaleKey = 'en_US', LocaleSidKey = 'en_US',
            TimeZoneSidKey = 'America/Los_Angeles');
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert u;
            PermissionSet ps = new PermissionSet(Name = 'Test_Restricted_' + unique.left(10), Label = 'Test restricted');
            insert ps;
            List<SObject> perms = new List<SObject>{
                new ObjectPermissions(ParentId = ps.Id, SobjectType = sobjectName,
                    PermissionsRead = true, PermissionsCreate = true, PermissionsEdit = true),
                new ObjectPermissions(ParentId = ps.Id, SobjectType = 'Account', PermissionsRead = true)
            };
            Map<String, Schema.SObjectField> fieldMap =
                Schema.getGlobalDescribe().get(sobjectName).getDescribe().fields.getMap();
            for (String f : editFields) {
                if (!fieldMap.get(f).getDescribe().isPermissionable()) { continue; }   // e.g. OwnerId, master-detail
                perms.add(new FieldPermissions(ParentId = ps.Id, SobjectType = sobjectName,
                    Field = sobjectName + '.' + f, PermissionsRead = true, PermissionsEdit = true));
            }
            for (String f : readOnlyFields) {
                perms.add(new FieldPermissions(ParentId = ps.Id, SobjectType = sobjectName,
                    Field = sobjectName + '.' + f, PermissionsRead = true, PermissionsEdit = false));
            }
            insert perms;
            insert new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = ps.Id);
        }
        return u;
    }
}
```

- Grant **Edit** on every field the test sets inside `runAs` (`insert as user` checks them), and **Read** on every field the code under test filters or sorts on: at API 67.0+ database operations default to user mode, which checks `WHERE` and `ORDER BY` fields too.
- Grant the object access the platform requires (for example, Opportunity and Contact permissions need Read on Account). Some fields have no field permissions (for example `OwnerId`, master-detail and universally required fields): inserting one fails. Check `isPermissionable()` (the helper does).
- If the team already has the real permission set in the project, assign it instead (`[SELECT Id FROM PermissionSet WHERE Name = '...']`) and assert the precondition the same way.
- Parent records: the restricted user needs record access to the parent it references. Make the user the owner, or create the parent inside `runAs`.

## Coverage push: tests that assert

When a class is below the target, list its uncovered lines (from the JSON coverage `lines` map, value `0`) and write one test per behaviour those lines implement, each with asserts on outcomes:

```apex
@IsTest
static void openForAccountsReturnsOnlyOpenOpportunitiesOfThoseAccounts() {
    // @TestSetup (factory): 'Target' Account with 2 open and 1 closed Opp; 'Other' Account with 1 open Opp
    Account target = [SELECT Id FROM Account WHERE Name = 'Target' LIMIT 1];
    Test.startTest();
    List<Opportunity> result = OpportunityService.openForAccounts(new Set<Id>{ target.Id });
    Test.stopTest();
    Assert.areEqual(2, result.size(), 'Only the 2 open Opps of the target Account');
    for (Opportunity o : result) { Assert.areNotEqual('Closed Won', o.StageName, 'No closed Opps'); }
}
@IsTest
static void openForAccountsWithNoIdsReturnsEmpty() {
    Assert.isTrue(OpportunityService.openForAccounts(new Set<Id>()).isEmpty(), 'Empty input, empty result');
}
```

Never: a test that only calls methods, `Assert.isTrue(true)`, a try/catch that swallows every exception, or `SeeAllData=true` to reach org data.

## Callout test for a class you can't see

If the class isn't in the project, retrieve it from the sandbox first (`sf project retrieve start -m ApexClass:ErpService -o <sandbox alias>`). If you can't, write the test against a stated assumed signature, and list the assumptions at the top of the answer:

```apex
@IsTest
private class ErpServiceTest {
    // ASSUMES: ErpService.sendOrder(Id orderId) POSTs JSON to callout:ERP/orders,
    // returns the ERP id on 2xx and throws ErpService.ErpException on other statuses.
    private class ErpMock implements HttpCalloutMock {
        private final Integer status; private final String body;
        ErpMock(Integer status, String body) { this.status = status; this.body = body; }
        public HttpResponse respond(HttpRequest req) {
            Assert.areEqual('POST', req.getMethod(), 'Uses POST');
            Assert.isTrue(req.getEndpoint().startsWith('callout:ERP'), 'Uses the Named Credential');
            HttpResponse res = new HttpResponse();
            res.setStatusCode(status); res.setBody(body);
            return res;
        }
    }
    @TestSetup static void setup() { /* factory: the record the service sends */ }

    @IsTest static void successReturnsErpId() {
        Id recordId = [SELECT Id FROM Order LIMIT 1].Id;     // DML stays in @TestSetup or before startTest
        Test.startTest();
        Test.setMock(HttpCalloutMock.class, new ErpMock(201, '{"id":"ERP-42"}'));
        String erpId = ErpService.sendOrder(recordId);
        Test.stopTest();
        Assert.areEqual('ERP-42', erpId, 'Returns the id from the response');
    }

    @IsTest static void serverErrorThrows() {
        Id recordId = [SELECT Id FROM Order LIMIT 1].Id;
        Test.startTest();
        Test.setMock(HttpCalloutMock.class, new ErpMock(500, '{"error":"down"}'));
        try {
            ErpService.sendOrder(recordId);
            Assert.fail('Expected ErpService.ErpException for a 500');
        } catch (ErpService.ErpException e) {
            Assert.isTrue(e.getMessage().contains('500'), 'The error names the status');
        }
        Test.stopTest();
    }
}
```

Assert what the class really does on failure (throws, returns null, stores the error on the record). Also cover a 4xx if the class treats it differently. When a trigger or Queueable makes the callout, follow the DML and `setMock` order in sf-apex `references/testing.md`.
