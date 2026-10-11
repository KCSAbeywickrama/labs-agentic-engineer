Feature: F3 Holds

  @story-F3.1
  Rule: A member may hold a title only when all its copies are unavailable, once per title, up to 5 holds

    Scenario: Placing a hold on an unavailable title
      Given every copy of a title is on loan
      When Maya the member places a hold on that title
      Then Maya has an active hold on that title

    @negative
    Scenario: A hold on a title with an available copy is refused
      Given a title has one available copy
      When Maya the member places a hold on that title
      Then Maya has no hold on that title

    @negative
    Scenario: A second hold on the same title is refused
      Given Maya the member has an active hold on a title whose copies are all on loan
      When Maya places another hold on that title
      Then Maya has exactly one active hold on that title

    @negative
    Scenario: A member cannot exceed 5 active holds
      Given Maya the member has 5 active holds
      When Maya places a hold on a sixth unavailable title
      Then Maya still has 5 active holds

  @story-F3.2
  Rule: A member sees only their own holds with queue position

    Scenario: Position in the queue
      Given Dan the member placed a hold on a title and then Maya the member placed one
      When Maya opens her holds
      Then she sees her hold at position 2
      And she does not see Dan's hold

  @story-F3.3
  Rule: A member may cancel only their own hold

    Scenario: Cancelling a hold
      Given Maya the member has an active hold
      When Maya cancels it
      Then Maya has no active hold on that title

    @negative
    Scenario: Another member's hold cannot be cancelled
      Given Dan the member has an active hold
      When Maya the member tries to cancel Dan's hold
      Then Dan's hold is still active

  @story-F3.4
  Rule: A librarian sees the holds queue for a title, oldest first

    Scenario: Queue order
      Given Dan the member placed a hold on a title and then Maya the member placed one
      When Leo the librarian opens the holds queue for that title
      Then Dan's hold is listed before Maya's

  @story-F3.5
  Rule: A returned copy of a held title is assigned to the first hold in the queue

    Scenario: Assigning a returned copy
      Given Dan the member is first in the queue for a title and its copy has just been checked in
      When Leo the librarian assigns the copy to Dan's hold
      Then Dan's hold is ready for pickup
      And the copy shows the status "on hold shelf"

    @negative
    Scenario: A copy on the hold shelf cannot be lent to someone else
      Given a copy is on the hold shelf for Dan the member
      When Leo the librarian checks that copy out to Maya the member
      Then Maya has no loan on that copy

  @story-F3.6
  Rule: A librarian may cancel a hold on a member's behalf

    Scenario: Cancelling for a member
      Given Maya the member has an active hold
      When Leo the librarian cancels Maya's hold
      Then Maya has no active hold on that title

  @story-F3.7
  Rule: Checking out a held copy to its member fulfils the hold

    Scenario: Pickup
      Given a copy is on the hold shelf for Dan the member
      When Leo the librarian checks the copy out to Dan
      Then Dan has a loan on that copy
      And Dan's hold is fulfilled
