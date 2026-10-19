trigger OpportunityTrigger on Opportunity (before insert, before update) {
    for (Opportunity o : Trigger.new) {
        if (o.Type == 'Renewal') o.Partner_Discount__c = 5;
    }
}
