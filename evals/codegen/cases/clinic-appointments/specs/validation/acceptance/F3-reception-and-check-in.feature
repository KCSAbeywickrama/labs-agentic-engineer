Feature: F3 Reception and check-in

  @story-F3.1
  Rule: A receptionist finds patients by name or phone number

    Scenario: Finding a patient by phone
      Given a patient "Pat Jones" with phone "555-0101" is registered
      When Rita the receptionist searches for "555-0101"
      Then "Pat Jones" is listed

  @story-F3.7
  Rule: A receptionist registers a patient who has no account

    Scenario: Registering a walk-in patient
      Given no patient named uniquely for this run exists
      When Rita registers that patient with phone "555-0102"
      Then searching for that name finds exactly one patient

  @story-F3.2
  Rule: Receptionists book under the same no-double-booking rule as patients

    Scenario: Booking for a patient
      Given Dr. Rao has an open slot tomorrow at "10:00"
      When Rita books that slot for Pat Jones
      Then Pat Jones has an appointment with Dr. Rao tomorrow at "10:00"

    @negative
    Scenario: A taken slot cannot be booked
      Given Sam holds Dr. Rao's slot tomorrow at "10:00"
      When Rita tries to book that slot for Pat Jones
      Then Pat Jones has no appointments

  @story-F3.3
  Rule: A receptionist reschedules to another open slot of the same doctor

    Scenario: Rescheduling at the desk
      Given Pat Jones has an appointment with Dr. Rao tomorrow at "10:00" and Dr. Rao has an open slot at "11:00"
      When Rita reschedules it to the "11:00" slot
      Then Pat Jones's appointment is at "11:00"

  @story-F3.4
  Rule: Receptionists may cancel only more than 2 hours before the start, with no override

    Scenario: Cancelling in good time
      Given Pat Jones has an appointment tomorrow at "10:00"
      When Rita cancels it
      Then the appointment is cancelled and the slot is open

    @negative
    Scenario: Cancelling within 2 hours is refused
      Given Pat Jones has an appointment starting in 90 minutes
      When Rita tries to cancel it
      Then the appointment is still booked

  @story-F3.5
  Rule: A receptionist sees the day's appointments for a doctor or the whole clinic

    Scenario: Whole-clinic day view
      Given Dr. Rao and Dr. Lee each have an appointment today
      When Rita views today's appointments for the whole clinic
      Then both appointments are listed

  @story-F3.6
  Rule: Check-in applies only to a booked appointment on its own day, and can be undone

    Scenario: Checking in today's appointment
      Given Pat Jones has a booked appointment later today
      When Rita checks Pat in
      Then the appointment is shown as checked in

    @negative
    Scenario: Checking in tomorrow's appointment is refused
      Given Pat Jones has a booked appointment tomorrow
      When Rita tries to check Pat in
      Then the appointment is not checked in

    Scenario: Undoing a mistaken check-in
      Given Pat Jones is checked in for an appointment today
      When Rita undoes the check-in
      Then the appointment is shown as booked

  @story-F3.2
  Rule: Only receptionists book for other patients

    @negative
    Scenario: A patient cannot check anyone in
      Given Pat has a booked appointment later today
      When Pat tries to check in
      Then the appointment is not checked in
