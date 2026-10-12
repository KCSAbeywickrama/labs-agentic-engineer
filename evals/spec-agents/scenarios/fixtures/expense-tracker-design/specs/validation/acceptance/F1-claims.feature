Feature: F1 Claims

  @story-F1.1
  Rule: An employee submits an expense claim with a description, an amount and a date

    Scenario: Maya submits a claim
      Given Maya is signed in as an Employee
      When Maya submits a claim for "Taxi to client site", "$42.00", on "2026-01-09"
      Then the claim for "Taxi to client site" appears in her claims with status "Submitted"

    @negative
    Scenario: An amount of zero is refused
      Given Maya is signed in as an Employee
      When Maya tries to submit a claim for "Office chair", "$0.00", on "2026-01-09"
      Then no claim for "Office chair" is added to her claims

    @negative
    Scenario: A date in the future is refused
      Given Maya is signed in as an Employee and today is "2026-01-15"
      When Maya tries to submit a claim for "Flight", "$500.00", on "2026-02-01"
      Then no claim for "Flight" is added to her claims

  @story-F1.2
  Rule: An employee sees only their own claims and their current status

    Scenario: Maya sees her own claims, newest submitted first
      Given Maya has submitted a claim for "Conference ticket" on "2026-01-03" and later a claim for "Taxi to client site" on "2026-01-09"
      When Maya opens her claims
      Then "Taxi to client site" appears above "Conference ticket"

    @negative
    Scenario: Maya does not see another employee's claims
      Given Ravi has submitted a claim for "Hotel stay"
      When Maya opens her claims
      Then "Hotel stay" is not among them

  @story-F1.3
  Rule: An employee sees the decision and the reason on a decided claim of their own

    Scenario: Maya reads why her claim was rejected
      Given Maya's claim for "Team lunch" has been rejected with reason "Receipts were not itemized per person."
      When Maya opens that claim
      Then she sees it is rejected with the reason "Receipts were not itemized per person."

    Scenario: Maya sees a submitted claim awaiting a decision
      Given Maya's claim for "Taxi to client site" is still submitted
      When Maya opens that claim
      Then she sees that no decision has been made yet
