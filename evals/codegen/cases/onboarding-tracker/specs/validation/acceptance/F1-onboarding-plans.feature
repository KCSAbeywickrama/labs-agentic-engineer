Feature: F1 Onboarding plans

  @story-F1.1
  Rule: An HR coordinator starts an onboarding with name, role and start date

    Scenario: Starting an onboarding
      Given Hana the HR coordinator is signed in
      When Hana starts an onboarding for "Maya Perera", role "Support Engineer", starting "2026-11-02"
      Then the onboardings list contains an onboarding for "Maya Perera" starting "2026-11-02"

    @negative
    Scenario: A start date is required
      Given Hana the HR coordinator is signed in
      When Hana tries to start an onboarding for "Maya Perera" with no start date
      Then no onboarding for "Maya Perera" is added

  @story-F1.2
  Rule: The coordinator sees all onboardings with start date and progress

    Scenario: Progress in the list
      Given Hana has started an onboarding for "Maya Perera" and one of its tasks is done
      When Hana opens the onboardings list
      Then the entry for "Maya Perera" shows its start date and one task done

  @story-F1.3
  Rule: A new onboarding receives the default tasks for IT, HR and Facilities

    Scenario: Default tasks are seeded
      Given Hana the HR coordinator is signed in
      When Hana starts an onboarding for a new hire named uniquely for this run
      Then the onboarding has tasks for IT, for HR and for Facilities

  @story-F1.4 @story-F1.5 @story-F1.6
  Rule: The coordinator can add, edit and remove tasks with a department, due date and description

    Scenario: Adding a task
      Given Hana has started a new onboarding
      When Hana adds an IT task "Order second monitor" due "2026-11-03" described as "Dual-screen setup"
      Then the onboarding has an IT task "Order second monitor" due "2026-11-03"

    Scenario: Removing a task
      Given Hana has started a new onboarding with a task "Order second monitor"
      When Hana removes the task "Order second monitor"
      Then the onboarding has no task "Order second monitor"

    @negative
    Scenario: A task needs a due date
      Given Hana has started a new onboarding
      When Hana tries to add an HR task "Sign contract" with no due date
      Then the onboarding has no task "Sign contract"

    @negative
    Scenario: A team member cannot add tasks
      Given Ian the IT team member is signed in and an onboarding exists
      When Ian tries to add a task "Extra task" to that onboarding
      Then the onboarding has no task "Extra task"

  @story-F1.7
  Rule: The coordinator can close or cancel an onboarding

    Scenario: Cancelling an onboarding
      Given Hana has started a new onboarding
      When Hana cancels that onboarding
      Then the onboarding is shown as cancelled
