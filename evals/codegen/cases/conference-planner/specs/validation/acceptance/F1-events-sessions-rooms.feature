Feature: F1 Events, sessions and rooms

  @story-F1.1
  Rule: Only an organizer may create an event

    Scenario: Organizer creates an event
      Given Olivia is signed in as an organizer
      When she creates an event named uniquely for this run with dates "2027-03-10" to "2027-03-12" and venue "Riverside Hall"
      Then the event appears in the event list with venue "Riverside Hall"

    @negative
    Scenario: Attendee cannot create an event
      Given Dan is signed in as an attendee
      When he tries to create an event
      Then the event list has the same number of events as before

  @story-F1.2
  Rule: Only an organizer may edit or delete an event, and not while it has registrations

    Scenario: Organizer renames an event
      Given Olivia has created an event
      When she renames it to "DevSummit 2027"
      Then the event is shown as "DevSummit 2027"

    @negative
    Scenario: Event with a registration cannot be deleted
      Given Olivia has created an event and Dan is registered for it
      When Olivia deletes the event
      Then the event is still in the event list

  @story-F1.3
  Rule: An organizer defines the rooms of an event with a name and a seating capacity

    Scenario: Adding a room
      Given Olivia has created an event
      When she adds a room "Hall A" with capacity 100
      Then the event shows room "Hall A" with capacity 100

  @story-F1.4
  Rule: A session has a room, times and a capacity that cannot exceed its room's

    Scenario: Adding a session
      Given Olivia has an event with room "Hall A" of capacity 100
      When she adds session "Opening Keynote" in "Hall A" from "09:00" to "10:00" with capacity 80
      Then the event lists "Opening Keynote" in "Hall A" from "09:00" to "10:00"

    @negative
    Scenario: Session capacity above the room's is refused
      Given Olivia has an event with room "Hall A" of capacity 100
      When she adds a session in "Hall A" with capacity 150
      Then the event has no sessions

  @story-F1.5
  Rule: An organizer may edit, move or remove a session

    Scenario: Moving a session to another room
      Given Olivia has a session "Opening Keynote" in "Hall A" and a room "Hall B"
      When she moves the session to "Hall B"
      Then "Opening Keynote" is listed in "Hall B"

    Scenario: Removing a session
      Given Olivia has a session "Opening Keynote"
      When she removes it
      Then the event has no sessions

  @story-F1.6
  Rule: Two sessions may not overlap in the same room

    @negative
    Scenario: Overlapping session is refused
      Given Olivia has a session in "Hall A" from "09:00" to "10:00"
      When she adds another session in "Hall A" from "09:30" to "10:30"
      Then the event has exactly one session

  @story-F1.7
  Rule: An organizer may assign the speaker of an accepted talk to a session

    Scenario: Assigning an accepted talk
      Given Sara's proposal "Scaling Waitlists" was accepted for Olivia's event and the event has a session
      When Olivia assigns the proposal to the session
      Then the session shows Sara as its speaker

  @story-F1.8
  Rule: Attendees see each event's sessions by day with room and time

    Scenario: Browsing sessions
      Given an event has session "Opening Keynote" in "Hall A" on "2027-03-10" at "09:00"
      When Dan opens the event
      Then he sees "Opening Keynote" under "2027-03-10" with room "Hall A" and time "09:00"

  @story-F1.9
  Rule: Speakers see events that are open for proposals

    Scenario: Open event is shown to a speaker
      Given Olivia has opened the call for proposals of an event
      When Sara browses events open for proposals
      Then that event is listed

    @negative
    Scenario: Closed event is not offered
      Given an event's call for proposals is closed
      When Sara browses events open for proposals
      Then that event is not listed
