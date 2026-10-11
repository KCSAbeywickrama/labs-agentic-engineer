Feature: F1 Raise and track tickets

  @story-F1.1 @story-F1.2
  Rule: An employee can raise a ticket, which starts open and unassigned with an SLA due time

    Scenario: Raising a ticket
      Given Erin the employee is signed in
      When Erin raises a ticket titled uniquely for this run with description "Laptop will not boot", category "hardware" and priority "high"
      Then the ticket is open, has no assignee and shows an SLA due time

    @negative
    Scenario: A ticket without a title is not created
      Given Erin the employee is signed in
      When Erin tries to raise a ticket with an empty title
      Then Erin has no more tickets than before

  @story-F1.2
  Rule: The SLA due time depends on the ticket's priority

    Scenario: A critical ticket is due before a low one
      Given Erin the employee has raised a ticket with priority "low"
      When Erin raises a ticket with priority "critical"
      Then the SLA due time of the new ticket is earlier than that of the low ticket

  @story-F1.3
  Rule: An employee sees only their own tickets, with status and SLA due time

    Scenario: Erin's list shows her tickets with status and due time
      Given Erin the employee has raised a ticket titled uniquely for this run
      When Erin opens her ticket list
      Then that ticket is listed with status "open" and an SLA due time

    @negative
    Scenario: Another employee's ticket is not listed
      Given Dan the employee has raised a ticket titled uniquely for this run
      When Erin the employee opens her ticket list
      Then Dan's ticket is not in the list

  @story-F1.4
  Rule: An employee can open their own ticket to see its details, status and assignee

    Scenario: Viewing an assigned ticket
      Given Erin's ticket is assigned to Sam the support agent
      When Erin opens the ticket
      Then she sees its description, its status and Sam as the assignee

    @negative
    Scenario: Another employee's ticket cannot be opened
      Given Dan the employee has raised a ticket titled uniquely for this run
      When Erin the employee tries to open Dan's ticket
      Then Erin does not see the ticket's details

  @story-F1.5
  Rule: An employee can edit their own ticket only until it is triaged

    Scenario: Editing an open ticket
      Given Erin has an open ticket titled uniquely for this run
      When Erin changes its priority to "critical"
      Then the ticket has priority "critical" and an earlier SLA due time than before

    @negative
    Scenario: A triaged ticket cannot be edited
      Given Erin has a ticket titled "Printer jam" that Sam the support agent has triaged
      When Erin tries to change its title to "Printer broken"
      Then the ticket is still titled "Printer jam"
