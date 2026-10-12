Feature: F2 Approvals

  @story-F2.1
  Rule: An approver sees every submitted claim in one queue, oldest first

    Scenario: Dinesh sees the queue ordered oldest first
      Given a claim from Ana was submitted on "2026-01-09" and a claim from Ravi was submitted on "2026-01-13"
      When Dinesh the Approver opens the approval queue
      Then Ana's claim appears above Ravi's claim

    Scenario: A decided claim does not appear in the queue
      Given Maya's claim for "Conference ticket" has already been approved
      When Dinesh the Approver opens the approval queue
      Then "Conference ticket" is not in the queue

  @story-F2.2
  Rule: An approver approves a submitted claim

    Scenario: Dinesh approves a claim
      Given a submitted claim from Ravi for "Hotel stay"
      When Dinesh the Approver approves it
      Then the claim's status is "Approved" and it leaves the queue

  @story-F2.3
  Rule: An approver rejects a submitted claim with a reason

    Scenario: Dinesh rejects a claim with a reason
      Given a submitted claim from Ana for "Software license"
      When Dinesh the Approver rejects it with the reason "Needs a manager's pre-approval"
      Then the claim's status is "Rejected" with reason "Needs a manager's pre-approval" and it leaves the queue

    @negative
    Scenario: A rejection with no reason is refused
      Given a submitted claim from Ana for "Software license"
      When Dinesh the Approver tries to reject it with an empty reason
      Then the claim's status is still "Submitted"

  @story-F2.2 @story-F2.3
  Rule: A decision is final

    @negative
    Scenario: An already-approved claim cannot be approved again
      Given Maya's claim for "Conference ticket" has already been approved
      When Dinesh the Approver tries to approve it again
      Then the claim's status is still "Approved"

    @negative
    Scenario: An already-rejected claim cannot be rejected again
      Given Maya's claim for "Team lunch" has already been rejected with reason "Receipts were not itemized per person."
      When Dinesh the Approver tries to reject it again with the reason "Different reason"
      Then the claim's reason is still "Receipts were not itemized per person."
