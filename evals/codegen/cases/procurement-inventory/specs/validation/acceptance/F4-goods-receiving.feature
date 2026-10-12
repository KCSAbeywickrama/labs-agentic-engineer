Feature: F4 Goods receiving

  @story-F4.1
  Rule: A clerk sees approved requests that still have goods to receive, oldest first

    Scenario: Pending requests are not listed
      Given one approved request and one pending request exist
      When Wanda the warehouse clerk opens the goods to receive list
      Then she sees the approved request and not the pending one

  @story-F4.2
  Rule: An approved request shows ordered, received and outstanding quantities

    Scenario: Nothing received yet
      Given an approved request for 10 of "A4 Paper"
      When Wanda opens it
      Then the line shows ordered 10, received 0 and outstanding 10

  @story-F4.3 @story-F4.4
  Rule: Receiving goods raises the stock of the received items

    Scenario: Receiving a full line
      Given "A4 Paper" has stock 5 and an approved request for 10 of it
      When Wanda records a receipt of 10 "A4 Paper"
      Then the stock of "A4 Paper" is 15
      And the ledger of "A4 Paper" has a new entry of +10

  @story-F4.5
  Rule: An order may be received in several partial receipts

    Scenario: Two partial receipts complete a request
      Given an approved request for 10 of "A4 Paper"
      When Wanda receives 4 and later receives 6
      Then the request shows as received

    Scenario: A partial receipt leaves the request open
      Given an approved request for 10 of "A4 Paper"
      When Wanda receives 4
      Then the line shows outstanding 6 and the request is still listed to receive

  @story-F4.3
  Rule: Goods may be received only against an approved request, up to the ordered quantity

    @negative
    Scenario: Over-receiving is refused
      Given an approved request for 10 of "A4 Paper" and "A4 Paper" has stock 5
      When Wanda tries to record a receipt of 11
      Then the stock of "A4 Paper" is still 5

    @negative
    Scenario: A pending request cannot be received
      Given a pending request for 10 of "A4 Paper" and "A4 Paper" has stock 5
      When Wanda tries to record a receipt against it
      Then the stock of "A4 Paper" is still 5

  @story-F4.6
  Rule: A request shows its receipt history

    Scenario: Two receipts listed
      Given Wanda received 4 and later 6 against one request
      When she opens its receipts
      Then she sees both receipts with quantities, her name and the times

  @story-F4.3 @story-F4.6
  Rule: A saved receipt cannot be changed

    @negative
    Scenario: A receipt cannot be deleted
      Given Wanda has saved a receipt of 4 "A4 Paper"
      When she looks for a way to edit or delete it
      Then the stock of "A4 Paper" is unchanged

  @story-F4.1 @story-F4.3
  Rule: Only warehouse clerks receive goods

    @negative
    Scenario: A requester cannot record a receipt
      Given an approved request from Rita for 10 of "A4 Paper" and "A4 Paper" has stock 5
      When Rita tries to record a receipt against it
      Then the stock of "A4 Paper" is still 5
