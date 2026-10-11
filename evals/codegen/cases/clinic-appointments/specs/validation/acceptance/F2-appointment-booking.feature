Feature: F2 Appointment booking

  @story-F2.1 @story-F2.5
  Rule: A slot can be held by only one active appointment

    Scenario: Booking an open slot
      Given Dr. Rao has an open slot tomorrow at "10:00"
      When Pat the patient books that slot
      Then Pat has an appointment with Dr. Rao tomorrow at "10:00"

    @negative
    Scenario: A slot just taken cannot be booked again
      Given Pat the patient has booked Dr. Rao's slot tomorrow at "10:00"
      When Sam the patient tries to book the same slot
      Then Sam has no appointments

  @story-F2.1
  Rule: A patient cannot book a slot that has already started

    @negative
    Scenario: A started slot is refused
      Given Dr. Rao has a slot that started 10 minutes ago
      When Pat the patient tries to book that slot
      Then Pat has no appointments

  @story-F2.1
  Rule: A patient cannot hold two overlapping appointments

    @negative
    Scenario: Overlapping appointments are refused
      Given Pat the patient has an appointment tomorrow from "10:00" to "10:30"
      And Dr. Lee has an open slot tomorrow from "10:15" to "10:45"
      When Pat tries to book Dr. Lee's slot
      Then Pat's appointments number exactly one

  @story-F2.2
  Rule: A patient sees only their own appointments, upcoming and past

    Scenario: Listing own appointments
      Given Pat has one past and one upcoming appointment and Sam has one upcoming appointment
      When Pat views their appointments
      Then exactly Pat's two appointments are listed

  @story-F2.3
  Rule: Rescheduling moves an appointment to another open slot of the same doctor

    Scenario: Rescheduling to another slot
      Given Pat has an appointment with Dr. Rao tomorrow at "10:00" and Dr. Rao has an open slot tomorrow at "11:00"
      When Pat reschedules to the "11:00" slot
      Then Pat's appointment is at "11:00" and the "10:00" slot is open again

    @negative
    Scenario: Rescheduling to a taken slot keeps the original
      Given Pat has an appointment with Dr. Rao tomorrow at "10:00" and Sam holds Dr. Rao's "11:00" slot
      When Pat tries to reschedule to the "11:00" slot
      Then Pat's appointment is still at "10:00"

    @negative
    Scenario: Rescheduling within 2 hours of the start is refused
      Given Pat has an appointment with Dr. Rao starting in 90 minutes and Dr. Rao has another open slot later today
      When Pat tries to reschedule to the later slot
      Then Pat's appointment still starts in 90 minutes

  @story-F2.4
  Rule: A patient may cancel only more than 2 hours before the start

    Scenario: Cancelling in good time reopens the slot
      Given Pat has an appointment with Dr. Rao tomorrow at "10:00"
      When Pat cancels it
      Then Pat has no upcoming appointment and the "10:00" slot is open

    @negative
    Scenario: Cancelling within 2 hours is refused
      Given Pat has an appointment starting in 90 minutes
      When Pat tries to cancel it
      Then the appointment is still booked

  @story-F2.2
  Rule: A patient cannot see or change another patient's appointments

    @negative
    Scenario: Another patient's appointment cannot be cancelled
      Given Sam the patient has an appointment tomorrow at "10:00"
      When Pat tries to cancel Sam's appointment
      Then Sam's appointment is still booked
