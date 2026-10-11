Feature: F4 Queue and SLA monitoring

  @story-F4.1 @story-F4.2
  Rule: Support agents and team leads see every ticket in one queue

    Scenario: A support agent sees tickets of several employees
      Given Erin and Dan the employees have each raised a ticket titled uniquely for this run
      When Sam the support agent opens the queue
      Then both tickets are listed with status, priority, assignee and SLA due time

    Scenario: A team lead sees the same queue
      Given Erin and Dan the employees have each raised a ticket titled uniquely for this run
      When Tara the team lead opens the queue
      Then both tickets are listed

  @story-F4.8
  Rule: The queue shows which tickets have breached their SLA

    Scenario: An overdue ticket is marked as breached
      Given an unresolved ticket whose SLA due time has passed
      When Sam the support agent opens the queue
      Then that ticket is marked as breached

  @story-F4.3
  Rule: The queue can be filtered by status

    Scenario: Filtering by resolved
      Given one ticket is resolved and another is open
      When Sam the support agent filters the queue by status "resolved"
      Then every listed ticket has status "resolved" and the open ticket is not listed

  @story-F4.4
  Rule: The queue can be filtered by priority

    Scenario: Filtering by critical
      Given one ticket has priority "critical" and another has priority "low"
      When Sam the support agent filters the queue by priority "critical"
      Then every listed ticket has priority "critical" and the low ticket is not listed

  @story-F4.5
  Rule: The queue can be filtered by assignee, including unassigned tickets

    Scenario: Filtering by an assignee
      Given one ticket is assigned to Sam and another to Priya, both support agents
      When Sam filters the queue by assignee Sam
      Then every listed ticket is assigned to Sam

    Scenario: Filtering for unassigned tickets
      Given one ticket is assigned to Sam and another is unassigned
      When Sam filters the queue by unassigned
      Then every listed ticket has no assignee

    @negative
    Scenario: A ticket assigned to a not-yet-seen username is not unassigned
      Given a ticket is assigned by typed username to Priya, who has never used the help desk
      When Sam filters the queue by unassigned
      Then that ticket is not listed

  @story-F4.6
  Rule: A team lead can filter the queue to tickets that breached their SLA

    Scenario: Only breached tickets are shown
      Given one unresolved ticket is past its SLA due time and another is not
      When Tara the team lead filters the queue by SLA breach
      Then every listed ticket is past its SLA due time and the other ticket is not listed

    @negative
    Scenario: A resolved ticket past its due time is not a breach
      Given a resolved ticket whose SLA due time has passed
      When Tara the team lead filters the queue by SLA breach
      Then that ticket is not listed

  @story-F4.7
  Rule: Queue filters can be combined

    Scenario: Breached tickets of one assignee
      Given Sam has one ticket past its SLA due time and one within it, and Priya has one past its due time
      When Tara the team lead filters the queue by SLA breach and assignee Sam
      Then exactly one ticket is listed and it is assigned to Sam and past its due time
