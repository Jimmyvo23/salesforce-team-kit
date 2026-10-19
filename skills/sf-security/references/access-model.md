# Access model: permission sets, sharing, guest users, credentials

Use `sourceApiVersion` from `sfdx-project.json` as the `apiVersion` of anything you add. Everything here is metadata in `force-app`, deployed to the sandbox and then moved to production by a person with a change set.

## Field access for a team

One permission set per job, least access. Read-only by default:

`force-app/main/default/permissionsets/Opportunity_Commission_Read.permissionset-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Opportunity Commission Read</label>
    <description>Read access to Opportunity.Commission__c for the Sales team.</description>
    <hasActivationRequired>false</hasActivationRequired>
    <fieldPermissions>
        <field>Opportunity.Commission__c</field>
        <readable>true</readable>
        <editable>false</editable>   <!-- true only if the team must change it -->
    </fieldPermissions>
</PermissionSet>
```

- If some people must edit the field, make a second permission set (`Opportunity_Commission_Edit`) for them only. Don't make everyone an editor.
- Field permission alone doesn't give the object. Users still need Read on Opportunity from their existing access. Add `<objectPermissions>` only if they lack it, with the smallest set of `allow…` flags.
- Formula, roll-up summary and other read-only fields: `editable` must be false.
- Permissions on universally required fields can't be deployed: they are visible to everyone.
- The field must exist in the project (or the org) for the deploy to succeed. If it isn't in source, retrieve it from the sandbox or add its field metadata.

### Group per role

`force-app/main/default/permissionsetgroups/Sales.permissionsetgroup-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<PermissionSetGroup xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Sales</label>
    <description>Everything the Sales team needs.</description>
    <permissionSets>Opportunity_Commission_Read</permissionSets>
</PermissionSetGroup>
```

If the team already has a group, add the permission set to it. To take one permission away from a group without changing the permission sets inside it, add a **muting permission set** to the group (one per group). Assign the group (or permission set) to users in the sandbox in Setup. In tests, assign it inside `System.runAs` to avoid `MIXED_DML_OPERATION`.

### Why not the profile

Profiles keep the baseline that only profiles hold (default apps, record type defaults, login hours, IP ranges). Object and field access go in permission sets, which can be reused across roles, combined in groups, and removed from one person without touching everyone on the profile.

## Record access (sharing)

- Org-wide defaults set the floor. Open records up with sharing rules (owner- or criteria-based), role hierarchy, teams, or Apex managed sharing for code-driven cases.
- `with sharing` Apex and user-mode operations respect all of it. `without sharing` ignores it only for system-mode operations: at API 66.0 and earlier that is every operation without an access mode; at 67.0 and later only those written `WITH SYSTEM_MODE` / `as system`. Use it only in a small, commented class for a stated reason.

## Experience Cloud guest users

Facts that the platform enforces (secure guest user settings, always on):

- Guest org-wide defaults are **Private** and can't be changed. Records reach guests only through **guest user sharing rules**: criteria-based, access level **Read** only. Manual sharing and Apex managed sharing can't grant guests access.
- Guests can't have Edit, Delete, View All or Modify All on objects. Only Read and Create.
- Records a guest creates are assigned to the site's **default record owner** (an active internal user, set in Setup > Digital Experiences > All Sites > Workspaces > Administration > Preferences). The guest doesn't own them and can't update them.

### Guest profile: object and field permissions

The guest user profile is named after the site (for example `Partner Catalog Profile`). Retrieve it from the sandbox before editing, and change only these entries:

```xml
<objectPermissions>
    <object>Product2</object>
    <allowRead>true</allowRead>
    <allowCreate>false</allowCreate>
    <allowEdit>false</allowEdit>
    <allowDelete>false</allowDelete>
    <viewAllRecords>false</viewAllRecords>
    <modifyAllRecords>false</modifyAllRecords>
</objectPermissions>
<fieldPermissions>
    <field>Product2.Description</field>
    <readable>true</readable>
    <editable>false</editable>
</fieldPermissions>
<!-- One fieldPermissions entry per field the catalogue shows. Nothing internal (cost, margin). -->
```

Use the guest profile, not a new permission set: it is the site's own guest configuration, and it has one user. (A permission set assigned to the guest user is possible but adds a second place to audit, and it can't contain restricted permissions.)

### Guest user sharing rule

`force-app/main/default/sharingRules/Product2.sharingRules-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<SharingRules xmlns="http://soap.sforce.com/2006/04/metadata">
    <sharingGuestRules>
        <fullName>Active_Products_For_Site_Guests</fullName>
        <accessLevel>Read</accessLevel>
        <label>Active products for site guests</label>
        <sharedTo>
            <guestUser>PartnerCatalog</guestUser>   <!-- the site guest user's nickname -->
        </sharedTo>
        <criteriaItems>
            <field>IsActive</field>
            <operation>equals</operation>
            <value>True</value>
        </criteriaItems>
        <includeHVUOwnedRecords>false</includeHVUOwnedRecords>
    </sharingGuestRules>
</SharingRules>
```

Narrow the criteria to what the public may see (for example an extra "Show on site" checkbox). Anyone on the internet sees every matching record.

### Guest Apex and the default owner

- Apex that a guest page calls: `with sharing`, `WITH USER_MODE`, Apex class access on the guest profile, and no method that returns or changes more than the sharing rule allows. Never solve "the guest can't see it" with `without sharing` or `WITH SYSTEM_MODE`.
- If guests create records (a form), choose the default owner in Workspaces > Administration > Preferences: an active internal user with Read access to those records. Don't rely on it alone: route the records to different users or queues with assignment rules or automation (queues where possible), so one user doesn't own them all and a deactivated owner doesn't cause errors.
- Product prices live in Pricebook2 and PricebookEntry. Exposing them is a separate decision: confirm with the user.
- Verify with Setup → **Guest User Sharing Rule Access Report**, and test the site as a guest in the sandbox.

## Secrets: Named Credential + External Credential

`force-app/main/default/externalCredentials/ERP.externalCredential-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ExternalCredential xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>ERP</label>
    <authenticationProtocol>Custom</authenticationProtocol>
    <externalCredentialParameters>
        <parameterName>ERP_Principal</parameterName>
        <parameterType>NamedPrincipal</parameterType>
        <sequenceNumber>1</sequenceNumber>
    </externalCredentialParameters>
    <externalCredentialParameters>
        <parameterName>X-API-Key</parameterName>
        <parameterType>AuthHeader</parameterType>
        <parameterValue>{!$Credential.ERP.ApiKey}</parameterValue>
        <sequenceNumber>1</sequenceNumber>
    </externalCredentialParameters>
</ExternalCredential>
```

The key (`ApiKey`) is an authentication parameter on the principal, typed in Setup in each org. It is stored encrypted and is not in the metadata.

`force-app/main/default/namedCredentials/ERP.namedCredential-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<NamedCredential xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>ERP</label>
    <namedCredentialType>SecuredEndpoint</namedCredentialType>
    <namedCredentialParameters>
        <parameterName>Url</parameterName>
        <parameterType>Url</parameterType>
        <parameterValue>https://erp.example.com</parameterValue>
    </namedCredentialParameters>
    <namedCredentialParameters>
        <parameterName>ExternalCredential</parameterName>
        <parameterType>Authentication</parameterType>
        <externalCredential>ERP</externalCredential>
    </namedCredentialParameters>
    <generateAuthorizationHeader>false</generateAuthorizationHeader>
</NamedCredential>
```

Grant the principal to the users (or integration user) that run the callout:

```xml
<externalCredentialPrincipalAccesses>
    <enabled>true</enabled>
    <externalCredentialPrincipal>ERP-ERP_Principal</externalCredentialPrincipal>
</externalCredentialPrincipalAccesses>
```

If the callout sends the header formula literally instead of the key, enable Allow Formulas in HTTP Header (`allowMergeFieldsInHeader`) on the Named Credential; confirm in a sandbox (not verified in the primary docs).

Apex: `req.setEndpoint('callout:ERP/v1/orders');`. Never log request headers. If the sandbox should call a test ERP, keep the same Named Credential name and change the URL and key per org.

| Not for secrets | Reason |
|---|---|
| Apex code | In source control, every sandbox, every change set |
| Custom settings | Readable by all profiles, including the guest user, unless protected in a managed package |
| Custom metadata | Stored and deployed in plain text |
| Custom labels | Plain text, readable by every user |
| Static resources, text fields, debug logs | Plain text |
