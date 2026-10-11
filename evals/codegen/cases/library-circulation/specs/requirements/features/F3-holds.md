# Holds

## Purpose
A member queues for a title with no free copy; the librarian works the queue so returned copies go to the first member waiting.

Needs: F2.

## User Stories
- F3.1 As a member, I want to place a hold on a title with no available copy, so that I get it when it is returned.
- F3.2 As a member, I want to cancel my own hold, so that I am no longer in the queue.
- F3.3 As a librarian, I want to view and work the holds queue per title, so that returned copies go to the first member waiting.

## Decisions
- Holds queue: first come, first served; a member may have one hold per title. *assumed*
