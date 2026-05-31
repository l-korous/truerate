// Azure cost guardrail for the TrueRate resource group.
// A monthly cost budget with email alerts straight from Azure to the maintainer
// — needs no Cost Management read role and no secrets (unlike querying cost).
//
// Deploy:  az deployment group create -g truerate-rg -f infra/budget.bicep
targetScope = 'resourceGroup'

@description('Monthly budget amount, in the subscription billing currency.')
param amount int = 5

@description('Where Azure sends the threshold alerts.')
param contactEmails array = [ 'lukas.korous@gmail.com' ]

@description('First day of the month the budget starts (YYYY-MM-01).')
param startDate string = '2026-06-01'

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: 'truerate-monthly-budget'
  properties: {
    category: 'Cost'
    amount: amount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
      endDate: '2035-06-01'
    }
    notifications: {
      Actual_50: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 50
        thresholdType: 'Actual'
        contactEmails: contactEmails
      }
      Actual_90: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 90
        thresholdType: 'Actual'
        contactEmails: contactEmails
      }
      Actual_100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: contactEmails
      }
      Forecast_100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: contactEmails
      }
    }
  }
}
