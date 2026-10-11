# Payroll export

## Purpose
Finance exports approved claims to payroll.

Needs: F2.

## User Stories
- F3.1 As a finance user, I see a list of approved claims not yet exported. *assumed*
- F3.2 As a finance user, I select approved claims and export them as one batch. *assumed*
- F3.3 As a finance user, I download the batch as a CSV file with one row per claim (employee, claim, total, approval date). *assumed*
- F3.4 As a finance user, I see past export batches with their date and the claims they contain. *assumed*
- F3.5 As a finance user, I re-download a past batch. *assumed*

## Decisions
- Export is a downloadable CSV file; the product does not push to a payroll system. *assumed*
- Exporting a claim changes its status to exported (visible to the employee in F1.4), and an exported claim cannot be exported again in a new batch. *assumed*
- Only approved claims can be exported. *assumed*
- Amounts in the file are in the company currency (P3).
- Past batches are stored as data and regenerated on download; no file storage is used.
- No notification is sent on export.

## Out of Scope
- Direct integration with a payroll system.
- Editing or reversing claims after export.
- Email or other notifications.

## Open Questions
1. Which payroll system or file layout does finance need the export to match? CSV columns above are a guess.
