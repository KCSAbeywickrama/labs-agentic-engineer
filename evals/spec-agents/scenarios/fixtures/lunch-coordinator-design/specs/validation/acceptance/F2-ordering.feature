Feature: F2 Ordering

  @story-F2.1
  Rule: A teammate adds items to the open round before its cutoff

    Scenario: Adding an item
      Given a round is open for "Thai Orchid" with a cutoff of "13:00"
      When Priya adds "Pad Thai" with quantity 1 and price 12.00 to it
      Then the round for "Thai Orchid" has "Pad Thai" added by "Priya" with quantity 1 and price 12.00

    @negative
    Scenario: A non-positive quantity is refused
      Given a round is open for "Thai Orchid" with a cutoff of "13:00"
      When Priya tries to add "Pad Thai" with quantity 0 and price 12.00 to it
      Then she is told the quantity must be greater than zero
      And the round for "Thai Orchid" has no items

    @negative
    Scenario: A non-positive price is refused
      Given a round is open for "Thai Orchid" with a cutoff of "13:00"
      When Priya tries to add "Pad Thai" with quantity 1 and price 0.00 to it
      Then she is told the price must be greater than zero
      And the round for "Thai Orchid" has no items

  @story-F2.2
  Rule: A teammate edits or removes their own items while the round is open

    Scenario: Changing the quantity of my own item
      Given Priya has added "Pad Thai" with quantity 1 and price 12.00 to the open round for "Thai Orchid"
      When Priya changes "Pad Thai" to quantity 2
      Then "Pad Thai" in the round for "Thai Orchid" has quantity 2

    Scenario: Removing my own item
      Given Priya has added "Pad Thai" with quantity 1 and price 12.00 to the open round for "Thai Orchid"
      When Priya removes "Pad Thai"
      Then the round for "Thai Orchid" has no items

    @negative
    Scenario: A teammate cannot edit another teammate's item
      Given Priya has added "Pad Thai" with quantity 1 and price 12.00 to the open round for "Thai Orchid"
      When Dinesh tries to change "Pad Thai" to quantity 5
      Then he is told he cannot change it
      And "Pad Thai" in the round for "Thai Orchid" still has quantity 1

    @negative
    Scenario: A teammate cannot remove another teammate's item
      Given Priya has added "Pad Thai" with quantity 1 and price 12.00 to the open round for "Thai Orchid"
      When Dinesh tries to remove "Pad Thai"
      Then he is told he cannot remove it
      And the round for "Thai Orchid" still has "Pad Thai"
