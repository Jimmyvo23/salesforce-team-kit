# Apex security patterns

Use `sourceApiVersion` from `sfdx-project.json` for every `-meta.xml`. The keywords below are written explicitly, so the code behaves the same at API 66.0 and earlier (system-mode default) and at 67.0 and later (user-mode default).

## Which keyword does what

| You write | CRUD / FLS | Record sharing |
|---|---|---|
| `WITH USER_MODE`, `as user`, `AccessLevel.USER_MODE` | enforced | **always enforced**, whatever the class keyword |
| `WITH SYSTEM_MODE`, `as system`, `AccessLevel.SYSTEM_MODE` | skipped | from the class keyword (`with sharing` still enforces it) |
| neither, API 66.0 or earlier | skipped (system mode) | from the class keyword |
| neither, API 67.0 or later | enforced (user mode) | from the class keyword (default `with sharing`) |
| `with sharing` alone | **not** checked by the keyword | enforced |
| `Security.stripInaccessible(AccessType.READABLE, rows)` | removes fields and relationships the user can't read | doesn't change which rows you have |

`WITH SECURITY_ENFORCED` is not allowed at API 67.0 and later; use `WITH USER_MODE`.

## LWC controller that returns related records

```apex
public with sharing class AccountContactsController {
    @AuraEnabled(cacheable=true)
    public static List<Contact> getContacts(Id accountId) {
        if (accountId == null) {
            return new List<Contact>();
        }
        // The fields the component shows. Add one here when the UI needs it.
        return [
            SELECT Id, Name, Title, Email, Phone
            FROM Contact
            WHERE AccountId = :accountId
            WITH USER_MODE
            ORDER BY LastName
            LIMIT 200
        ];
    }
}
```

`WITH USER_MODE` throws a `QueryException` if the user can't read Contact or one of the fields. If the component should show what it can instead of failing, drop fields the user can't read:

```apex
// System mode only so the query doesn't fail on FLS; sharing still applies (with sharing class).
List<Contact> rows = [
    SELECT Id, Name, Title, Email, Phone FROM Contact
    WHERE AccountId = :accountId WITH SYSTEM_MODE ORDER BY LastName LIMIT 200
];
SObjectAccessDecision decision = Security.stripInaccessible(AccessType.READABLE, rows);
return (List<Contact>) decision.getRecords();
```

Give the users **Apex class access** to `AccountContactsController` in the same permission set that grants the data access.

## Test as a user with only the intended access

`System.runAs` enforces the user's sharing, object and field permissions in the block. Users and `PermissionSetAssignment` are setup objects. Inserting them in the same test as Accounts or Contacts gives `MIXED_DML_OPERATION` unless the setup DML is inside a `System.runAs` block.

```apex
@IsTest
private class AccountContactsControllerTest {
    private static User makeUser(String profileName, String permSetName) {
        User u;
        System.runAs(new User(Id = UserInfo.getUserId())) {   // avoids MIXED_DML_OPERATION
            Profile p = [SELECT Id FROM Profile WHERE Name = :profileName WITH SYSTEM_MODE];
            u = new User(
                Alias = 'sectest', Email = 'sectest@example.com', LastName = 'Test',
                Username = 'sectest' + DateTime.now().getTime() + '@example.com',
                ProfileId = p.Id, EmailEncodingKey = 'UTF-8', LanguageLocaleKey = 'en_US',
                LocaleSidKey = 'en_US', TimeZoneSidKey = 'America/Los_Angeles');
            insert as system u;
            if (permSetName != null) {
                PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = :permSetName WITH SYSTEM_MODE];
                insert as system new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = ps.Id);
            }
        }
        return u;
    }

    @IsTest
    static void returnsContactsForUserWithAccess() {
        User u = makeUser('Standard User', 'Account_Contacts_Viewer');
        // Owned by the test user, so the result doesn't depend on the org's sharing settings.
        Account acc = new Account(Name = 'Acme', OwnerId = u.Id);
        insert as system acc;
        insert as system new Contact(LastName = 'Lee', AccountId = acc.Id, Email = 'lee@example.com', OwnerId = u.Id);

        System.runAs(u) {
            Test.startTest();
            List<Contact> rows = AccountContactsController.getContacts(acc.Id);
            Test.stopTest();
            Assert.areEqual(1, rows.size(), 'One contact expected');
            Assert.areEqual('lee@example.com', rows[0].Email, 'Email should be returned');
        }
    }

    @IsTest
    static void failsForUserWithoutContactAccess() {
        User u = makeUser('Minimum Access - Salesforce', null);
        Account acc = new Account(Name = 'Acme');
        insert as system acc;
        System.runAs(u) {
            try {
                AccountContactsController.getContacts(acc.Id);
                Assert.fail('Expected a QueryException for a user without Contact access');
            } catch (QueryException e) {
                Assert.isTrue(e.getMessage() != null, 'Access error expected');
            }
        }
    }
}
```

The permission set the test assigns (`Account_Contacts_Viewer` here) must give Read on Contact, Apex class access to the controller, and Read on **every field the query uses**: the selected fields and the `WHERE` / `ORDER BY` fields (`Contact.AccountId`, `Contact.Title`, `Contact.Email`, `Contact.Phone`; `LastName` is required, so always readable). User mode checks them all. If the test user is on Minimum Access, the permission set is the only access it has, so a missing field fails the test.

Profile names differ between orgs and languages. Confirm them in the sandbox, or build the test user on the Minimum Access profile plus your permission sets.

## Search without SOQL injection

```apex
public with sharing class AccountSearchController {
    private static final Set<String> SORTABLE = new Set<String>{ 'Name', 'CreatedDate' };

    @AuraEnabled(cacheable=true)
    public static List<Account> search(String searchTerm, String sortField) {
        if (String.isBlank(searchTerm) || searchTerm.trim().length() < 2) {
            return new List<Account>();
        }
        // Bind variable: the input is data, never part of the query text.
        String pattern = '%' + searchTerm.trim() + '%';
        // Field names can't be bound: allow-list them.
        String orderBy = SORTABLE.contains(sortField) ? sortField : 'Name';
        String soql = 'SELECT Id, Name FROM Account WHERE Name LIKE :pattern '
            + 'ORDER BY ' + orderBy + ' LIMIT 50';
        // AccessLevel.USER_MODE enforces CRUD, FLS and sharing (the parameter is required here).
        return Database.queryWithBinds(soql, new Map<String, Object>{ 'pattern' => pattern }, AccessLevel.USER_MODE);
    }
}
```

- With no dynamic part, use a static query: `[SELECT Id, Name FROM Account WHERE Name LIKE :pattern WITH USER_MODE LIMIT 50]`.
- `Database.query(soql, AccessLevel.USER_MODE)` also resolves `:pattern` from a local variable in scope.
- `String.escapeSingleQuotes(input)` is the fallback only when a value must sit inside quotes in the query text. It doesn't protect field names, `ORDER BY`, or numbers.
- The user's `%` and `_` act as wildcards inside `LIKE`. That's usually fine for search.
- Test: a term with a quote (`O'Brien`) and an injection attempt (`x' OR Name != '`) return only matching rows and don't throw.

## Writing records

```apex
update as user records;                                    // CRUD, FLS and sharing
Database.SaveResult[] r = Database.update(records, false, AccessLevel.USER_MODE);
SObjectAccessDecision d = Security.stripInaccessible(AccessType.UPDATABLE, records);
update as user d.getRecords();                             // write only the fields the user may edit
```

## LWC output (XSS)

```html
<!-- Safe: bindings are escaped -->
<p>{contact.Description}</p>
<!-- Rich text: sanitized by the component -->
<lightning-formatted-rich-text value={article.Body__c}></lightning-formatted-rich-text>
```

Never: `this.template.querySelector('div').innerHTML = record.Description;` with user-entered data, or `<div lwc:dom="manual">` filled from input. Check that URLs built from data start with `https://` before binding them to `href` or `src`.
