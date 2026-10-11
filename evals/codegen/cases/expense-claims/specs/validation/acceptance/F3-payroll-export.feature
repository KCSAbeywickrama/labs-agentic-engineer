Feature: F3 Payroll export

  @story-F3.1
  Rule: Finance sees approved claims not yet exported

    Scenario: The pending list
      Given there is one approved claim, one exported claim and one submitted claim
      When Fiona from finance opens the approved claims list
      Then she sees only the approved claim

  @story-F3.2
  Rule: Only approved claims may be exported, each in one batch only

    Scenario: Exporting two claims as one batch
      Given there are two approved claims
      When Fiona selects both and exports them
      Then one new batch contains both claims and both claims' status is "exported"

    @negative
    Scenario: A submitted claim cannot be exported
      Given there is a submitted claim
      When Fiona tries to export it
      Then no new batch is created

    @negative
    Scenario: An exported claim cannot be exported again
      Given a claim was already exported in a batch
      When Fiona tries to export it again
      Then no new batch is created

  @story-F3.3
  Rule: A batch downloads as a CSV with one row per claim

    Scenario: Downloading
      Given Fiona exported a batch of two claims
      When she downloads the batch
      Then the CSV has two rows, each with employee, claim, total and approval date

  @story-F3.4 @story-F3.5
  Rule: Past batches can be listed and downloaded again

    Scenario: Re-downloading
      Given Fiona exported a batch of two claims yesterday
      When she opens the past batches and downloads that batch again
      Then the CSV has the same two rows

    @negative
    Scenario: Non-finance users cannot see batches
      Given Erin the employee is signed in
      When Erin tries to open the past batches
      Then she sees no batches
