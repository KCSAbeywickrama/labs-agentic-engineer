Feature: F3 Overdue reminders

  @story-F3.1 @story-F3.2
  Rule: A team member sees their department's overdue tasks highlighted, counted and with days overdue

    Scenario: Overdue task is flagged
      Given an IT task "Order laptop" was due 3 days ago and is open
      When Ian the IT team member opens his landing page
      Then "Order laptop" is highlighted as overdue by 3 days
      And the overdue count includes it

    @negative
    Scenario: Another department's overdue task is not shown
      Given an HR task "Sign contract" was due 3 days ago and is open
      When Ian the IT team member opens his landing page
      Then "Sign contract" is not listed

    @negative
    Scenario: A task due today is not overdue
      Given an IT task "Order laptop" is due today and is open
      When Ian opens his landing page
      Then "Order laptop" is not flagged overdue

  @story-F3.3
  Rule: The coordinator sees all overdue tasks across departments, most overdue first

    Scenario: Overdue list order
      Given an open IT task "A" is 5 days overdue and an open HR task "B" is 2 days overdue
      When Hana the HR coordinator opens the overdue tasks list
      Then "A" appears before "B"

    @negative
    Scenario: Done tasks are not overdue
      Given an IT task "Order laptop" was due 3 days ago and is done
      When Hana opens the overdue tasks list
      Then "Order laptop" is not listed

  @story-F3.4
  Rule: The onboardings list flags new hires with overdue tasks

    Scenario: Flag on a new hire
      Given the onboarding for "Maya Perera" has an open task 2 days overdue
      When Hana opens the onboardings list
      Then the entry for "Maya Perera" is flagged with 1 overdue task

  @story-F3.5
  Rule: Open tasks due within the next 2 days are marked due soon

    Scenario: Due soon marker
      Given an open IT task "Order laptop" is due in 2 days
      When Ian opens his landing page
      Then "Order laptop" is marked due soon

    @negative
    Scenario: Due in 5 days is not due soon
      Given an open IT task "Order laptop" is due in 5 days
      When Ian opens his landing page
      Then "Order laptop" is not marked due soon

  @story-F3.6
  Rule: Marking a task done removes its reminder at once

    Scenario: Reminder disappears
      Given an IT task "Order laptop" was due 3 days ago and is open
      When Ian marks "Order laptop" done
      Then "Order laptop" is not flagged overdue and the overdue count excludes it
