# Purchase requests

## Purpose
Requesters raise purchase requests for catalogue items and follow their status.

Needs: F1.

## User Stories
- F2.1 As a requester, I create a purchase request with one or more lines, each an active catalogue item and a quantity. *assumed*
- F2.2 As a requester, I add a short justification to a request. *assumed*
- F2.3 As a requester, I see the total value of a request, calculated from catalogue unit prices. *assumed*
- F2.4 As a requester, I edit or withdraw my request while it is still draft or pending approval. *assumed*
- F2.5 As a requester, I submit a draft request for approval. *assumed*
- F2.6 As a requester, I see a list of my requests with their status, newest first. *assumed*
- F2.7 As a requester, I open a request and see its lines, total, status, and the approver's decision and reason. *assumed*

## Decisions
- A request's status is one of draft, pending approval, approved, rejected, withdrawn, or received. *assumed*
- Line prices are copied from the catalogue when the request is submitted, so later price changes do not alter it. *assumed*
- Requesters see only their own requests. *assumed*
- Editing a pending request returns it to draft; an approved or rejected request cannot be edited, and a rejected one is resubmitted as a new request. *assumed*
- Request status moves to received when all its lines are fully received (F4). *assumed*

## Out of Scope
- Free-text items that are not in the catalogue.
- Attachments and quotes.
- Splitting a request across suppliers.
