Feature: F1 Submit expenses

  @story-F1.1
  Rule: A claim holds one or more expense lines with date, category, amount and description

    Scenario: Creating a claim with two lines
      Given Erin the employee is signed in
      When Erin creates a claim with a "2026-10-01" "Meals" line of 42.50 for "Team lunch" and a "2026-10-02" "Travel" line of 18.00 for "Taxi"
      Then Erin's new claim shows two lines and a total of 60.50

    @negative
    Scenario: A claim with no lines is refused
      Given Erin the employee is signed in and has no claims
      When Erin tries to save a claim with no expense lines
      Then Erin has no claims

  @story-F1.2
  Rule: A claim stays editable as a draft until it is submitted

    Scenario: Editing a draft
      Given Erin has a draft claim with one "Meals" line of 42.50
      When Erin changes that line's amount to 45.00
      Then the draft shows a total of 45.00 and the status "draft"

  @story-F1.3
  Rule: Submitting a draft sends it for approval

    Scenario: Submitting a draft
      Given Erin has a draft claim with one "Meals" line of 42.50
      When Erin submits the claim
      Then the claim's status is "submitted"

    @negative
    Scenario: A submitted claim can no longer be edited
      Given Erin has a submitted claim with one "Meals" line of 42.50
      When Erin tries to change that line's amount to 45.00
      Then the claim's total is still 42.50

  @story-F1.4
  Rule: An employee sees only their own claims, with their status

    Scenario: The claim list shows statuses
      Given Erin has one draft claim and one submitted claim
      When Erin opens her claim list
      Then she sees exactly two claims with the statuses "draft" and "submitted"

    @negative
    Scenario: Another employee's claims are not visible
      Given Dan the employee has a submitted claim
      And Erin the employee has no claims
      When Erin opens her claim list
      Then she sees no claims

  @story-F1.5 @story-F1.6
  Rule: A rejected claim shows its reason and can be edited and resubmitted

    Scenario: Resubmitting after rejection
      Given Erin's claim was rejected by her manager with the reason "Missing detail on lunch"
      When Erin opens the claim, changes a line's description to "Team lunch with client Acme" and submits it again
      Then she saw the reason "Missing detail on lunch" and the claim's status is "submitted"

  @story-F1.7
  Rule: Only an undecided submitted claim can be withdrawn

    Scenario: Withdrawing a submitted claim
      Given Erin has a submitted claim that her manager has not decided
      When Erin withdraws the claim
      Then the claim's status is "draft"

    @negative
    Scenario: An approved claim cannot be withdrawn
      Given Erin has a claim that her manager approved
      When Erin tries to withdraw the claim
      Then the claim's status is still "approved"
