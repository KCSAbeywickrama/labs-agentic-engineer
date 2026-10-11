Feature: F1 Availability

  @story-F1.1
  Rule: A doctor publishes slots only in the future and without overlapping their own slots

    Scenario: Publishing a future slot
      Given Dr. Rao has no slots tomorrow
      When Dr. Rao publishes a slot tomorrow from "09:00" to "09:30"
      Then Dr. Rao's slots tomorrow include one open slot from "09:00" to "09:30"

    @negative
    Scenario: A slot in the past is refused
      Given Dr. Rao has no slots yesterday
      When Dr. Rao publishes a slot yesterday from "09:00" to "09:30"
      Then Dr. Rao still has no slots yesterday

    @negative
    Scenario: An overlapping slot is refused
      Given Dr. Rao has an open slot tomorrow from "09:00" to "09:30"
      When Dr. Rao publishes a slot tomorrow from "09:15" to "09:45"
      Then Dr. Rao's slots tomorrow still number exactly one

  @story-F1.2
  Rule: A doctor may publish several slots at once

    Scenario: Publishing a morning of slots
      Given Dr. Rao has no slots the day after tomorrow
      When Dr. Rao publishes slots the day after tomorrow at "09:00", "09:30" and "10:00", each 30 minutes long
      Then Dr. Rao's slots the day after tomorrow number exactly 3

  @story-F1.3
  Rule: A doctor sees whether each of their slots is open or booked

    Scenario: A booked slot shows as booked
      Given Dr. Rao has two slots tomorrow and Pat the patient has booked one
      When Dr. Rao views their slots for tomorrow
      Then one slot is shown as booked and the other as open

  @story-F1.4
  Rule: Only an open slot may be removed by its doctor

    Scenario: Removing an open slot
      Given Dr. Rao has an open slot tomorrow from "11:00" to "11:30"
      When Dr. Rao removes that slot
      Then Dr. Rao's slots tomorrow no longer include it

    @negative
    Scenario: A booked slot cannot be removed
      Given Pat the patient has booked Dr. Rao's slot tomorrow from "11:00" to "11:30"
      When Dr. Rao removes that slot
      Then the slot is still booked

  @story-F1.5
  Rule: A patient browses only open slots

    Scenario: Browsing by doctor and date
      Given Dr. Rao has an open slot and a booked slot tomorrow
      When Pat the patient browses slots for Dr. Rao tomorrow
      Then only the open slot is listed

  @story-F1.6
  Rule: A receptionist browses open slots by doctor and date

    Scenario: Browsing open slots at the front desk
      Given Dr. Rao has an open slot tomorrow from "14:00" to "14:30"
      When Rita the receptionist browses slots for Dr. Rao tomorrow
      Then the slot from "14:00" to "14:30" is listed

  @story-F1.1
  Rule: Only doctors publish slots

    @negative
    Scenario: A patient cannot publish a slot
      Given Pat the patient is signed in
      When Pat tries to publish a slot tomorrow from "09:00" to "09:30"
      Then no slot is added for any doctor
