Feature: F2 Loans

  @story-F2.1
  Rule: Only a librarian checks out a copy, and only when it is available

    Scenario: Checking out an available copy
      Given a title has one available copy
      When Leo the librarian checks that copy out to Maya the member
      Then a loan exists for Maya with a due date 21 days from today
      And the copy shows the status "on loan"

    @negative
    Scenario: A copy already on loan cannot be checked out again
      Given a copy is on loan to Maya the member
      When Leo the librarian checks that copy out to Dan the member
      Then Dan has no loan on that copy

    @negative
    Scenario: A member cannot exceed 10 open loans
      Given Maya the member has 10 open loans
      When Leo the librarian checks an eleventh available copy out to Maya
      Then Maya still has 10 open loans

  @story-F2.2
  Rule: Checking in closes the loan and frees the copy

    Scenario: Returning an item
      Given a copy is on loan to Maya the member with no holds waiting on its title
      When Leo the librarian checks the copy in
      Then Maya's loan is closed
      And the copy shows the status "available"

  @story-F2.3
  Rule: A librarian sees a member's open loans and all overdue loans

    Scenario: Listing overdue loans
      Given a loan for Maya the member is open and 3 days past its due date
      And a loan for Dan the member is open and not yet due
      When Leo the librarian lists overdue loans
      Then Maya's loan is listed
      And Dan's loan is not listed

  @story-F2.4
  Rule: A member sees only their own current loans, with due dates and overdue status

    Scenario: Maya's current loans
      Given Maya the member has one open loan due in 5 days and Dan the member has one open loan
      When Maya opens her loans
      Then she sees exactly one loan with its due date

    Scenario: An overdue loan is flagged
      Given Maya the member has an open loan 2 days past its due date
      When Maya opens her loans
      Then that loan is marked overdue

  @story-F2.5
  Rule: A member sees only their own past loans

    Scenario: Past loans
      Given Maya the member has returned one item and Dan the member has returned one item
      When Maya opens her past loans
      Then she sees exactly one loan

  @story-F2.6
  Rule: Only a librarian may renew a loan, once, and not when holds are waiting

    Scenario: Renewing a loan
      Given a copy is on loan to Maya the member with no holds waiting on its title
      When Leo the librarian renews the loan
      Then the due date is extended

    @negative
    Scenario: A second renewal is refused
      Given a loan to Maya the member has already been renewed once
      When Leo the librarian renews it again
      Then the due date is unchanged

    @negative
    Scenario: Renewal is refused when a hold is waiting
      Given a copy is on loan to Maya the member and Dan the member has a hold on its title
      When Leo the librarian renews the loan
      Then the due date is unchanged
