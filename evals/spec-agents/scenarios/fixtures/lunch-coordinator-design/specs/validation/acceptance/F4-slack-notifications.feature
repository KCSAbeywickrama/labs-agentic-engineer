Feature: F4 Slack notifications

  @story-F4.1
  Rule: The team's Slack channel hears when a round opens

    Scenario: Opening a round posts to Slack
      Given no round is open
      When Priya opens a round for "Thai Orchid" with a cutoff of "13:00"
      Then a message is posted to the team's Slack channel about the round for "Thai Orchid" opening

  @story-F4.2
  Rule: The team's Slack channel hears when a round reaches its cutoff

    Scenario: A round closing early posts to Slack
      Given a round is open for "Thai Orchid" with a cutoff of "13:00", opened by Priya
      When Priya closes the round early
      Then a message is posted to the team's Slack channel about the round for "Thai Orchid" closing

    Scenario: A round's cutoff passing posts to Slack
      Given a round is open for "Thai Orchid" with a cutoff of "13:00" and the time is now "13:00"
      When the cutoff passes
      Then a message is posted to the team's Slack channel about the round for "Thai Orchid" closing
