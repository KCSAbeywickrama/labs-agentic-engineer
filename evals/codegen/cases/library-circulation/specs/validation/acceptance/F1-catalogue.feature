Feature: F1 Catalogue

  @story-F1.1
  Rule: Any signed-in member may search titles by title, author or subject

    Scenario: Searching by author
      Given the catalogue has a title "Middlemarch" by "George Eliot" and a title "Emma" by "Jane Austen"
      When Maya the member searches for "Eliot"
      Then the results include "Middlemarch"
      And the results do not include "Emma"

    @negative
    Scenario: A search with no match
      Given the catalogue has a title "Middlemarch" by "George Eliot"
      When Maya the member searches for "zzzxq"
      Then the results are empty

  @story-F1.2
  Rule: A title shows its details and how many copies are available

    Scenario: Availability reflects a copy on loan
      Given Leo the librarian has added a title uniquely named for this run with two copies
      And one of the copies is checked out
      When Maya the member opens that title
      Then she sees its author and subject
      And she sees 1 copy available

  @story-F1.3
  Rule: Only a librarian may add, edit and remove titles

    Scenario: Librarian adds a title
      When Leo the librarian adds a title uniquely named for this run by "Jane Austen"
      Then searching for that name finds the title

    @negative
    Scenario: A member cannot add a title
      When Maya the member looks for a way to add a title
      Then the catalogue is unchanged

    @negative
    Scenario: A title with a copy on loan cannot be removed
      Given a title has a copy on loan
      When Leo the librarian removes that title
      Then the title is still in the catalogue

  @story-F1.4
  Rule: Only a librarian may add, edit and withdraw copies, each with a barcode

    Scenario: Adding a copy with a barcode
      Given Leo the librarian has added a title uniquely named for this run
      When Leo adds a copy with a barcode unique to this run
      Then the title has one copy with that barcode

    Scenario: Withdrawing a copy
      Given a title has one available copy
      When Leo the librarian withdraws that copy
      Then the title shows 0 copies available

    @negative
    Scenario: A member cannot add a copy
      Given a title has one available copy
      When Maya the member looks for a way to add a copy
      Then the title still has one copy

  @story-F1.5
  Rule: A librarian sees each copy's status

    Scenario: Status of a copy on the hold shelf
      Given a copy of a title is set aside for a hold
      When Leo the librarian opens the copies of that title
      Then that copy shows the status "on hold shelf"
