# Apex patterns

All examples are explicit about sharing and access mode, so they behave the same at every API version. Set `apiVersion` in each `-meta.xml` from `sfdx-project.json` `sourceApiVersion`.

## Trigger and handler (parent update from a child)

```apex
// triggers/ContactTrigger.trigger
trigger ContactTrigger on Contact (after insert, after update) {
    ContactTriggerHandler.afterSave(Trigger.new, Trigger.oldMap);
}
```

```apex
// classes/ContactTriggerHandler.cls
public with sharing class ContactTriggerHandler {
    public static void afterSave(List<Contact> contacts, Map<Id, Contact> oldMap) {
        Set<Id> accountIds = new Set<Id>();
        for (Contact c : contacts) {                       // loop only collects
            Boolean changed = oldMap == null || c.Email != oldMap.get(c.Id).Email;
            if (changed && c.AccountId != null) {
                accountIds.add(c.AccountId);
            }
        }
        if (accountIds.isEmpty()) {
            return;
        }
        Date today = Date.today();
        List<Account> toUpdate = new List<Account>();
        for (Account a : [SELECT Id, Last_Contact_Date__c FROM Account
                          WHERE Id IN :accountIds WITH USER_MODE]) {   // one query
            if (a.Last_Contact_Date__c != today) {          // skip no-op updates
                a.Last_Contact_Date__c = today;
                toUpdate.add(a);
            }
        }
        update as user toUpdate;                            // one DML
    }
}
```

Notes to give the user:
- `update as user` fails the Contact save for a user who can't edit the Account, or can't edit `Last_Contact_Date__c`. The user decides whether the date must be kept for every user.
- `as system` bypasses **object and field permissions only**. Record sharing then follows the class's keyword, so `update as system` in this `with sharing` class still fails on an Account the user can't edit. (Apex Developer Guide: "if you set the operation to system mode, the sharing keyword on the calling class determines whether the operation respects the user's record-level permissions".)
- If only field permission is the issue, `update as system toUpdate;` is enough. If the user may lack record access too, move the single query and update into a `without sharing` inner class. Inner classes don't take the outer class's sharing mode.

```apex
public with sharing class ContactTriggerHandler {
    // ... collect accountIds as above, then:
    //     new SystemMaintainedFields().stampLastContactDate(accountIds);

    // Last_Contact_Date__c is system-maintained: it must update even when the user saving the
    // Contact can't see or edit the Account. Only this query and update bypass sharing and FLS.
    private without sharing class SystemMaintainedFields {
        public void stampLastContactDate(Set<Id> accountIds) {
            Date today = Date.today();
            List<Account> toUpdate = new List<Account>();
            for (Account a : [SELECT Id, Last_Contact_Date__c FROM Account
                              WHERE Id IN :accountIds WITH SYSTEM_MODE]) {
                if (a.Last_Contact_Date__c != today) {
                    a.Last_Contact_Date__c = today;
                    toUpdate.add(a);
                }
            }
            update as system toUpdate;
        }
    }
}
```
- Updating the Account runs the Account's own triggers, flows and validation rules.
- If Contact already has a trigger, call the handler from it instead.

## Configurable values

```apex
// Custom metadata type Integration_Setting__mdt with fields Threshold__c and Enabled__c
Integration_Setting__mdt s = Integration_Setting__mdt.getInstance('Default');  // no SOQL
if (s == null || !s.Enabled__c) { return; }
Map<String, Integration_Setting__mdt> all = Integration_Setting__mdt.getAll();
```

- Custom metadata records are metadata, so they deploy with the change set. Custom settings records are data and don't.
- Don't store secrets in custom metadata or custom settings. Use Named Credentials.

## Org-specific Ids

```apex
public with sharing class AccountRecordTypes {
    public static Id partnerId() {
        Schema.RecordTypeInfo info = Schema.SObjectType.Account
            .getRecordTypeInfosByDeveloperName().get('Partner');
        if (info == null) {
            throw new IllegalArgumentException('Account record type with API name Partner not found');
        }
        return info.getRecordTypeId();
    }
}
```

- The key is the record type's **API name** (DeveloperName). `getRecordTypeInfosByName()` uses the translated label, so avoid it.
- For queues and groups: `[SELECT Id FROM Group WHERE Type = 'Queue' AND DeveloperName = 'Support_Tier_2' WITH USER_MODE LIMIT 1]`, cached in a static variable.

## Callout from a trigger (Queueable plus Named Credential)

Setup, done by the admin in the sandbox:
- a Named Credential `ERP` with URL `https://erp.example.com` and an External Credential for authentication;
- a permission set that grants the External Credential principal to the users (or the integration user) whose transactions run the job.

```apex
// Trigger handler: one enqueue per transaction, never per record
public with sharing class OrderTriggerHandler {
    public static void afterSave(List<Order> orders, Map<Id, Order> oldMap) {
        Set<Id> ids = new Set<Id>();
        for (Order o : orders) {
            Boolean send = oldMap == null || o.Status != oldMap.get(o.Id).Status;  // send on real changes only
            if (send) { ids.add(o.Id); }
        }
        if (!ids.isEmpty()) {
            System.enqueueJob(new OrderErpSyncJob(ids));
        }
    }
}
```

```apex
public with sharing class OrderErpSyncJob implements Queueable, Database.AllowsCallouts {
    public static final Integer TIMEOUT_MS = 10000;
    private static final Integer MAX_PER_JOB = 10;     // 10 x 10 s = 100 s: under the 120 s cumulative callout limit
    private final Set<Id> orderIds;
    public OrderErpSyncJob(Set<Id> orderIds) { this.orderIds = orderIds; }

    public void execute(QueueableContext ctx) {
        List<Id> batch = new List<Id>();
        Set<Id> rest = new Set<Id>();
        for (Id i : orderIds) { if (batch.size() < MAX_PER_JOB) batch.add(i); else rest.add(i); }

        List<Order> results = new List<Order>();
        for (Order o : [SELECT Id, OrderNumber, Status, TotalAmount FROM Order
                        WHERE Id IN :batch WITH USER_MODE]) {
            results.add(OrderErpService.send(o));       // callouts first, no DML yet
        }
        update as user results;                          // then one DML with the outcome
        if (!rest.isEmpty()) {
            System.enqueueJob(new OrderErpSyncJob(rest)); // chain one job for the rest
        }
    }
}
```

```apex
public with sharing class OrderErpService {
    public static Order send(Order o) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:ERP/api/orders');      // the Named Credential holds the URL and auth
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setTimeout(OrderErpSyncJob.TIMEOUT_MS);   // chunk x timeout must stay <= 120 s
        req.setBody(JSON.serialize(new Map<String, Object>{
            'salesforceId' => o.Id, 'orderNumber' => o.OrderNumber,
            'status' => o.Status, 'total' => o.TotalAmount }));
        Order result = new Order(Id = o.Id);
        try {
            HttpResponse res = new Http().send(req);
            Boolean ok = res.getStatusCode() >= 200 && res.getStatusCode() < 300;
            result.ERP_Sync_Status__c = ok ? 'Sent' : 'Failed';
            result.ERP_Last_Error__c = ok ? null : (res.getStatusCode() + ' ' + res.getBody()).left(255);
        } catch (CalloutException e) {                   // timeout or connection error
            result.ERP_Sync_Status__c = 'Failed';
            result.ERP_Last_Error__c = e.getMessage().left(255);
        }
        return result;
    }
}
```

- The status fields (`ERP_Sync_Status__c`, `ERP_Last_Error__c`) are what make failures visible. A scheduled job can re-send `Failed` records whose error was a 5xx or a timeout, with a retry count cap. Don't retry 4xx responses.
- The job's own update of `Order` fires the Order trigger again. The trigger only sends on a status change, so it doesn't loop. Say how your filter prevents the loop.
- From an async context (a Queueable, Batch or future) you can enqueue only one job. If the trigger can run there too, set `ERP_Sync_Status__c = 'Pending'` in a before trigger and let a scheduled job collect pending records, instead of skipping them.
- A Transaction Finalizer (`System.Finalizer`) can record a failure if the job itself dies.

## Nightly job over millions of records (Batch plus Schedulable)

```apex
// Org-wide maintenance: runs without sharing and in system mode on purpose, so it
// processes every Account no matter who scheduled it. Schedule it as an integration user.
public without sharing class AccountScoreBatch implements Database.Batchable<SObject> {
    public Database.QueryLocator start(Database.BatchableContext bc) {
        return Database.getQueryLocator(
            'SELECT Id, AnnualRevenue, NumberOfEmployees, Score__c FROM Account',
            AccessLevel.SYSTEM_MODE);
    }
    public void execute(Database.BatchableContext bc, List<Account> scope) {
        List<Account> changed = new List<Account>();
        for (Account a : scope) {                       // no SOQL here
            Decimal score = AccountScoring.score(a);
            if (a.Score__c != score) { a.Score__c = score; changed.add(a); }
        }
        Database.update(changed, false, AccessLevel.SYSTEM_MODE);  // partial success, one DML
        // Read the SaveResults and log failures if they matter
    }
    public void finish(Database.BatchableContext bc) {}
}
```

```apex
public with sharing class AccountScoreSchedule implements Schedulable {
    public void execute(SchedulableContext sc) {
        Database.executeBatch(new AccountScoreBatch(), 200);
    }
}
// Schedule in the sandbox (Anonymous Apex or Setup > Apex Classes > Schedule Apex):
// System.schedule('Account score nightly', '0 0 2 * * ?', new AccountScoreSchedule());
```

- If the job must respect the scheduling user's access, use `with sharing` and `AccessLevel.USER_MODE` instead. Choose one deliberately and say which.
- `start` can return up to 50 million rows from a QueryLocator. Scope defaults to 200, with a maximum of 2,000. Lower it if `execute` does heavy work.
- Put the calculation in a separate class (`AccountScoring`) so it can be unit-tested without the batch.
- Filter `start` to the records that can change (for example, `WHERE LastModifiedDate = LAST_N_DAYS:1`) when the inputs allow it. That makes nightly runs much cheaper.
- Scheduled Apex runs with synchronous limits. Keep the Schedulable to the one `executeBatch` call.
- Limits: 5 batch jobs queued or active at once, 100 in the flex queue, 100 scheduled jobs. Async executions share a daily org limit (250,000, or 200 per user licence, whichever is greater).
