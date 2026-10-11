Feature: F2 Approvals

  @story-F2.1
  Rule: Only a manager's direct reports' submitted claims appear in the manager's queue, oldest first

    Scenario: Queue order
      Given Maya the manager has two direct reports with submitted claims, one submitted on "2026-10-01" and one on "2026-10-03"
      When Maya opens her team queue
      Then the claim submitted on "2026-10-01" is listed before the one submitted on "2026-10-03"

    @negative
    Scenario: A claim from outside the team is not listed
      Given Maya the manager has no direct reports
      And Dan the employee, who reports to someone else, has a submitted claim
      When Maya opens her team queue
      Then the queue is empty

  @story-F2.2
  Rule: A manager sees a claim's lines, total and submitter

    Scenario: Opening a claim
      Given Erin, a direct report of Maya, submitted a claim with a "Meals" line of 42.50
      When Maya opens that claim
      Then she sees Erin's name, the "Meals" line and a total of 42.50

  @story-F2.3
  Rule: A manager may approve a submitted claim of a direct report

    Scenario: Approving
      Given Erin, a direct report of Maya, has a submitted claim
      When Maya approves it
      Then the claim's status is "approved"

  @story-F2.4
  Rule: A rejection requires a reason

    Scenario: Rejecting with a reason
      Given Erin, a direct report of Maya, has a submitted claim
      When Maya rejects it with the reason "Missing detail on lunch"
      Then the claim's status is "rejected" and its reason is "Missing detail on lunch"

    @negative
    Scenario: Rejecting without a reason
      Given Erin, a direct report of Maya, has a submitted claim
      When Maya tries to reject it with no reason
      Then the claim's status is still "submitted"

  @story-F2.3 @story-F2.4
  Rule: Only the employee's own manager may decide, and never on her own claim

    @negative
    Scenario: A manager cannot approve her own claim
      Given Maya the manager has a submitted claim of her own
      When Maya tries to approve it
      Then the claim's status is still "submitted"

    @negative
    Scenario: A manager cannot approve a non-report's claim
      Given Dan, who does not report to Maya, has a submitted claim
      When Maya tries to approve it
      Then the claim's status is still "submitted"

  @story-F2.6
  Rule: Only finance sets reporting lines, choosing from employees who have opened the app

    Scenario: Setting a manager
      Given Erin the employee and Maya the manager have both opened the app
      When Fiona from finance sets Maya as Erin's manager
      Then Erin's manager is shown as Maya

    @negative
    Scenario: A person who never opened the app cannot be chosen
      Given Lee has never opened the app
      When Fiona from finance opens the manager picker
      Then Lee is not among the choices

    @negative
    Scenario: An employee cannot set reporting lines
      Given Erin the employee is signed in
      When Erin tries to set Maya as her manager
      Then Erin's manager is unchanged

  @story-F2.5
  Rule: A manager can see claims already decided

    Scenario: Decision history
      Given Maya has approved one claim and rejected another
      When Maya opens her decided claims
      Then she sees both claims with the statuses "approved" and "rejected"
