# Sources

On 2026-10-16, developer.salesforce.com returned HTTP 403 to WebFetch and curl, and help.salesforce.com pages render only with JavaScript. So the official PDF editions on resources.docs.salesforce.com (Winter '27, API 68.0) were read in full where they exist. Help topics without a PDF were checked through WebSearch, limited to help.salesforce.com, developer.salesforce.com and architect.salesforce.com.

## Read in full (official PDFs)

- **Tooling API objects** (ApexTrigger, Flow, FlowDefinition, WorkflowRule, ValidationRule, CustomObject, SOQL limitations): https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_tooling.pdf (Tooling API v68.0, checked 2026-10-16)
- **FlowDefinitionView fields** (TriggerObjectOrEventLabel, TriggerType, RecordTriggerType, TriggerOrder, ProcessType; standard API, describe and query only) and **ApexTrigger.TableEnumOrId**: https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/object_reference.pdf (Object Reference v68.0, checked 2026-10-16)
- **Order of execution**, multiple triggers' order not guaranteed, asynchronous callouts from triggers, Named Credential callouts, callout and Queueable limits: https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_apex_developer_guide.pdf (Apex Developer Guide v68.0, checked 2026-10-16)
- **Formula compiled size** (15,000 bytes), saved size (4,000 bytes), 3,900 characters, and the fact that referenced fields count toward compile size: https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_formula_size_tipsheet.pdf (Winter '27, checked 2026-10-16)
- **Large data volumes**: 10,000 children per parent, 10,000 records per owner, parent locking, deferred sharing: https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_large_data_volumes_bp.pdf (Winter '27, checked 2026-10-16)
- **Platform Events**: Publish After Commit, retries: https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/platform_events.pdf (v68.0, checked 2026-10-16)
- **Integration patterns** (Remote Process Invocation: Request and Reply, and Fire and Forget): https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/integration_patterns_and_practices.pdf (v68.0, checked 2026-10-16)

## Checked through search (official pages)

- **Before-save flows** (fast field updates, supported elements, no other records): https://help.salesforce.com/s/articleView?id=platform.flow_concepts_trigger_record.htm&language=en_US&type=5 (checked 2026-10-16)
- **Record-triggered flow considerations**: https://help.salesforce.com/s/articleView?id=platform.flow_considerations_trigger_record.htm&language=en_US&type=5 (checked 2026-10-16)
- **Flow trigger order and Flow Trigger Explorer**: https://help.salesforce.com/s/articleView?id=flow_trigger_explorer.htm&type=5&language=en_US (checked 2026-10-16)
- **Before-save vs after-save vs Apex, one entry point per object**: https://architect.salesforce.com/docs/architect/decision-guides/guide/record-triggered (checked 2026-10-16)
- **Formula field limits** (current page states 15,000 bytes compiled): https://help.salesforce.com/s/articleView?language=en_US&id=sf.formula_field_limits.htm&type=5 (checked 2026-10-16)
- **Lookup vs master-detail** (sharing, ownership, cascade delete, roll-ups, limits): https://help.salesforce.com/s/articleView?id=relationships_considerations.htm&language=en_US&type=5 (checked 2026-10-16)
- **Data skew and sharing recalculation**: https://developer.salesforce.com/blogs/engineering/2013/01/reducing-lock-contention-by-avoiding-account-data-skews (checked 2026-10-16)
- **Change Data Capture** (change event triggers, async after commit): https://developer.salesforce.com/docs/platform/change-data-capture/guide/cdc-trigger-intro.html (checked 2026-10-16)
