# Catalogue

## Purpose
Members search titles and see availability; librarians manage titles and their physical copies.

## User Stories
- F1.1 As a member, I search titles by title, author or subject. *assumed*
- F1.2 As a member, I see a title's details and how many copies are available. *assumed*
- F1.3 As a librarian, I add, edit and remove titles. *assumed*
- F1.4 As a librarian, I add, edit and withdraw copies of a title, each with a barcode. *assumed*
- F1.5 As a librarian, I see each copy's status: available, on loan, on hold shelf or withdrawn. *assumed*

## Decisions
- Titles and copies are stored in the catalogue service, reached only through the circulation API. [brief]
- A title can have many copies; a copy belongs to one title. *assumed*
- A title with copies on loan cannot be removed; its copies are withdrawn instead. *assumed*
- Search is open to any signed-in user. *assumed*

## Out of Scope
- Cover images or file uploads.
- Importing titles from external catalogues.
