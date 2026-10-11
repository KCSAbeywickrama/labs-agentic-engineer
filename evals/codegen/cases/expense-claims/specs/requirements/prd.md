# Expense Claims

## Problem Statement

Employees who incur business expenses today have no consistent way to submit
claims for reimbursement, and managers have no consistent way to review and
approve them. Finance then has to manually gather approved claims to prepare
payroll reimbursements, which is slow and error-prone. The result is delayed
reimbursements for employees, inconsistent approval records for managers, and
manual reconciliation work for finance.

## Solution

A web application where employees submit expense claims, managers approve or
reject those claims, and finance exports the approved claims into a format
payroll can consume. The system keeps a clear record of every claim's status
from submission through approval to export, without relying on email
notifications or storing receipt files.

## Actors

- **Employee** — submits expense claims, tracks their own claims' status, and
  can edit or withdraw a claim while it is still pending.
- **Manager** — reviews expense claims submitted by their employees, and
  approves or rejects each one, optionally with a reason.
- **Finance** — views all approved claims and exports them into a payroll-ready
  format.

## Features

- F1 [Claims](features/F1-claims.md)
- F2 [Approvals](features/F2-approvals.md)
- F3 [Payroll export](features/F3-payroll-export.md)

## Product-wide

Sign-in, notifications, attachments, currency and roles are on the
[Product-wide](product-wide.md) page.

## Out of Scope

- Email or push notifications of any kind.
- Receipt/file attachments and any object storage.
- Direct integration with a payroll provider's API (export is a file only).
- Multi-currency claims or currency conversion.
- Expense policy enforcement or automated fraud detection.
- Multi-level approval chains (only a single manager approval step).
