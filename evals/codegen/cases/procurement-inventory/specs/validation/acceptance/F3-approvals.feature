Feature: F3 Approvals

  @story-F3.1
  Rule: An approver sees only pending requests within her approval limit, oldest first

    Scenario: Requests above the limit are not listed
      Given Alan the approver has an approval limit of 100.00
      And pending requests of 60.00 and 500.00 exist
      When Alan opens his pending list
      Then he sees the 60.00 request and not the 500.00 request

    Scenario: An approver without an override has the default limit
      Given Alan the approver has no personal limit override
      And pending requests of 4999.00 and 5001.00 exist
      When Alan opens his pending list
      Then he sees the 4999.00 request and not the 5001.00 request

    Scenario: Oldest first
      Given Alan's limit covers two pending requests submitted at different times
      When he opens his pending list
      Then the earlier request is listed first

  @story-F3.2
  Rule: An approver sees the full request before deciding

    Scenario: Opening a request
      Given a pending request from Rita for 10 of "A4 Paper" with justification "Office restock"
      When Alan opens it
      Then he sees the line, quantity, price, total, requester Rita and "Office restock"

  @story-F3.3
  Rule: An approver may approve only a pending request within her limit

    Scenario: Approving a request within the limit
      Given Alan's limit is 100.00 and a pending request totals 60.00
      When he approves it
      Then the request shows as approved

    @negative
    Scenario: A request above the limit cannot be approved
      Given Alan's limit is 100.00 and a pending request totals 500.00
      When Alan tries to approve it
      Then the request is still pending

    @negative
    Scenario: A decided request cannot be decided again
      Given Alan has approved a request
      When he tries to reject it
      Then the request still shows as approved

  @story-F3.3 @story-F3.4
  Rule: An approver cannot decide her own request

    @negative
    Scenario: Self-approval is refused
      Given Alan holds both the requester and approver roles and has a pending request of 20.00
      When he tries to approve it
      Then the request is still pending

  @story-F3.4
  Rule: A rejection requires a reason the requester sees

    Scenario: Rejecting with a reason
      Given a pending request from Rita within Alan's limit
      When Alan rejects it with reason "Over budget"
      Then the request shows as rejected with reason "Over budget"

    @negative
    Scenario: Rejecting without a reason
      Given a pending request from Rita within Alan's limit
      When Alan tries to reject it with no reason
      Then the request is still pending

  @story-F3.5
  Rule: An approver sees the requests she has decided

    Scenario: Decision history
      Given Alan approved one request and rejected another with reason "Duplicate"
      When he opens his decided requests
      Then he sees both with his decision and the reason "Duplicate" on the rejected one

  @story-F3.1 @story-F3.3 @story-F3.4
  Rule: Only approvers decide requests

    @negative
    Scenario: A requester cannot approve
      Given Rita the requester has a pending request
      When she tries to approve it
      Then the request is still pending
