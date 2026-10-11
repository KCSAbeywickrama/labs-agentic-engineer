Feature: F2 Purchase requests

  @story-F2.1 @story-F2.2 @story-F2.3
  Rule: A requester creates a request of catalogue lines with a justification and sees its total

    Scenario: Creating a request with two lines
      Given the catalogue holds "A4 Paper" at 4.50 and "Stapler" at 8.00
      When Rita creates a request for 10 of "A4 Paper" and 2 of "Stapler" with justification "Office restock"
      Then the request is a draft with a total of 61.00 and justification "Office restock"

    @negative
    Scenario: A request needs at least one line
      Given Rita the requester is signed in
      When she tries to create a request with no lines
      Then Rita has no new request

  @story-F2.5 @story-F2.6
  Rule: A requester submits a draft and follows her requests newest first

    Scenario: Submitting a draft
      Given Rita has a draft request for 10 of "A4 Paper"
      When she submits it
      Then her request list shows it as pending approval

    Scenario: The list is newest first
      Given Rita has submitted a request for "A4 Paper" and later one for "Stapler"
      When she opens her request list
      Then the "Stapler" request is listed above the "A4 Paper" request

  @story-F2.4
  Rule: A request can be edited or withdrawn only while draft or pending

    Scenario: Withdrawing a pending request
      Given Rita has a pending request for 10 of "A4 Paper"
      When she withdraws it
      Then the request shows as withdrawn

    @negative
    Scenario: An approved request cannot be edited
      Given Rita's request for 10 of "A4 Paper" has been approved
      When she tries to change its quantity to 20
      Then the request still shows 10 of "A4 Paper"

  @story-F2.7
  Rule: A request shows its lines, total, status and the approver's decision

    Scenario: Seeing a rejection reason
      Given Rita's request was rejected by Alan the approver with reason "Over budget"
      When Rita opens the request
      Then she sees status rejected and the reason "Over budget"

  @story-F2.6 @story-F2.7
  Rule: Requesters see only their own requests

    @negative
    Scenario: Another requester's request is not visible
      Given Rita has submitted a request for "A4 Paper"
      When Remy the requester opens his request list
      Then Rita's request is not in it

  @story-F2.3 @story-F2.5
  Rule: Line prices are fixed when the request is submitted

    Scenario: A later price change does not alter a submitted request
      Given Rita has submitted a request for 10 of "A4 Paper" priced at 4.50
      When Wanda changes the price of "A4 Paper" to 5.00
      Then Rita's request still has a total of 45.00
