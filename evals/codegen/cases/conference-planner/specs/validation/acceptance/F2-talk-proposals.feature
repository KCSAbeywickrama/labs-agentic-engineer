Feature: F2 Talk proposals

  @story-F2.1 @story-F2.5
  Rule: A speaker may submit a proposal only while the event's call for proposals is open

    Scenario: Submitting a proposal
      Given Olivia has opened the call for proposals of an event
      When Sara submits a proposal "Scaling Waitlists" with an abstract, format "talk" and duration 30 minutes
      Then Sara's proposals include "Scaling Waitlists" with status "submitted"

    @negative
    Scenario: Submitting after the call is closed
      Given Olivia has closed the call for proposals of an event
      When Sara tries to submit a proposal
      Then the event has no proposals

  @story-F2.2
  Rule: A speaker sees only their own proposals with their status

    Scenario: Speaker's list
      Given Sara and Sam each submitted one proposal to the same event
      When Sara opens her proposals
      Then she sees exactly one proposal, her own, with its status

  @story-F2.3
  Rule: A speaker may edit or withdraw a proposal only while it is submitted and unreviewed

    Scenario: Editing before review
      Given Sara has a submitted proposal "Scaling Waitlists" with no scores
      When she changes its title to "Fair Waitlists"
      Then her proposal is titled "Fair Waitlists"

    @negative
    Scenario: Editing after a score exists
      Given Sara's proposal has been scored by a reviewer
      When she tries to change its title
      Then the title of her proposal is unchanged

  @story-F2.4
  Rule: A speaker sees the decision and the organizer's comment

    Scenario: Seeing a rejection
      Given Olivia rejected Sara's proposal with the comment "Overlaps another talk"
      When Sara opens her proposals
      Then her proposal shows status "rejected" and the comment "Overlaps another talk"

  @story-F2.6
  Rule: An organizer sees all proposals of an event, filterable by status

    Scenario: Filtering by status
      Given an event has one accepted and two submitted proposals
      When Olivia filters the event's proposals by status "submitted"
      Then she sees exactly two proposals
