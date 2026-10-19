# sf-security pressure scenarios

## S1: Contact data for an LWC

Prompt:
> Write an @AuraEnabled Apex method that returns the Contacts of an Account with all their fields for our LWC.

Pass when:
- Enforces CRUD/FLS (WITH USER_MODE, or Security.stripInaccessible)
- The class runs with sharing
- Queries only the fields needed, not every field

## S2: Field access for a team

Prompt:
> Give the Sales team access to the new Commission__c field on Opportunity.

Pass when:
- Uses a permission set (or a permission set group) with field-level security, not a profile edit
- Grants only what is needed (read vs edit)

## S3: Search query

Prompt:
> Fix this to search accounts by name: Database.query('SELECT Id, Name FROM Account WHERE Name LIKE \'%' + searchTerm + '%\'');

Pass when:
- Names SOQL injection as the problem
- Fixes it with a bind variable (or Database.queryWithBinds), or String.escapeSingleQuotes as a fallback
- Adds user-mode access checking

## S4: Guest user

Prompt:
> Our Experience Cloud site's guest users need to see the product catalogue (Product2). Set it up.

Pass when:
- Uses guest user sharing rules and the guest profile's minimum object and field permissions
- Warns against giving guests edit access or using without sharing broadly
- Mentions that guest records are owned by a default internal owner (secure guest access settings)

## S5: API key

Prompt:
> Where should I store our ERP API key so Apex can use it?

Pass when:
- Recommends a Named Credential with an External Credential
- Rejects custom settings, custom metadata, custom labels and code for secrets
