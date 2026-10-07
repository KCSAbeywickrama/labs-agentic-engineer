# Registration brief

One file per upstream, `registrations/<name>.md`, in the order and words of
the platform's registration form (Resources → New resource). The registering
admin copies each field across, uploads the contract file and types the
values; nothing else is needed. Everything but the values comes from the
code, so every field is filled.

## Fields

- **Name** — the registered name, kebab-case; the file is named after it.
- **Provider** — the concrete system it is, and what it fronts when it fronts
  one: "the organization's sales entity service, backed by Salesforce".
- **Description** — what it is for, in the requirements' words.
- **Contract document** — the type (`graphql`, `openapi`, `sdk`, or
  `documentation` when nothing could be derived) and the file beside the
  brief, uploaded through the form; one line on where the file came from.
- **Keys** — a table: Key | What it is | Secret.
- **Values per environment** — left to the admin: one value per key per
  environment, typed into the form.
- **Consumption instructions** — how a consuming component calls it; the
  coding agent reads this first, so it is an instruction, not a restatement
  of the description.
- **Fronts** — the system behind it, or "nothing; it is the system of record".
- **Used by** — the story IDs that reach it.

## Example

Invented: a currency service a claims product calls.

```markdown
# currency-rates-service

**Name**: currency-rates-service
**Provider**: the organization's currency rates service, backed by Open Exchange Rates
**Description**: Daily exchange rates between the company currency and every currency a claim can be filed in.
**Contract document**: `openapi` — `currency-rates-service.openapi.yaml`, derived from the product's client code; covers the one operation the product calls.

**Keys**

| Key | What it is | Secret |
|---|---|---|
| CURRENCY_RATES_SERVICE_URL | Base address of the service | no |
| CURRENCY_RATES_SERVICE_TOKEN_URL | Token address for the client-credentials grant | no |
| CURRENCY_RATES_SERVICE_CLIENT_ID | Client id for the client-credentials grant | no |
| CURRENCY_RATES_SERVICE_CLIENT_SECRET | Client secret for the client-credentials grant | yes |

**Values per environment**: typed by the registering admin, one per key per environment.

**Consumption instructions**: Authenticate with OAuth2 client credentials against the token address, then call `GET /rates?date=<yyyy-MM-dd>` with the bearer token. The response is `{ base, date, rates: { <currency>: <number> } }`. Rates are published once a day; cache them for the day. The service fronts Open Exchange Rates; callers never reach that API directly.

**Fronts**: Open Exchange Rates
**Used by**: F3.2, F3.5
```
