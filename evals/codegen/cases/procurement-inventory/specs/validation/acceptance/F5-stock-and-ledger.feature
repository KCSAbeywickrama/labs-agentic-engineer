Feature: F5 Stock and ledger

  @story-F5.1
  Rule: A clerk sees the stock level of every item, searchable by name or SKU

    Scenario: Searching stock
      Given "A4 Paper" has stock 15 and "Stapler" has stock 3
      When Wanda the warehouse clerk searches stock for "paper"
      Then she sees "A4 Paper" with 15 and not "Stapler"

  @story-F5.1
  Rule: A new item starts at zero stock

    Scenario: A fresh item
      Given Wanda adds a new item named uniquely for this run
      When she opens the stock list
      Then the item shows stock 0

  @story-F5.2
  Rule: An item page shows stock, reorder level and its ledger newest first

    Scenario: Item ledger order
      Given "A4 Paper" received 4 and later 6
      When Wanda opens "A4 Paper"
      Then she sees stock 10, its reorder level and the +6 entry above the +4 entry

  @story-F5.3
  Rule: The full ledger can be filtered by item or date range

    Scenario: Filtering by item
      Given receipts exist for "A4 Paper" and "Stapler"
      When Wanda filters the ledger by "Stapler"
      Then every entry shown is for "Stapler"

  @story-F5.4
  Rule: Each ledger entry shows what changed, the resulting level, when, by whom and from which receipt

    Scenario: Entry details
      Given Wanda received 6 "A4 Paper" bringing stock to 10
      When she opens that ledger entry
      Then it shows item "A4 Paper", change +6, resulting level 10, a time, her name and the receipt

  @story-F5.4
  Rule: Stock equals the sum of ledger entries

    Scenario: Stock matches the ledger
      Given "A4 Paper" has ledger entries +4 and +6
      When Wanda opens the stock list
      Then "A4 Paper" shows stock 10

  @story-F5.2 @story-F5.3 @story-F5.4
  Rule: Ledger entries cannot be edited or deleted

    @negative
    Scenario: No way to alter an entry
      Given "A4 Paper" has a ledger entry of +4
      When Wanda looks for a way to edit or delete it
      Then "A4 Paper" still has stock 4

  @story-F5.5
  Rule: A requester sees stock levels but not the ledger

    Scenario: Requester sees stock
      Given "A4 Paper" has stock 15
      When Rita the requester browses the catalogue
      Then she sees "A4 Paper" with stock 15

    @negative
    Scenario: Requester cannot open the ledger
      Given "A4 Paper" has ledger entries
      When Rita tries to open the ledger
      Then she sees no ledger entries
