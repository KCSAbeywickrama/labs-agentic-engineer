Feature: F1 Catalogue

  @story-F1.1
  Rule: A warehouse clerk adds items to the catalogue

    Scenario: Adding an item
      Given Wanda the warehouse clerk is signed in
      When she adds an item with a SKU unique to this run, name "A4 Paper", unit "ream" and reorder level 20
      Then "A4 Paper" appears in the catalogue with a reorder level of 20

    @negative
    Scenario: A duplicate SKU is refused
      Given the catalogue holds an item with a SKU unique to this run
      When Wanda adds another item with the same SKU
      Then the catalogue still holds exactly one item with that SKU

  @story-F1.2
  Rule: A warehouse clerk edits an item's name, unit and reorder level but never its SKU

    Scenario: Changing a reorder level
      Given the catalogue holds "A4 Paper" with a reorder level of 20
      When Wanda changes its reorder level to 30
      Then "A4 Paper" shows a reorder level of 30

    @negative
    Scenario: The SKU cannot be changed
      Given the catalogue holds "A4 Paper" with a known SKU
      When Wanda tries to change its SKU
      Then the SKU of "A4 Paper" is unchanged

  @story-F1.3
  Rule: A deactivated item can no longer be requested

    Scenario: Deactivating an item
      Given the catalogue holds the active item "Stapler"
      When Wanda deactivates "Stapler"
      Then Rita the requester does not find "Stapler" when browsing the catalogue

    @negative
    Scenario: A deactivated item cannot be put on a request
      Given "Stapler" is deactivated
      When Rita tries to create a request for 2 of "Stapler"
      Then Rita has no new request

  @story-F1.4
  Rule: A requester browses and searches active items

    Scenario: Searching by name
      Given the catalogue holds active items "A4 Paper" and "Stapler"
      When Rita searches for "paper"
      Then she sees "A4 Paper" and not "Stapler"

  @story-F1.5 @story-F1.6
  Rule: Items show a unit of measure and a unit price set by a clerk

    Scenario: A price set by a clerk is visible to requesters
      Given the catalogue holds "A4 Paper" with unit "ream"
      When Wanda sets the unit price of "A4 Paper" to 4.50
      Then Rita sees "A4 Paper" with unit "ream" and price 4.50

  @story-F1.1 @story-F1.2 @story-F1.3 @story-F1.6
  Rule: Only warehouse clerks maintain the catalogue

    @negative
    Scenario: A requester cannot add an item
      Given Rita the requester is signed in
      When she tries to add an item named "Laptop"
      Then the catalogue does not contain "Laptop"
