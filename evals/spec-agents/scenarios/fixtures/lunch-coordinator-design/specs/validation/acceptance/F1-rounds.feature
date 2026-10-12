Feature: F1 Rounds

  @story-F1.1
  Rule: Only one round may be open at a time

    @negative
    Scenario: A second round is refused while one is open
      Given a round is open for "Thai Orchid" with a cutoff of "13:00"
      When Priya tries to open a round for "Burrito Bar" with a cutoff of "14:00"
      Then she is told a round is already open
      And the round for "Thai Orchid" is still the open round

  @story-F1.1
  Rule: A teammate opens a round by naming a restaurant and a cutoff

    Scenario: Opening today's round
      Given no round is open
      When Priya opens a round for "Thai Orchid" with a cutoff of "13:00" and notes "Ask for extra chili"
      Then a round for "Thai Orchid" is open with a cutoff of "13:00" and notes "Ask for extra chili"

    @negative
    Scenario: A cutoff in the past is rejected
      Given no round is open and the time is "12:00"
      When Priya tries to open a round for "Thai Orchid" with a cutoff of "09:00"
      Then she is told the cutoff must be later than now
      And no round is open

  @story-F1.2
  Rule: Any teammate sees the open round's restaurant, cutoff and items

    Scenario: Dinesh checks the open round
      Given a round is open for "Thai Orchid" with a cutoff of "13:00"
      And Priya has added "Pad Thai" with quantity 1 and price 12.00 to it
      When Dinesh views today's round
      Then he sees the restaurant "Thai Orchid", the cutoff "13:00" and "Pad Thai" added by "Priya"

  @story-F1.3
  Rule: A round closes by itself once its cutoff passes

    Scenario: The cutoff passes with nobody closing the round
      Given a round is open for "Thai Orchid" with a cutoff of "13:00" and the time is now "13:00"
      When Dinesh views today's round
      Then the round for "Thai Orchid" is closed

    @negative
    Scenario: Nobody can add an item once the cutoff has passed
      Given a round is open for "Thai Orchid" with a cutoff of "13:00" and the time is now "13:00"
      When Dinesh tries to add "Green Curry" with quantity 1 and price 14.00 to it
      Then he is told the round is closed
      And the round for "Thai Orchid" has no items

  @story-F1.4
  Rule: Only the opener may close their round early

    Scenario: The opener closes the round before its cutoff
      Given a round is open for "Thai Orchid" with a cutoff of "13:00", opened by Priya
      When Priya closes the round early
      Then the round for "Thai Orchid" is closed

    @negative
    Scenario: A teammate who did not open the round cannot close it
      Given a round is open for "Thai Orchid" with a cutoff of "13:00", opened by Priya
      When Dinesh tries to close the round early
      Then he is told he cannot close it
      And the round for "Thai Orchid" is still open

  @story-F1.5
  Rule: Any teammate looks back at past rounds

    Scenario: Looking back at a closed round
      Given a round for "Burrito Bar" closed yesterday with items from Dinesh and Maya
      When Priya opens past rounds
      Then she sees "Burrito Bar" among the past rounds

    Scenario: No past rounds yet
      Given no round has ever closed
      When Priya opens past rounds
      Then she sees no past rounds listed
