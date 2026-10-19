public class DiscountJob {
    public static void apply(List<Opportunity> opps) {
        for (Opportunity o : opps) {
            Account a = [SELECT Id, Type FROM Account WHERE Id = :o.AccountId];
            if (a.Type == 'Partner' && o.RecordTypeId == '012000000000ABC') {
                o.Partner_Discount__c = 10;
                update o;
            }
        }
    }
}
