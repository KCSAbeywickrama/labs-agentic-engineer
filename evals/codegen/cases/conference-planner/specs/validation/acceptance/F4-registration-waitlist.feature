Feature: F4 Registration and waitlist

  @story-F4.1
  Rule: An attendee gets a confirmed seat in an event while seats remain

    Scenario: Registering with seats free
      Given an event with capacity 2 and no registrations
      When Dan registers for the event
      Then Dan's registration for the event is "confirmed"

  @story-F4.2
  Rule: An attendee may register for a session only of an event they are registered for

    Scenario: Registering for a session
      Given Dan has a confirmed registration for an event that has a session with capacity 10
      When he registers for the session
      Then Dan's registration for the session is "confirmed"

    @negative
    Scenario: Not registered for the event
      Given Eve has no registration for an event that has a session
      When she registers for the session
      Then Eve has no registrations

  @story-F4.3
  Rule: A full event or session puts the next attendee at the end of the waitlist

    @negative
    Scenario: Registering when full
      Given an event with capacity 1 where Dan holds the confirmed seat
      When Eve registers for the event
      Then Eve's registration is "waitlisted" and the event has exactly one confirmed seat

  @story-F4.4
  Rule: An attendee sees each registration's status and waitlist position

    Scenario: Waitlist position
      Given an event with capacity 1 where Dan is confirmed, Eve is waitlisted first and Finn second
      When Finn opens his registrations
      Then he sees "waitlisted" with position 2

  @story-F4.5
  Rule: An attendee may cancel a registration or leave a waitlist, and cancelling an event registration cancels its session registrations

    Scenario: Leaving the waitlist
      Given Eve is waitlisted for an event
      When she cancels her registration
      Then Eve has no registration for the event

    Scenario: Cancelling the event cancels its sessions
      Given Dan is confirmed for an event and one of its sessions
      When he cancels his event registration
      Then Dan has no registrations for that event or its sessions

  @story-F4.6
  Rule: When a seat frees up, the next waitlisted attendee is promoted automatically

    Scenario: Promotion on cancellation
      Given an event with capacity 1 where Dan is confirmed and Eve is waitlisted first
      When Dan cancels his registration
      Then Eve's registration is "confirmed"

    @negative
    Scenario: Capacity is never exceeded
      Given an event with capacity 1 where Dan is confirmed and Eve and Finn are waitlisted
      When Dan cancels his registration
      Then exactly one registration for the event is "confirmed" and one is "waitlisted"

  @story-F4.7
  Rule: An organizer sees registrations and the waitlist with seats taken against capacity

    Scenario: Seat overview
      Given an event with capacity 2 where Dan and Eve are confirmed and Finn is waitlisted
      When Olivia opens the event's registrations
      Then she sees 2 of 2 seats taken and Finn on the waitlist

  @story-F4.8
  Rule: An organizer may remove an attendee's registration, freeing the seat

    Scenario: Removing a registration
      Given an event with capacity 1 where Dan is confirmed and Eve is waitlisted
      When Olivia removes Dan's registration
      Then Eve's registration is "confirmed"

  @story-F4.9
  Rule: Raising a capacity promotes waitlisted attendees, and a capacity cannot drop below the confirmed count

    Scenario: Raising capacity
      Given an event with capacity 1 where Dan is confirmed and Eve and Finn are waitlisted
      When Olivia raises the capacity to 2
      Then Eve's registration is "confirmed" and Finn is still "waitlisted"

    @negative
    Scenario: Lowering capacity below confirmed
      Given an event with capacity 2 where Dan and Eve are confirmed
      When Olivia lowers the capacity to 1
      Then the event's capacity is still 2
