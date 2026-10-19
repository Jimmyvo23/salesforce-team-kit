---
name: sf-security
description: Use when Salesforce work touches who can see or change data - Apex or LWC that reads or writes records, @AuraEnabled methods, dynamic SOQL or search built from user input, giving a team or user access to an object or field, profiles, permission sets and permission set groups, sharing rules, Experience Cloud sites and guest users, rendering user text as HTML, or storing API keys, passwords, tokens and other secrets.
---

# Salesforce Security

## Overview

Every answer gives the **least access that does the job** and **does the work**: write the code or the metadata, state the assumption you made, and show how to change it. Don't stop at a list of questions when a safe default exists. **Every Apex answer includes its test class** that runs as a user with only the intended access (`references/apex-security.md`). If you can't write files, put every file in the answer with its path.

**First, read `sfdx-project.json` `sourceApiVersion`.** Use it for every new `-meta.xml` `apiVersion`. Don't name a release. It decides the Apex defaults below. Production deploys are done by a person with change sets: never suggest deploying, validating or quick-deploying to production. Work targets the sandbox.

## Three separate layers

| Layer | Controls | Set by |
|---|---|---|
| **Object permissions (CRUD)** | Read, Create, Edit, Delete on an object | Permission sets (and the profile baseline) |
| **Field-level security (FLS)** | Read or Edit on one field | Permission sets |
| **Record sharing** | *Which* records: owner, role, sharing rules, teams | Org-wide defaults and sharing rules |

`with sharing` enforces **only** record sharing. It does **not** check CRUD or FLS. CRUD/FLS come from **user mode** (`WITH USER_MODE`, `as user`, `AccessLevel.USER_MODE`) or `Security.stripInaccessible`.

## Apex: version-aware defaults

| Class saved at API… | Database operations by default | Class with no sharing keyword |
|---|---|---|
| **66.0 or earlier** | **system mode**: no CRUD/FLS checks | Aura and `@AuraEnabled` entry points: with sharing; other entry points: without sharing; non-entry classes: the caller's mode |
| **67.0 or later** | user mode | with sharing |

Write it explicitly at every version, so the code means the same after a version bump:

- **Every class says `with sharing`.** `without sharing` only for a named reason, in the smallest inner class, with a comment.
- **Every query says `WITH USER_MODE`**, every DML says `insert as user` / `update as user`, every `Database` method passes `AccessLevel.USER_MODE`.
- `WITH USER_MODE` sits **after `WHERE` and before `ORDER BY` / `LIMIT`**: `... WHERE AccountId = :accountId WITH USER_MODE ORDER BY LastName LIMIT 200`.
- **User mode also enforces sharing**, whatever the class keyword says.
- **At 67.0+, `without sharing` only affects operations explicitly set to system mode** (`WITH SYSTEM_MODE` / `as system`). Every other operation runs in user mode and enforces sharing, so the keyword alone gives no extra record access.
- **System mode (`WITH SYSTEM_MODE`, `as system`) skips CRUD and FLS only.** Record sharing then comes from the class keyword, so `as system` inside a `with sharing` class still can't touch records the user can't see. Use it on one statement, with a comment saying why, and tell the user.
- Don't use `WITH SECURITY_ENFORCED`. It is not allowed at 67.0 and later. Use `WITH USER_MODE`.
- To return what the user may see instead of failing: `Security.stripInaccessible(AccessType.READABLE, records).getRecords()`. Spell it exactly. The result type is `SObjectAccessDecision`.
- The user also needs **Apex class access** (in a permission set) to call an `@AuraEnabled` method.

## Data for an LWC: only the fields it shows

"Return all fields" is a request to say no to. Query **a named field list** of the fields the component displays. Never build a `SELECT` from `getDescribe().fields.getMap()`, and never use `FIELDS(ALL)` / `FIELDS(CUSTOM)`. Every extra field is data sent to the browser, and it changes when an admin adds a field.

```apex
public with sharing class AccountContactsController {
    @AuraEnabled(cacheable=true)
    public static List<Contact> getContacts(Id accountId) {
        // Fields the component shows. Add a field here when the UI needs it.
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

Say which fields you chose and that the user should name any others. **User mode checks every field the query touches**, including `WHERE` and `ORDER BY` fields (`AccountId`, `LastName`). A permission set or test user for this method needs Read on all of them, not only the selected ones. If the method must not fail on a field the user can't read, query in system mode **only for that reason**, then `stripInaccessible`. Prefer Lightning Data Service (`lightning/uiRelatedListApi`) when it can read the data: it enforces CRUD, FLS and sharing by itself. Include an Apex test that runs as a user with only the intended permission set (`references/apex-security.md`).

## Dynamic SOQL: SOQL injection

String-concatenating user input into `Database.query` is **SOQL injection**. Name it. Fix it with a **bind variable**:

```apex
String pattern = '%' + searchTerm + '%';
List<Account> accounts = [
    SELECT Id, Name FROM Account
    WHERE Name LIKE :pattern
    WITH USER_MODE
    LIMIT 50
];
```

- Need a dynamic query string? `Database.queryWithBinds(query, new Map<String, Object>{'pattern' => pattern}, AccessLevel.USER_MODE)`. For `Database.query` / `queryWithBinds`, set the mode with the `AccessLevel` argument only. Don't also write `WITH USER_MODE` inside the string.
- Field names, object names and sort direction can't be bound: check them against an **allow-list** or `Schema` describe, never pass them through.
- `String.escapeSingleQuotes` is only a fallback for a value inside quotes. It doesn't help unquoted parts.
- Also add user-mode access, `LIMIT`, and a blank or too-short search check.

Patterns and tests: `references/apex-security.md`.

## Access for people: permission sets, not profiles

When asked to give a team access to a field or object, **write the permission set** at once. Don't ask whether to edit the profile.

- One **permission set** per job (for example `Commission_Read`), with the **field permission** and nothing else needed. Bundle per role in a **permission set group** (for example `Sales`). Use a **muting permission set** in the group to take a permission away. Profiles stay a minimal baseline. Don't add object or field access to them.
- **Grant the least access.** Default to **read-only** (`<readable>true</readable><editable>false</editable>`). Grant edit only when the team must change the value. A sensitive field (pay, commission, margin) is read-only unless told otherwise. State the choice and show the one-line change for edit.
- Formula and roll-up fields can only be read. A universally required field is visible to everyone, and its field permissions can't be deployed.
- Field access needs object access too: users need Read on Opportunity (most already have it). Check before adding object permissions.
- Assignment: add the permission set to the team's permission set group, or assign it to the users in the sandbox. Write the metadata so it deploys with the change set.

Metadata samples: `references/access-model.md`.

## Experience Cloud guest users

Guest access is locked down by the platform. Work with it:

- **Records:** guest org-wide defaults are always **Private**. The only way to share records with guests is a **guest user sharing rule** (criteria-based, **Read only**). Manual sharing and Apex managed sharing can't share to guests. Keep the criteria narrow (for example `IsActive = true` and a "show on site" flag): anyone on the internet sees every match.
- **Object and field permissions go on the site's guest user profile.** This is the one place where a profile is right: each site has its own guest profile with exactly one user, and it's where Salesforce sets up guest access. **Read** on the object, Read FLS on only the fields the page shows. Write it as the profile's `objectPermissions` and `fieldPermissions` (retrieve the profile from the sandbox first). Leave out required fields such as `Name`: they are always readable and their field permissions can't be deployed.
- **Never** try to give guests Edit, Delete, View All or Modify All. The platform blocks them for guests. Never work around it with system-mode queries in a `without sharing` class (or anything else that returns more than the sharing rule allows). Any `@AuraEnabled` method a guest calls is `with sharing` and `WITH USER_MODE`, and the guest profile needs Apex class access for it.
- **Records guests create are owned by a default internal owner**, set in the site's Preferences (secure guest user settings). Guests don't own records, see them later only if a guest sharing rule matches, and can't update them. Pick an active, non-guest owner. Don't rely on the default owner alone: route guest-created records to different users or queues with assignment rules or automation, so one person doesn't own them all.
- Prices need Pricebook2 and PricebookEntry access too. Confirm with the user before exposing them.
- After setup, check **Guest User Sharing Rule Access Report** in Setup and test as the guest user in the sandbox.

**Every guest answer ends with a "Guest safety" section** that tells the user, in these words or close to them:
1. **Don't give guests Edit** (or Delete, View All, Modify All) on this object, even if asked later. Read is the most a guest gets.
2. **Don't use `without sharing` Apex (or system-mode queries) to show guests more.** Any Apex the site calls is `with sharing` and `WITH USER_MODE`.
3. **Records guests create are owned by the site's default internal owner** (secure guest user settings, site Preferences). Check that an active internal user is set, and route the records to different users or queues with assignment rules or automation, so one person doesn't own everything.

Metadata for the guest profile and the sharing rule: `references/access-model.md`.

## Secrets: Named Credentials only

API keys, passwords, tokens and client secrets go in a **Named Credential with an External Credential**:

1. **External Credential**: protocol `Custom` for an API key (or `Oauth` if the system supports it). Add a **principal**, and enter the key there in Setup, in each org. Salesforce stores it encrypted. For a header, add an `externalCredentialParameters` entry with `parameterType` `AuthHeader`: its `parameterName` is the header name (`X-API-Key`) and its `parameterValue` is a formula such as `{!$Credential.ERP.ApiKey}`. The metadata XML has no `headerName` / `headerValue` fields. Copy the XML in `references/access-model.md`.
2. **Named Credential**: the base URL, linked to the External Credential.
3. **Permission set** with **External Credential Principal Access** for the users (or integration user) that run the callout.
4. Apex calls `callout:ERP/path` and never sees the key.

The key itself never goes in metadata or source control. Reject every other place by name:

| Place | Why not |
|---|---|
| Apex code or a constant | In source control and every sandbox |
| **Custom settings** | Readable by all profiles, including the guest user, unless protected inside a managed package |
| **Custom metadata** | Plain text in source control and change sets, readable by Apex and admins |
| **Custom labels** | Plain text metadata, readable by every user, made for UI text |
| Static resources, fields, debug logs | Plain text to anyone with access |

## LWC: cross-site scripting (XSS)

- Show data with template bindings (`{contact.Name}`): LWC escapes them.
- Never set `innerHTML` (or use `lwc:dom="manual"` + `innerHTML`) with data a user could have typed. For rich text, use `lightning-formatted-rich-text`, which sanitizes it.
- Don't build URLs (`href`, `src`) from user input without checking the scheme is `https:`.
- Lightning Web Security doesn't sanitize your component's own DOM. Don't rely on it.

## Before you answer, check

| Check | Fix |
|---|---|
| Asked questions instead of writing the metadata or code | Write it with a stated safe default |
| Apex without a test class | Add it: `System.runAs` a user with only the intended permission set |
| `WITH USER_MODE` in a string also passed `AccessLevel` | Keep only the `AccessLevel` argument |
| A profile edit for object or field access (internal users) | Permission set (and group). Guests: the site's guest profile |
| Edit access nobody asked for | Read-only, with the edit variant shown |
| `getDescribe` field loop, `FIELDS(ALL)`, "all fields" | Named field list |
| `with sharing` treated as an FLS check | Add `WITH USER_MODE` / `as user` |
| `WITH USER_MODE` after `ORDER BY` | Move it before `ORDER BY` |
| `'...' + userInput + '...'` in a query | Bind variable or `queryWithBinds` |
| Guest edit, View All, or `without sharing` for guests | Guest sharing rule, Read only |
| Secret in code, settings, metadata or labels | Named Credential + External Credential |
| `innerHTML` with user data | Template binding or `lightning-formatted-rich-text` |
| Mentions deploying or validating to production | Remove it |
