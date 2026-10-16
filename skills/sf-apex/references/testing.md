# Apex testing

## Rules

- Tests create their own data. Never use `@IsTest(SeeAllData=true)`. Custom settings data isn't visible to tests, so create it in `@TestSetup`.
- Assert with the `System.Assert` class (`Assert.areEqual`, `Assert.areNotEqual`, `Assert.isTrue`, `Assert.isFalse`, `Assert.isNull`, `Assert.isNotNull`, `Assert.isInstanceOfType`, `Assert.fail`). Always pass a message. If the org has its own class named `Assert`, write `System.Assert.areEqual`.
- Assert **outcomes**: field values, record counts, the stored error, the thrown exception. Coverage alone is not a test.
- Every trigger or batch path gets a **200-record** test, plus a negative case ("condition not met", for example a non-Email change) and an idempotency case ("already set").
- `Test.startTest()` gives the code under test fresh limits. `Test.stopTest()` runs async work that was queued after `startTest` (Queueable, Batch, future) synchronously, so assert after `stopTest`.
- **Call `startTest` and `stopTest` once each per test method** (the Apex Developer Guide allows each only once per method). If a test has two phases (for example, "insert, then update"), put the first phase before `startTest` or in `@TestSetup`, or write two test methods.
- **Setup objects** (User, PermissionSetAssignment, UserRole, Group and others) can't be inserted in the same transaction as ordinary records such as Account. Doing so throws `MIXED_DML_OPERATION`. In tests, wrap the setup-object DML in `System.runAs(new User(Id = UserInfo.getUserId())) { … }`, or create the users in `@TestSetup`.

## Test data factory

```apex
@IsTest
public class TestDataFactory {
    public static List<Account> accounts(Integer n, Boolean doInsert) {
        List<Account> rows = new List<Account>();
        for (Integer i = 0; i < n; i++) {
            rows.add(new Account(Name = 'Test Account ' + i));
        }
        if (doInsert) { insert rows; }
        return rows;
    }
    public static List<Contact> contacts(List<Account> parents, Integer perAccount, Boolean doInsert) {
        List<Contact> rows = new List<Contact>();
        for (Account a : parents) {
            for (Integer i = 0; i < perAccount; i++) {
                rows.add(new Contact(LastName = 'Test ' + i, AccountId = a.Id,
                                     Email = 'c' + i + '.' + a.Id + '@example.com'));
            }
        }
        if (doInsert) { insert rows; }
        return rows;
    }
    // User and PermissionSetAssignment are setup objects. Inserting them in the same transaction
    // as Accounts or Contacts throws MIXED_DML_OPERATION, so the inserts run inside System.runAs
    // as the current user, which test methods allow for mixed DML.
    public static User userWithPermissionSet(String permSetName) {
        Profile p = [SELECT Id FROM Profile WHERE Name = 'Minimum Access - Salesforce' LIMIT 1];
        String unique = String.valueOf(Crypto.getRandomInteger()).remove('-');
        User u = new User(Alias = 'tuser', Email = 'tuser' + unique + '@example.com',
            EmailEncodingKey = 'UTF-8', LastName = 'Tester', LanguageLocaleKey = 'en_US',
            LocaleSidKey = 'en_US', ProfileId = p.Id, TimeZoneSidKey = 'America/Los_Angeles',
            UserName = 'tuser' + unique + '@example.com.test');
        PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = :permSetName LIMIT 1];
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert u;
            insert new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = ps.Id);
        }
        return u;
    }
}
```

Required fields and validation rules differ per org. Put every record default in the factory, so one change fixes all tests.

## Trigger test (200 records, Assert class)

```apex
@IsTest
private class ContactTriggerHandlerTest {
    @TestSetup
    static void setup() {
        TestDataFactory.accounts(50, true);
    }

    @IsTest
    static void insertOf200ContactsSetsDateOnEveryAccount() {
        List<Account> accts = [SELECT Id FROM Account];
        List<Contact> contacts = TestDataFactory.contacts(accts, 4, false);   // 200 contacts

        Test.startTest();
        insert contacts;
        Test.stopTest();

        for (Account a : [SELECT Last_Contact_Date__c FROM Account]) {
            Assert.areEqual(Date.today(), a.Last_Contact_Date__c, 'Every Account gets today');
        }
    }

    @IsTest
    static void emailChangeOn200ContactsSetsDate() {
        List<Contact> contacts = TestDataFactory.contacts([SELECT Id FROM Account], 4, true);
        List<Account> reset = [SELECT Id FROM Account];
        for (Account a : reset) { a.Last_Contact_Date__c = null; }
        update reset;
        for (Contact c : contacts) { c.Email = 'new.' + c.Email; }

        Test.startTest();
        update contacts;
        Test.stopTest();

        Assert.areEqual(50, [SELECT COUNT() FROM Account WHERE Last_Contact_Date__c = TODAY],
            'All 50 Accounts updated');
    }

    @IsTest
    static void nonEmailChangeLeavesDateAlone() {
        List<Contact> contacts = TestDataFactory.contacts([SELECT Id FROM Account], 1, true);
        List<Account> reset = [SELECT Id FROM Account];
        for (Account a : reset) { a.Last_Contact_Date__c = null; }
        update reset;
        for (Contact c : contacts) { c.FirstName = 'Changed'; }

        Test.startTest();
        update contacts;
        Test.stopTest();

        Assert.areEqual(0, [SELECT COUNT() FROM Account WHERE Last_Contact_Date__c != null],
            'A non-Email change must not set the date');
    }
}
```

## Testing user mode with System.runAs

Tests run as the admin who runs them, so user-mode checks pass trivially. To prove the access checks, run the code as a user with only the intended permission set:

```apex
User u = TestDataFactory.userWithPermissionSet('Case_Viewer');
System.runAs(u) {
    Test.startTest();
    List<Case> rows = CaseListController.getOpenCases(acct.Id);
    Test.stopTest();
    Assert.areEqual(0, rows.size(), 'User without access to these Cases sees none');
}
```

`System.runAs` enforces record sharing. User-mode queries and DML also enforce that user's object and field permissions.

## Callout test (HttpCalloutMock, success and failure)

```apex
@IsTest
private class OrderErpSyncJobTest {
    private class ErpMock implements HttpCalloutMock {
        private final Integer status;
        ErpMock(Integer status) { this.status = status; }
        public HttpResponse respond(HttpRequest req) {
            Assert.areEqual('POST', req.getMethod(), 'POST');
            Assert.isTrue(req.getEndpoint().startsWith('callout:ERP'), 'Uses the Named Credential');
            HttpResponse res = new HttpResponse();
            res.setStatusCode(status);
            res.setBody(status == 200 ? '{"id":"ERP-1"}' : '{"error":"down"}');
            return res;
        }
    }

    @IsTest
    static void failureResponseIsStoredOnTheOrder() {
        Set<Id> ids = TestOrders.create(10);              // DML before startTest
        Test.startTest();
        Test.setMock(HttpCalloutMock.class, new ErpMock(500));
        System.enqueueJob(new OrderErpSyncJob(ids));
        Test.stopTest();                                  // the job runs here

        for (Order o : [SELECT ERP_Sync_Status__c, ERP_Last_Error__c FROM Order WHERE Id IN :ids]) {
            Assert.areEqual('Failed', o.ERP_Sync_Status__c, 'Marked as failed');
            Assert.isTrue(o.ERP_Last_Error__c.startsWith('500'), 'Stores the status code');
        }
    }
    // A second test with new ErpMock(200) asserts 'Sent'.
}
```

- Callouts aren't allowed after uncommitted DML in the same transaction. When the test calls the callout code itself, do the DML first, then `Test.startTest()`, then `Test.setMock`, then the code that makes the callout.
- When a trigger enqueues the job, do the insert or update between `Test.startTest()` and `Test.stopTest()`, after `Test.setMock`. The callout then runs in the async job when `stopTest()` is reached, not in the same transaction after the DML. So DML inside the block is right there, and the job is collected and run at `stopTest()`.
- Keep the test volume below the job's per-job chunk size, so the test runs exactly one job. Test the chunk split separately (for example, call `execute` logic with more Ids and assert the remainder).
- Don't write a test whose result depends on a chained job, and don't state what happens to a chained job inside a test (that it never runs, or that chaining is impossible). The Apex Developer Guide only says chained jobs can be tested with an appropriate stack depth (`AsyncOptions.MaximumQueueableStackDepth`). For more records than one chunk, put a `@TestVisible static Boolean chainRemaining = true;` switch on the job, set it to false in that test, and assert the first chunk only. The reason to give is "keeps the test to one job".
- `StaticResourceCalloutMock` works when the response body is large.

## Batch and schedule tests

```apex
@IsTest
static void batchRecalculatesScores() {
    insert TestDataFactory.accounts(200, false);       // one execute() in a test
    Test.startTest();
    Database.executeBatch(new AccountScoreBatch(), 200);
    Test.stopTest();
    Assert.areEqual(200, [SELECT COUNT() FROM Account WHERE Score__c != null], 'All scored');
}

@IsTest
static void scheduleRegistersTheJob() {
    Test.startTest();
    String jobId = System.schedule('Score test', '0 0 2 * * ?', new AccountScoreSchedule());
    Test.stopTest();
    CronTrigger ct = [SELECT CronExpression FROM CronTrigger WHERE Id = :jobId];
    Assert.areEqual('0 0 2 * * ?', ct.CronExpression, 'Scheduled for 02:00');
}
```

A test can run only one `execute`. Test the calculation class directly for the edge cases (nulls, boundaries).
