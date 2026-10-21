# The brief beside a dependency definition

One file per upstream, `registrations/<name>.md`, holding what the definition
under `specs/design/dependencies/<name>/` cannot carry. It never enters the
bundle: the platform collects the values per environment after the design,
and an organization pastes the consumption instructions when it promotes the
resource for other projects to reuse. A few lines, never a restatement of
the definition.

## Fields

- **Name** — the definition's name; the file is named after it.
- **Consumption instructions** — how a consuming component calls it: the auth
  style, the operations, envelopes and quirks, what the service fronts. Once
  the resource is the organization's, the coding agent reads this first, so it
  is an instruction, not a description.
- **Fronts** — the system behind it, or "nothing; it is the system of record".
- **Used by** — the story IDs that reach it.

## Example

Invented: a currency service a claims product calls.

```markdown
# currency-rates-service

**Name**: currency-rates-service
**Consumption instructions**: Authenticate with OAuth2 client credentials against the token address, then call `GET /rates?date=<yyyy-MM-dd>` with the bearer token. The response is `{ base, date, rates: { <currency>: <number> } }`. Rates are published once a day; cache them for the day. The service fronts Open Exchange Rates; callers never reach that API directly.
**Fronts**: Open Exchange Rates
**Used by**: F3.2, F3.5
```
