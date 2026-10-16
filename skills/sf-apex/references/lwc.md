# Lightning Web Components

## Choosing the data source

| The component needs… | Use |
|---|---|
| fields of the current record | `getRecord` from `lightning/uiRecordApi`, or `lightning-record-view-form` / `lightning-record-form` |
| a related list as the user sees it in the layout | `getRelatedListRecords` from `lightning/uiRelatedListApi` (its `where` filter takes GraphQL-style syntax; check the adapter page) |
| a filtered, sorted or joined query | `@wire` an Apex method with `@AuraEnabled(cacheable=true)` |
| to change data | Imperative Apex (not cacheable) or `updateRecord`. Then `refreshApex(this.wiredResult)` or `notifyRecordUpdateAvailable(recordIds)` |

Lightning Data Service and UI API enforce the user's sharing and field-level security for you. An Apex controller must do it itself: `with sharing` plus `WITH USER_MODE`.

## Example: open Cases on the Account record page

```apex
// classes/AccountOpenCasesController.cls
public with sharing class AccountOpenCasesController {
    @AuraEnabled(cacheable=true)
    public static List<Case> getOpenCases(Id accountId) {
        return [
            SELECT Id, CaseNumber, Subject, Status, Priority, CreatedDate
            FROM Case
            WHERE AccountId = :accountId AND IsClosed = false
            WITH USER_MODE
            ORDER BY CreatedDate DESC
            LIMIT 200
        ];
    }
}
```

```js
// lwc/accountOpenCases/accountOpenCases.js
import { LightningElement, api, wire } from 'lwc';
import getOpenCases from '@salesforce/apex/AccountOpenCasesController.getOpenCases';

const COLUMNS = [
    { label: 'Case', fieldName: 'url', type: 'url',
      typeAttributes: { label: { fieldName: 'CaseNumber' } } },
    { label: 'Subject', fieldName: 'Subject' },
    { label: 'Status', fieldName: 'Status' },
    { label: 'Priority', fieldName: 'Priority' }
];

export default class AccountOpenCases extends LightningElement {
    @api recordId;              // set by the record page
    columns = COLUMNS;
    rows = [];
    error;
    loaded = false;

    @wire(getOpenCases, { accountId: '$recordId' })   // '$' makes it reactive
    wiredCases({ data, error }) {
        if (data) {
            this.rows = data.map((c) => ({ ...c, url: `/lightning/r/Case/${c.Id}/view` }));
            this.error = undefined;
            this.loaded = true;
        } else if (error) {
            this.rows = [];
            this.error = error.body?.message ?? 'Unable to load cases';
            this.loaded = true;
        }
    }

    get isEmpty() {
        return this.loaded && !this.error && this.rows.length === 0;
    }
}
```

```html
<!-- lwc/accountOpenCases/accountOpenCases.html -->
<template>
    <lightning-card title="Open Cases" icon-name="standard:case">
        <div class="slds-var-p-horizontal_small">
            <template lwc:if={error}>
                <p class="slds-text-color_error error">{error}</p>
            </template>
            <template lwc:elseif={isEmpty}>
                <p class="slds-text-color_weak empty">No open cases.</p>
            </template>
            <template lwc:else>
                <lightning-datatable key-field="Id" data={rows} columns={columns}
                    hide-checkbox-column></lightning-datatable>
            </template>
        </div>
    </lightning-card>
</template>
```

```xml
<!-- lwc/accountOpenCases/accountOpenCases.js-meta.xml ; apiVersion = sourceApiVersion -->
<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>SOURCE_API_VERSION</apiVersion>
    <isExposed>true</isExposed>
    <masterLabel>Account Open Cases</masterLabel>
    <targets>
        <target>lightning__RecordPage</target>
    </targets>
    <targetConfigs>
        <targetConfig targets="lightning__RecordPage">
            <objects><object>Account</object></objects>
        </targetConfig>
    </targetConfigs>
</LightningComponentBundle>
```

Users need access to the Apex class (through a permission set) and read access to Case and its fields.

## Jest test

Setup, once per project: `npm install --save-dev @salesforce/sfdx-lwc-jest`, with `"test:unit": "sfdx-lwc-jest"` in `package.json`. Run it with `npm run test:unit`.

```js
// lwc/accountOpenCases/__tests__/accountOpenCases.test.js
import { createElement } from '@lwc/engine-dom';
import AccountOpenCases from 'c/accountOpenCases';
import getOpenCases from '@salesforce/apex/AccountOpenCasesController.getOpenCases';

jest.mock(
    '@salesforce/apex/AccountOpenCasesController.getOpenCases',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);

const CASES = [
    { Id: '500000000000001AAA', CaseNumber: '00001001', Subject: 'Login', Status: 'New', Priority: 'High' },
    { Id: '500000000000002AAA', CaseNumber: '00001002', Subject: 'Billing', Status: 'Working', Priority: 'Low' }
];

const flushPromises = () => Promise.resolve();

describe('c-account-open-cases', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
    });

    function create() {
        const el = createElement('c-account-open-cases', { is: AccountOpenCases });
        el.recordId = '001000000000001AAA';
        document.body.appendChild(el);
        return el;
    }

    it('passes recordId to the wire and renders the rows', async () => {
        const el = create();
        getOpenCases.emit(CASES);
        await flushPromises();
        expect(getOpenCases.getLastConfig()).toEqual({ accountId: '001000000000001AAA' });
        const table = el.shadowRoot.querySelector('lightning-datatable');
        expect(table.data.length).toBe(2);
        expect(table.data[0].url).toBe('/lightning/r/Case/500000000000001AAA/view');
    });

    it('shows the empty state', async () => {
        const el = create();
        getOpenCases.emit([]);
        await flushPromises();
        expect(el.shadowRoot.querySelector('.empty')).not.toBeNull();
    });

    it('shows the error message', async () => {
        const el = create();
        getOpenCases.error({ message: 'No access' });
        await flushPromises();
        expect(el.shadowRoot.querySelector('.error').textContent).toBe('No access');
    });
});
```

The Ids in the Jest mock are fake test values in a unit test, not org Ids in code.

`error(body)` passes `body` as the `error.body` of the emitted error. Check the `wire-service-jest-util` README for your installed version.

## Apex test for the controller

```apex
@IsTest
private class AccountOpenCasesControllerTest {
    @IsTest
    static void returnsOnlyOpenCasesForTheAccount() {
        Account a = TestDataFactory.accounts(1, true)[0];
        insert new List<Case>{
            new Case(AccountId = a.Id, Subject = 'Open', Status = 'New'),
            new Case(AccountId = a.Id, Subject = 'Done', Status = 'Closed')
        };
        Test.startTest();
        List<Case> rows = AccountOpenCasesController.getOpenCases(a.Id);
        Test.stopTest();
        Assert.areEqual(1, rows.size(), 'Only the open case');
        Assert.areEqual('Open', rows[0].Subject, 'Open case returned');
    }
}
```

`Status = 'Closed'` depends on the org's case status values. Use a status whose `IsClosed` is true in that org.
