Feature: F3 Consolidated order

  @story-F3.1
  Rule: Once the round closes, the opener sees items grouped by description with total quantities

    Scenario: Two teammates order the same dish
      Given a round for "Burrito Bar" has closed, opened by Priya
      And Dinesh added "Burrito Bowl" with quantity 1 and price 11.00
      And Maya added "Burrito Bowl" with quantity 1 and price 11.00
      And Maya added "Chips & Guac" with quantity 1 and price 4.00
      When Priya views the consolidated order for "Burrito Bar"
      Then she sees "Burrito Bowl" with a total quantity of 2
      And she sees "Chips & Guac" with a total quantity of 1

  @story-F3.2
  Rule: Any teammate sees each person's cost total and the round's grand total

    Scenario: Working out who owes what
      Given a round for "Burrito Bar" has closed, opened by Priya
      And Dinesh added "Burrito Bowl" with quantity 1 and price 11.00
      And Maya added "Burrito Bowl" with quantity 1 and price 11.00
      And Maya added "Chips & Guac" with quantity 1 and price 4.00
      When Dinesh views the consolidated order for "Burrito Bar"
      Then he sees Dinesh's total as "$11.00"
      And he sees Maya's total as "$15.00"
      And he sees the grand total as "$26.00"
