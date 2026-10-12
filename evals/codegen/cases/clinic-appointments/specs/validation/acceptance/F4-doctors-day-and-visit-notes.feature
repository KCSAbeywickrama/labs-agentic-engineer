Feature: F4 Doctor's day and visit notes

  @story-F4.1
  Rule: A doctor sees only their own appointments for the day, in time order, with check-in state

    Scenario: Viewing today
      Given Dr. Rao has appointments today at "09:00" and "10:00", the first checked in, and Dr. Lee has one today
      When Dr. Rao opens their day
      Then the "09:00" appointment appears first as checked in and the "10:00" one second as not checked in
      And Dr. Lee's appointment is not listed

  @story-F4.2
  Rule: A doctor may view any other day

    Scenario: Viewing tomorrow
      Given Dr. Rao has an appointment tomorrow at "09:00"
      When Dr. Rao views tomorrow
      Then the "09:00" appointment is listed

  @story-F4.3 @story-F4.4
  Rule: A doctor writes and reads notes on their own appointments

    Scenario: Writing a note on a checked-in appointment
      Given Pat Jones is checked in for an appointment with Dr. Rao
      When Dr. Rao writes the note "Mild fever, rest advised"
      Then Dr. Rao reads that note on the appointment

    @negative
    Scenario: Another doctor's appointment cannot be annotated
      Given Pat Jones has an appointment with Dr. Lee
      When Dr. Rao tries to write a note on it
      Then that appointment has no notes

  @story-F4.5
  Rule: A doctor edits only a note they wrote

    Scenario: Editing own note
      Given Dr. Rao wrote the note "Mild fever"
      When Dr. Rao changes it to "Mild fever, rest advised"
      Then the note reads "Mild fever, rest advised"

    @negative
    Scenario: Another doctor cannot edit it
      Given Dr. Rao wrote the note "Mild fever"
      When Dr. Lee tries to change it to "Healthy"
      Then the note still reads "Mild fever"

  @story-F4.6
  Rule: A doctor sees a patient's earlier notes

    Scenario: Earlier notes from another doctor
      Given Dr. Lee wrote the note "Allergic to penicillin" on an earlier appointment of Pat Jones
      When Dr. Rao views Pat Jones's earlier notes
      Then "Allergic to penicillin" is listed

  @story-F4.3 @story-F4.4
  Rule: Only doctors can read or write visit notes

    @negative
    Scenario: A receptionist cannot read notes
      Given Dr. Rao wrote the note "Mild fever" on an appointment of Pat Jones
      When Rita the receptionist tries to read Pat Jones's notes
      Then no note text is shown to Rita

    @negative
    Scenario: A patient cannot read notes
      Given Dr. Rao wrote the note "Mild fever" on an appointment of Pat Jones
      When Pat the patient tries to read their notes
      Then no note text is shown to Pat
