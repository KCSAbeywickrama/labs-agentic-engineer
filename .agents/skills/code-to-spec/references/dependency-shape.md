<!-- Generated from skills/architecture/SKILL.md (sha256 40a38e592d4d) by scripts/sync-references.mjs. Do not edit. -->

# The shape of specs/design/dependencies/<name>/dependency.json

The platform's architecture skill on the dependency definition, verbatim. The `ref`, `provenance`, `suggestions` and `accepted` parts are the platform's or the design turn's to write; a definition written from code carries `name`, `resource.name`, `description`, `provider`, `config` and a `derived` contract, with its `assumptions.md` beside it.

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

Work each one in order. A design run does them in two passes:

- **With the component that uses it** (the design's Architecture step):
  steps 1, 2 and 5. The `dependency.json` of this pass says only what the
  dependency is: `name`, and `resource.name`, `resource.description`, and
  `resource.provider` or `suggestions`. No `web_search`, no `contract`, no
  `config`, no `provenance`, no contract file, no `assumptions.md`.
- **In the design's Dependencies step**, when the components show what they
  call: steps 3 and 4 for a dependency with a provider. Edit its
  `dependency.json` to add what they find, write the contract file when you
  derive it, then write `assumptions.md` (**What the design assumes about a
  dependency**, below).
