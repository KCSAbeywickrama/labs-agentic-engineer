# Ballerina from a GraphQL Contract

Writing a client for a dependency whose contract is a GraphQL document
(`resource.contract.type: graphql`). Write the client by hand: each operation is a
document string, and `ballerina/graphql`'s `graphql:Client` binds the response to a
record you declare. Do not reach for `bal graphql` client generation: on 2201.13.1
(tool 0.14.0) its output does not compile. The code follows
[code-rules.md](code-rules.md); the module lands where
[project-structure.md](project-structure.md) says.

## The target record is the response envelope, not the payload

A GraphQL server answers one JSON object: `{"data": …, "errors": […]?, "extensions": {…}?}`.
`query()`, `mutate()` and `subscribe()` bind that WHOLE object to the target type (the
module's spec, §2.5.3: a subtype of `graphql:GenericResponseWithErrors|record {}`). The
fields the document selects sit inside `data`. A record shaped like the payload,
`record {| Customer[] customers; |}`, never binds. The closed record has no `data` field
and the response has no top-level `customers`, so every call fails with a
`graphql:PayloadBindingError` and the service answers 500. The build cannot see this:
the wrong shape compiles.

```ballerina
import ballerina/graphql;

configurable string crmUrl = ?;
configurable string crmTokenUrl = ?;
configurable string crmClientId = ?;
configurable string crmClientSecret = ?;

type Customer record {| string id; string name; string status; string? region; |};

// What query() binds: the envelope. `*GenericResponseWithErrors` brings the
// optional `errors` and `extensions`; `data` carries the selected root fields.
type CustomersResponse record {|
    *graphql:GenericResponseWithErrors;
    record {| Customer[] customers; |} data;
|};

const string LIST_DOC = string `query ($limit: Int!, $offset: Int!) {
    customers(limit: $limit, offset: $offset) { id name status region }
}`;

// Construction in its own function: an OAuth2-configured client fetches its first
// token while it is constructed, and this is what a test mocks.
function newCrm() returns graphql:Client|error {
    return new (crmUrl, auth = {tokenUrl: crmTokenUrl, clientId: crmClientId, clientSecret: crmClientSecret});
}

final graphql:Client crm = check newCrm();

function listCustomers(int 'limit, int offset) returns Customer[]|error {
    CustomersResponse res = check crm->query(LIST_DOC, {'limit: 'limit, offset: offset});
    if res.errors is graphql:ErrorDetail[] {
        return error("crm-service answered errors", errors = res.errors);
    }
    return res.data.customers;
}
```

- A nullable schema field (`region: String`) is `string?` in the record; a root field
  that can be null (`customer(id:)` returning `Customer`) is `Customer? customer` inside `data`.
- Variables go in the `map<anydata>` argument, never spliced into the document string.
- `execute()` and `executeWithType()` are deprecated; do not write them, and do not
  "fix" a deprecation warning by switching between them. `execute()` binds the same
  envelope as `query()`; `executeWithType()` binds the payload alone, the shape to
  unlearn for `query()`.
- A response with `errors` and partial `data` binds when the record includes
  `*graphql:GenericResponseWithErrors`; check `res.errors` before reading `data`.
  A `graphql:PayloadBindingError` from the call means the response did not fit the
  record (a null `data`, a server error without data, a wrong shape); its `detail()`
  keeps the server's `errors` and partial `data`. Map both to the upstream-failure
  response the contract declares (502), branching on the error type as
  code-rules.md does for `http:Client` errors.

## Prove the shape once

When the package has tests ([tests.md](tests.md)), one binding test per client turns
the runtime 500 into a failing `bal test`: a `graphql:Service` stub on a test listener
answers the canned document, the client's constructor is mocked to point at it, and
the bound `data` is asserted through the production function. The stub's resource
functions take the same arguments the document passes. The configurables get values
in `tests/Config.toml`.

```ballerina
// tests/crm_client_test.bal
listener graphql:Listener stub = new (9911);

service /graphql on stub {
    resource function get customers(int 'limit, int offset) returns Customer[] {
        return [{id: "c1", name: "Acme", status: "ACTIVE", region: ()}];
    }
}

@test:Mock {functionName: "newCrm"}
function stubCrm() returns graphql:Client|error {
    return new ("http://localhost:9911/graphql");
}

@test:Config {}
function customersBind() returns error? {
    Customer[] got = check listCustomers(10, 0);
    test:assertEquals(got[0].name, "Acme");
}
```
