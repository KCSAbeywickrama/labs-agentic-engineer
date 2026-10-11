Feature: F3 Proposal review

  @story-F3.1
  Rule: A reviewer sees the unscored submitted proposals of events they are assigned to

    Scenario: Review queue
      Given Rita is assigned to an event with two submitted proposals and has scored one
      When she opens her review queue
      Then she sees exactly the one proposal she has not scored

    @negative
    Scenario: Unassigned event
      Given Rita is not assigned to an event that has a submitted proposal
      When she opens her review queue
      Then that proposal is not in it

  @story-F3.2
  Rule: A reviewer scores a proposal from 1 to 5 with an optional comment

    Scenario: Scoring
      Given Rita is assigned to an event with a submitted proposal
      When she scores it 4 with the comment "Clear and timely"
      Then her score for that proposal is 4 and the proposal is under review

    @negative
    Scenario: Score out of range
      Given Rita is assigned to an event with a submitted proposal
      When she scores it 6
      Then the proposal has no scores

  @story-F3.3
  Rule: A reviewer may change a score only until the organizer decides

    Scenario: Changing a score
      Given Rita scored a proposal 3
      When she changes her score to 5
      Then the proposal has exactly one score from Rita and it is 5

    @negative
    Scenario: Changing after a decision
      Given Olivia accepted a proposal that Rita scored 3
      When Rita tries to change her score to 5
      Then Rita's score is still 3

  @story-F3.4
  Rule: An organizer assigns reviewers to an event by username, even before they have ever signed in

    Scenario: Assigning a reviewer
      Given Olivia has an event with a submitted proposal
      When she assigns reviewer Rita to it by username
      Then Rita can see that event's submitted proposal in her review queue

    Scenario: Assigning a reviewer who has never signed in
      Given Olivia has an event with a submitted proposal and Rita has never signed in
      When Olivia assigns Rita to the event by username and Rita then signs in for the first time
      Then Rita sees the submitted proposal in her review queue and can score it

    @negative
    Scenario: Someone not assigned by username or id sees nothing
      Given Olivia has an event with a submitted proposal and has assigned only Rita
      When Kofi opens his review queue
      Then the submitted proposal is not in it

  @story-F3.5
  Rule: An organizer sees proposals with their scores, average and review count, best average first

    Scenario: Ranking
      Given an event has proposal "A" averaging 4.5 from two reviews and proposal "B" averaging 3.0 from one review
      When Olivia opens the event's proposals
      Then "A" is listed before "B" and each shows its average and review count

  @story-F3.6
  Rule: Only an organizer accepts or rejects a proposal

    Scenario: Accepting
      Given a proposal has been scored
      When Olivia accepts it with the comment "Great fit"
      Then the proposal's status is "accepted"

    @negative
    Scenario: Reviewer cannot decide
      Given a proposal has been scored
      When Rita tries to accept it
      Then the proposal's status is unchanged

  @story-F3.7
  Rule: An organizer may reverse a decision, returning the proposal to under review

    Scenario: Reversing
      Given Olivia accepted a proposal
      When she reverses the decision
      Then the proposal's status is "under-review"
