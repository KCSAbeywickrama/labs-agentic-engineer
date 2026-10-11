# Approvals

## Purpose
Managers review submitted claims and approve or reject them.

Needs: F1.

## User Stories
- F2.1 As a manager, I see my team's submitted claims in one list, oldest first. *assumed*
- F2.2 As a manager, I open a claim and see its expense lines, total and submitter. *assumed*
- F2.3 As a manager, I approve a submitted claim. *assumed*
- F2.4 As a manager, I reject a submitted claim with a required reason. *assumed*
- F2.5 As a manager, I see the claims I have already approved or rejected. *assumed*
- F2.6 As a finance user, I set an employee's manager by choosing from every recorded employee.

## Decisions
- A manager sees and decides only claims of employees who report to them. *assumed*
- Employees are recorded by the product itself: each person is registered (id and name from their sign-in) the first time they open the app and on every authenticated request thereafter.
- The reporting line (employee to manager) is maintained by finance in the app, not taken from the sign-in directory. The manager picker lists every recorded employee.
- A manager cannot approve or reject their own claim. *assumed*
- A decision is final for the manager; a rejected claim returns to the employee, who may resubmit it (F1.6). *assumed*
- No notification is sent on a decision; employees see the outcome in their claim list.

## Out of Scope
- Approval chains or multiple approval levels.
- Deputies or delegation while a manager is away.
- Approval limits by amount.
- Email or other notifications.
