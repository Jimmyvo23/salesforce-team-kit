public with sharing class OpportunityService {
    public static List<Opportunity> openForAccounts(Set<Id> accountIds) {
        return [SELECT Id, Name, StageName FROM Opportunity WHERE AccountId IN :accountIds AND IsClosed = false WITH USER_MODE];
    }
}
