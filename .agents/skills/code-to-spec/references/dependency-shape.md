<!-- Generated from skills/architecture/SKILL.md (sha256 97123da0937f) by scripts/sync-references.mjs. Do not edit. -->

# The shape of specs/design/dependencies/<name>/dependency.json

The platform's architecture skill on the dependency definition, verbatim. The `ref`, `provenance`, `suggestions` and `accepted` parts are the platform's or the design turn's to write; a definition written from code carries `name`, `resource.name`, `description`, `provider`, `config` and a `derived` contract.

`dependency.json` — ONE PROJECT'S USE OF A RESOURCE. The `resource` block is
what the thing is, in the one shape a resource has everywhere (the org
registry holds the same shape); around it sit this project's provenance and
open suggestions:

```json
{
  "name": "payment-service",
  "resource": {
    "name": "payment-service",
    "description": "Charges the customer for shipping once a box is priced.",
    "provider": "Stripe",
    "config": [ { "key": "PAYMENT_API_KEY", "secret": true, "description": "Stripe secret API key" } ],
    "contract": { "type": "openapi", "path": "openapi.yaml", "origin": "provider" }
  },
  "provenance": { "sourceUrl": "https://…/spec3.json" }
}
```

There is no `style`: how the component consumes the system is computed from
`contract.type` (`openapi` → a REST client, `graphql` → a GraphQL client, `sdk`
→ a vendor library). The contract is ONE WHOLE DOCUMENT beside the file, never
a slice — the coding agent cuts what its component calls at coding time — and
it is always `{ "type", "path" }`, a file name in the directory: there is no
URL form, and the coding agent must find nothing in the repo it could follow
off it. `contract.origin` says where the file came from: `registry` (copied
from the organization's record), `provider` (the provider's published
document, fetched by the platform), `derived` (you wrote it from the
provider's developer reference), `assumed` (you wrote it from less, under the
user's authorization — `contract.accepted` is that record, and the platform
writes it, never you).
