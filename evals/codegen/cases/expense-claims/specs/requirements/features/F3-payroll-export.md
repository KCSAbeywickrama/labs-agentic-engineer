# Payroll export

## Purpose

Finance reads every approved claim and exports them, once each, to a file payroll imports.

Needs: F2.

## User Stories

- F3.1 As Finance, I want to view all approved claims, so that I can prepare them for payroll.
- F3.2 As Finance, I want to export approved claims to a file payroll can import, so that reimbursement can be processed without manual re-entry. *assumed*
- F3.3 As Finance, I want exported claims to be marked as exported, so that the same claim is never exported twice.

## Decisions

- Approved claims are exported as a downloadable CSV file. *assumed*

## Open Questions

1. Which payroll system will import the exported file, and does it require a specific column layout or file format beyond CSV?
2. Should Finance be able to reject/reverse a claim after export, or is export final?
