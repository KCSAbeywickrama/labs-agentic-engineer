Feature: F6 Low-stock view

  @story-F6.1
  Rule: The list holds active items strictly below their reorder level

    Scenario: An item below its level is listed
      Given "A4 Paper" has reorder level 20 and stock 5
      When Wanda the warehouse clerk opens the low-stock view
      Then "A4 Paper" is listed

    @negative
    Scenario: An item exactly at its level is not listed
      Given "Stapler" has reorder level 10 and stock 10
      When Wanda opens the low-stock view
      Then "Stapler" is not listed

    @negative
    Scenario: A deactivated item is not listed
      Given "Old Binder" is deactivated with reorder level 10 and stock 0
      When Wanda opens the low-stock view
      Then "Old Binder" is not listed

  @story-F6.2
  Rule: Each listed item shows stock, reorder level and shortfall

    Scenario: Shortfall shown
      Given "A4 Paper" has reorder level 20 and stock 5
      When Wanda opens the low-stock view
      Then "A4 Paper" shows stock 5, reorder level 20 and shortfall 15

  @story-F6.3
  Rule: The list can be sorted by shortfall or by name

    Scenario: Sorting by shortfall
      Given "A4 Paper" has shortfall 15 and "Stapler" has shortfall 2
      When Wanda sorts the low-stock view by shortfall
      Then "A4 Paper" is listed above "Stapler"

  @story-F6.4
  Rule: Requesters see the same low-stock list

    Scenario: Requester sees low stock
      Given "A4 Paper" has reorder level 20 and stock 5
      When Rita the requester opens the low-stock view
      Then "A4 Paper" is listed with shortfall 15

  @story-F6.5
  Rule: A requester starts a purchase request from a low-stock item

    Scenario: Request from the list
      Given "A4 Paper" is in the low-stock view
      When Rita chooses to request "A4 Paper" from the list
      Then a new draft request containing "A4 Paper" is open for her

  @story-F6.1
  Rule: Approvers have no low-stock view

    @negative
    Scenario: An approver cannot open the low-stock view
      Given "A4 Paper" has reorder level 20 and stock 5
      When Alan the approver tries to open the low-stock view
      Then he sees no low-stock items

  @story-F6.1
  Rule: Low stock raises no notification, only the list

    @negative
    Scenario: Falling below the level sends nothing
      Given "A4 Paper" has reorder level 20 and stock 25
      When a receipt-free stock change leaves "A4 Paper" at 5
      Then the only place "A4 Paper" appears as low is the low-stock view
