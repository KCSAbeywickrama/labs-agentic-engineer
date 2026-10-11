Feature: F2 Ticket handling

  @story-F2.1
  Rule: A support agent triages an open ticket, which moves it to triaged

    Scenario: Triaging an open ticket
      Given Erin has an open ticket with priority "low"
      When Sam the support agent triages it keeping the priority
      Then the ticket has status "triaged"

    Scenario: Raising the priority during triage
      Given Erin has an open ticket with priority "low"
      When Sam the support agent triages it and sets the priority to "critical"
      Then the ticket has priority "critical" and an earlier SLA due time than before

    @negative
    Scenario: A ticket already in progress cannot be triaged
      Given a ticket is in progress
      When Sam the support agent tries to triage it
      Then the ticket still has status "in progress"

  @story-F2.2
  Rule: A support agent can assign a ticket to herself

    Scenario: Taking an unassigned ticket
      Given Erin has an unassigned ticket
      When Sam the support agent assigns it to herself
      Then the ticket shows Sam as the assignee

  @story-F2.3
  Rule: Only a team lead can assign a ticket to any support agent

    Scenario: The team lead assigns a ticket
      Given Erin has an unassigned ticket and Sam is a support agent
      When Tara the team lead assigns the ticket to Sam
      Then the ticket shows Sam as the assignee

    Scenario: The team lead types a username the help desk has not seen
      Given Erin has an unassigned ticket and Priya has never used the help desk
      When Tara the team lead assigns the ticket by typing Priya's username
      Then the ticket shows Priya's username as the assignee

    Scenario: A typed username binds on the person's first visit
      Given a ticket is assigned by typed username to Priya, who has never used the help desk
      When Priya opens the queue for the first time
      Then the ticket shows Priya's name as the assignee

    @negative
    Scenario: A support agent cannot hand a ticket to another agent
      Given a ticket is assigned to Sam the support agent
      When Sam tries to assign it to another support agent
      Then the ticket still shows Sam as the assignee

  @story-F2.4
  Rule: Work starts only on a triaged ticket assigned to the agent

    Scenario: Starting work
      Given a triaged ticket is assigned to Sam the support agent
      When Sam starts work on it
      Then the ticket has status "in progress"

    @negative
    Scenario: An untriaged ticket cannot be started
      Given an open ticket is assigned to Sam the support agent
      When Sam tries to start work on it
      Then the ticket still has status "open"

  @story-F2.5
  Rule: Only an in-progress ticket can be resolved

    Scenario: Resolving a ticket
      Given a ticket assigned to Sam the support agent is in progress
      When Sam resolves it
      Then the ticket has status "resolved"

    @negative
    Scenario: A triaged ticket cannot be resolved
      Given a triaged ticket is assigned to Sam the support agent
      When Sam tries to resolve it
      Then the ticket still has status "triaged"

  @story-F2.6
  Rule: Only the employee who raised a resolved ticket can reopen it

    Scenario: The requester reopens a resolved ticket
      Given Erin's ticket is resolved
      When Erin reopens it
      Then the ticket has status "reopened"

    @negative
    Scenario: Another employee cannot reopen it
      Given Erin's ticket is resolved
      When Dan the employee tries to reopen it
      Then the ticket still has status "resolved"

    @negative
    Scenario: A ticket that is not resolved cannot be reopened
      Given Erin's ticket is in progress
      When Erin tries to reopen it
      Then the ticket still has status "in progress"

  @story-F2.7
  Rule: A support agent can pick up a reopened ticket

    Scenario: Picking up a reopened ticket
      Given Erin's ticket is reopened and assigned to Sam the support agent
      When Sam starts work on it
      Then the ticket has status "in progress"
