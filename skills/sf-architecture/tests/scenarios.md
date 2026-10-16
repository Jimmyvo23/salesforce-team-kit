# sf-architecture pressure scenarios

## S1: Cross-object update on close

Prompt:
> When an Opportunity is set to Closed Won, set the Account's Customer_Since__c to today if it is blank. Design how we should build this in our sandbox org (alias uat). Give me the design, not the metadata.

Pass when:
- Runs or asks for an automation inventory of the existing flows, triggers, workflow rules and process builders on Opportunity and Account before choosing an approach
- Chooses an after-save record-triggered flow (or Apex), not a before-save flow, because it updates a different record
- Limits the entry condition to the change to Closed Won (for example ISCHANGED or "only when a record is updated to meet the condition")
- Mentions bulk behaviour (many Opportunities saved at once) or recursion and order of execution

## S2: Same-record field

Prompt:
> On Opportunity save, set Next_Step_Date__c to CloseDate minus 7 days. What's the best way to build it?

Pass when:
- Recommends a before-save record-triggered flow (fast field update), or a formula field if a stored value is not needed, and says why it beats after-save or Apex here
- Notes that a before-save flow cannot create or update other records
- Says to check existing automation on Opportunity first

## S3: ERP integration

Prompt:
> When an Order is activated we need to send it to our ERP at https://erp.example.com/api/orders. How should we architect this?

Pass when:
- Does not put a synchronous callout in a trigger or before-save context; uses an asynchronous pattern (Queueable/@future callout, Platform Event, or change data capture)
- Uses a Named Credential (and External Credential) for the endpoint and authentication, with no hard-coded URL or secret
- Covers failure handling: retries, logging or an error record

## S4: Big formula

Prompt:
> Add a formula field Health_Score__c on Account that combines our 15 existing formula fields into one score.

Pass when:
- Warns about the formula compiled-size limit (currently 15,000 bytes compiled per the Winter '27 Formula Size tip sheet) and that referencing other formulas counts their compiled size
- Offers an alternative if the limit is hit (for example a before-save flow or Apex that stores the value)

## S5: Lookup or master-detail

Prompt:
> We are adding Invoice__c linked to Account. We expect about 2 million invoices, some accounts with over 100,000. Lookup or master-detail?

Pass when:
- Compares lookup and master-detail on sharing, ownership, cascade delete and roll-up summaries
- Raises data skew (more than about 10,000 child records under one parent) and its locking and sharing-recalculation effects
- Gives a recommendation with the reason
