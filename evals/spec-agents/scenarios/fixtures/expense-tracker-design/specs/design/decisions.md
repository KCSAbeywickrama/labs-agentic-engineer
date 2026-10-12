# Technical decisions

- [architecture] A claim's amount is stored in whole cents, not a decimal currency amount. *assumed* (F1)
- [security] An employee reads their own claims through /me/claims; the approver reads every claim through /claims. *assumed* (F1, F2)
- [expense-api] A claims list returns 20 claims per page. *assumed* (F1, F2)
- [expense-api] The monthly report is computed on read from the claims table; no separate report record is stored. *assumed* (F3)
