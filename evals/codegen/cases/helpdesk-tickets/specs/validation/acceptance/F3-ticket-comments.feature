Feature: F3 Ticket comments

  @story-F3.1 @story-F3.4
  Rule: An employee can comment on and read the thread of their own ticket

    Scenario: Erin comments on her ticket
      Given Erin the employee has raised a ticket titled uniquely for this run
      When Erin comments "Still happening after restart"
      Then the thread shows "Still happening after restart" with Erin as author and a time

    Scenario: The thread is oldest first
      Given Erin's ticket has comments "First note" then "Second note"
      When Erin opens the thread
      Then "First note" appears before "Second note"

    @negative
    Scenario: Another employee cannot comment on Erin's ticket
      Given Erin's ticket has no comments
      When Dan the employee tries to comment on it
      Then the thread of Erin's ticket still has no comments

  @story-F3.2 @story-F3.5
  Rule: A support agent can read and comment on any ticket

    Scenario: Sam comments on Erin's ticket
      Given Erin has raised a ticket titled uniquely for this run
      When Sam the support agent comments "Please send the asset tag"
      Then the thread shows "Please send the asset tag" with Sam as author

    Scenario: Sam reads the thread
      Given Erin's ticket has a comment "Still happening after restart"
      When Sam the support agent opens the thread
      Then it shows "Still happening after restart"

  @story-F3.3
  Rule: A team lead can comment on any ticket

    Scenario: Tara comments on Erin's ticket
      Given Erin has raised a ticket titled uniquely for this run
      When Tara the team lead comments "Escalating to the network team"
      Then the thread shows "Escalating to the network team" with Tara as author
