# Expense Claims

## Problem Statement
Employees need to get business expenses reimbursed, managers need to review them, and finance needs approved claims in payroll. Without a shared system this is handled by hand and is slow and error-prone.

## Solution
A web app where employees submit expense claims, managers approve or reject them, and finance exports approved claims to payroll.

## Actors
- Employee: submits and tracks their own expense claims.
- Manager: reviews, approves or rejects claims from their team.
- Finance: exports approved claims to payroll.

## Features
- F1 [Submit expenses](features/F1-submit-expenses.md)
- F2 [Approvals](features/F2-approvals.md)
- F3 [Payroll export](features/F3-payroll-export.md)

## Product-wide
See [Product-wide](product-wide.md).

## Out of Scope
- Email or any other notifications.
- Object storage (no receipt or file uploads stored by the product).

## Open Questions
1. Which payroll file format or system does finance export to? (assumed CSV in F3)
