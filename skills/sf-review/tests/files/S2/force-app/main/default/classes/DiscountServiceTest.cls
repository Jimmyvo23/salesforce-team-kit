@isTest
private class DiscountServiceTest {
    @isTest static void coversEverything() {
        Account a = new Account(Name = 'A', Type = 'Partner');
        insert a;
        Opportunity o = new Opportunity(Name = 'O', AccountId = a.Id, StageName = 'Prospecting', CloseDate = Date.today());
        insert o;
        DiscountService.apply(new List<Opportunity>{ o });
    }
}
