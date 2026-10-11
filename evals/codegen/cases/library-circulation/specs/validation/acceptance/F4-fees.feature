Feature: F4 Fees

  @story-F4.1
  Rule: A late return creates a fee of 0.25 per day late, capped at 10.00, and an on-time return creates none

    Scenario: Returning 4 days late
      Given a loan for Maya the member is open and 4 days past its due date
      When Leo the librarian checks the copy in
      Then Maya has a fee of 1.00 for 4 days late

    Scenario: The fee is capped
      Given a loan for Maya the member is open and 80 days past its due date
      When Leo the librarian checks the copy in
      Then Maya has a fee of 10.00

    @negative
    Scenario: An on-time return creates no fee
      Given a loan for Maya the member is open and due tomorrow
      When Leo the librarian checks the copy in
      Then Maya has no new fee

  @story-F4.2
  Rule: A member sees only their own fees, with loan, days late, amount and status

    Scenario: Maya's fees
      Given Maya the member has an unpaid fee for 4 days late and Dan the member has an unpaid fee
      When Maya opens her fees
      Then she sees exactly one fee of 1.00 for 4 days late marked unpaid

  @story-F4.3
  Rule: A member sees their total unpaid balance

    Scenario: Balance excludes settled fees
      Given Maya the member has an unpaid fee of 1.00 and a settled fee of 2.00
      When Maya opens her fees
      Then her unpaid balance is 1.00

  @story-F4.4
  Rule: A librarian sees any member's fees and unpaid balance

    Scenario: Looking up a member
      Given Maya the member has unpaid fees of 1.00 and 0.50
      When Leo the librarian opens Maya's fees
      Then he sees both fees and an unpaid balance of 1.50

  @story-F4.5
  Rule: Only a librarian records a payment that settles a fee

    Scenario: Recording a payment
      Given Maya the member has an unpaid fee of 1.00
      When Leo the librarian records payment of that fee
      Then the fee is settled
      And Maya's unpaid balance is 0.00

    @negative
    Scenario: A member cannot settle their own fee
      Given Maya the member has an unpaid fee of 1.00
      When Maya looks for a way to settle her fee
      Then the fee is still unpaid

  @story-F4.6
  Rule: Only a librarian may waive a fee

    Scenario: Waiving a fee
      Given Maya the member has an unpaid fee of 1.00
      When Leo the librarian waives that fee
      Then Maya's unpaid balance is 0.00

    @negative
    Scenario: A member cannot waive a fee
      Given Maya the member has an unpaid fee of 1.00
      When Maya looks for a way to waive her fee
      Then the fee is still unpaid

  @story-F4.1
  Rule: A member with unpaid fees above 10.00 cannot borrow further items

    @negative
    Scenario: Checkout is refused over the limit
      Given Maya the member has unpaid fees of 10.50
      When Leo the librarian checks an available copy out to Maya
      Then Maya has no new loan
