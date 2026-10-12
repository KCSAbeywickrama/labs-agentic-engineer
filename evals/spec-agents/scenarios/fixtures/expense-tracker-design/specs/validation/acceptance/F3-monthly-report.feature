Feature: F3 Monthly report

  @story-F3.1
  Rule: The monthly report totals the approved claims of a calendar month

    Scenario: Dinesh reads January's total
      Given Maya's claim for "Conference ticket" for "$350.00" was approved on "2026-01-07"
      When Dinesh the Approver reads the report for "January 2026"
      Then the total is "$350.00" from 1 approved claim

    Scenario: Submitted and rejected claims are excluded from the total
      Given a submitted claim from Ravi for "$210.00" and Maya's rejected claim for "$86.40", both in January 2026
      When Dinesh the Approver reads the report for "January 2026"
      Then neither claim is counted in the total

  @story-F3.1
  Rule: An approver can pick any calendar month, defaulting to the current month

    Scenario: The report opens on the current month
      Given today is "2026-01-15"
      When Dinesh the Approver opens the monthly report
      Then it shows the total for "January 2026"

    Scenario: Dinesh reads an earlier month's total
      Given Ana's claim for "Office supplies" for "$120.00" was approved on "2025-12-16"
      When Dinesh the Approver reads the report for "December 2025"
      Then the total is "$120.00" from 1 approved claim
