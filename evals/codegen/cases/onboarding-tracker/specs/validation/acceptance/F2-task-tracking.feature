Feature: F2 Task tracking

  @story-F2.1 @story-F2.2 @story-F2.3
  Rule: A team member sees only the open tasks of their own department, soonest due first

    Scenario: IT member sees IT tasks only
      Given an onboarding has an IT task "Order laptop" due "2026-11-02" and an HR task "Sign contract" due "2026-11-01"
      When Ian the IT team member opens his task list
      Then the list contains "Order laptop"
      And the list does not contain "Sign contract"

    Scenario: Soonest due first
      Given an onboarding has IT tasks "Set up email" due "2026-11-05" and "Order laptop" due "2026-11-02"
      When Ian the IT team member opens his task list
      Then "Order laptop" appears before "Set up email"

    Scenario: Facilities member sees Facilities tasks
      Given an onboarding has a Facilities task "Assign desk" due "2026-11-02"
      When Fiona the facilities team member opens her task list
      Then the list contains "Assign desk"

    Scenario: HR member sees HR tasks
      Given an onboarding has an HR task "Sign contract" due "2026-11-02"
      When Helen the HR team member opens her task list
      Then the list contains "Sign contract"

  @story-F2.4 @story-F2.5
  Rule: Only a team member of the task's department may mark it done or reopen it

    Scenario: Marking done records the date
      Given an IT task "Order laptop" is open
      When Ian the IT team member marks "Order laptop" done
      Then "Order laptop" is done with today's date as completion date

    Scenario: Reopening
      Given Ian has marked the IT task "Order laptop" done
      When Ian reopens "Order laptop"
      Then "Order laptop" is open

    @negative
    Scenario: Another department cannot complete it
      Given an IT task "Order laptop" is open
      When Helen the HR team member tries to mark "Order laptop" done
      Then "Order laptop" is still open

  @story-F2.6
  Rule: Only a team member of the task's department may add notes to it

    Scenario: Adding a note
      Given an IT task "Order laptop" is open
      When Ian adds the note "Ordered, arrives Friday" to "Order laptop"
      Then "Order laptop" shows the note "Ordered, arrives Friday"

    @negative
    Scenario: Another department cannot add a note
      Given an IT task "Order laptop" is open
      When Helen the HR team member tries to add the note "Hello" to "Order laptop"
      Then "Order laptop" has no notes

  @story-F2.7
  Rule: The coordinator sees one new hire's tasks grouped by department with counts

    Scenario: Counts per department
      Given an onboarding has two IT tasks of which one is done, and one open HR task
      When Hana the HR coordinator opens that onboarding
      Then IT shows 1 done and 1 open
      And HR shows 0 done and 1 open

  @story-F2.8
  Rule: The coordinator can filter all tasks by department, status and new hire

    Scenario: Filter by department and status
      Given tasks exist for IT and HR, some done and some open
      When Hana filters the tasks by department "IT" and status "open"
      Then every listed task is an open IT task
