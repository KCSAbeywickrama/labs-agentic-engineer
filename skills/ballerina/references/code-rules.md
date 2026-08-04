# Ballerina Code Rules

## Structure

- Define `configurable` variables for all external values (API keys, hosts, ports, credentials).
  - Allowed types: `string`, `int`, `decimal`, `boolean` only.
  - Never assign hardcoded default values to configurables — reading an environment variable via `os:getEnv` (see Environment Variables below) is not a hardcoded default and is the expected pattern for platform-injected values.
- Initialize clients at module level, before any function or service declarations.
- Declare listeners with the `listener` keyword (`listener foo:Listener lsn = new (config);`), not a `final` variable — `service ... on lsn` attachment requires it; a `final foo:Listener` fails to compile.
- An event/streaming listener (change-data-capture, message topic/queue, etc.) attaches its service to a vendor channel/topic string that sits **between the service type and `on`**: `service <pkg>:<ServiceType> "<channel>" on <listener>` — e.g. a Salesforce CDC service binds to a channel like `service salesforce:CdcService "/data/LeadChangeEvent" on lsn`. The channel goes on the **`service` declaration** (its attach path) — **not** as a listener constructor argument; the listener `new (...)` takes only its config. This string isn't in the library API — get it from the connector README/vendor docs (ask the `library` agent) and wire it in **before** writing the service. Without it the code usually still compiles but the service silently receives nothing — never ship an event service without its channel.
- Implement a `main` function OR a service — not both, unless the requirement explicitly needs both.

## Data

- Use records for all data structures. Never use `map<json>`, `map<anydata>`, or raw `json`.
- Prefer closed records (`record {| ... |}`) for data shapes you own. Use an open record only when tolerating extra/unknown fields is deliberate (e.g. a loosely-specified inbound payload).
- Never access or manipulate a `json` variable directly. Define a record, convert json to it (`cloneWithType()` or `fromJsonStringWithType()`), then use the record.
- If a return typedesc is marked `<>` in API docs, define a custom record for the expected data shape.
- If a parameter type is `record {|anydata...;|}`, define or reuse an explicit named record — do not pass an anonymous literal.
- If a return type is `record {|anydata...;|}`, decide the shape, declare a named record, and assign to it.
- When accessing a field of a record, assign it to a new typed variable first, then use that variable in the next statement.

## Identifiers

- Always use **two-word camelCase** for ALL identifiers: variables, parameters, record fields (e.g., `userName`, `baseUrl`, `responseBody`).
- Exception: a record whose fields bind to external payload/JSON keys (e.g. via `cloneWithType()`) must use the **exact source key names** — even if that means single-word or PascalCase (e.g. `Name`, `CreatedDate`). The wire contract wins over the naming convention here.

## Function Calls

- Dot notation (`.`) for normal functions. Arrow notation (`->`) for remote and resource functions.
- Resource function invocation: `clientVar->/path/["param"].get(key="value")`
- Always use **named arguments**: `client->post("/path", message = payload)` — never positional.

## Type Safety

- Declare types explicitly in all variable declarations and `foreach` statements.
- To narrow a union or optional type: assign to a separate typed variable first, then use it in the `if` condition.
- An **optional field** (`field?: T` — what every non-required OpenAPI property generates) needs optional field access: `payload?.dueDate`, often `payload?.priority ?: "medium"`. Plain `payload.dueDate` fails to compile with *"field access cannot be used to access an optional field of a type that includes nil"*.
- Do not invoke methods on json access expressions — always use a separate statement.

## Imports

- Each `.bal` file must have its own import statements.
- Import only packages your code actually references — `bal build` errors on unused imports. Don't pre-import a connector's dependency module (e.g. `ballerina/sql` behind a database client) unless your code names a type from it.
- Do not import auto-imported langlibs: `lang.string`, `lang.boolean`, `lang.float`, `lang.decimal`, `lang.int`, `lang.map`.
- Packages with dots in names use aliases: `import org/package.one as one;`
- Submodules in `generated/<moduleName>/`: import as `import <packageName>.<moduleName>;` — the import should contain only the package name and submodule name, no path components.
- For SQL databases, import the matching `.driver` package alongside the client so the JDBC driver is on the runtime classpath (also required for GraalVM native builds):
  ```ballerina
  import ballerinax/postgresql;
  import ballerinax/postgresql.driver as _;
  ```
  The same pattern applies to the other SQL connectors — `mysql` + `mysql.driver`, `mssql` + `mssql.driver`, `oracledb` + `oracledb.driver`, `h2` + `h2.driver`.

## HTTP Service Design

When creating an HTTP service, define resource function signatures first with full return types:

```ballerina
resource function get users() returns UserList|http:NotFound|http:NotImplemented {
    return http:NOT_IMPLEMENTED;
}
```

Use `http:NotImplemented` as a placeholder return type initially, then implement each resource function.

Params bind from the signature, no annotation needed: a plain typed param is a query param (`?` or a default makes it optional), `@http:Header` binds a header. Escape a reserved word or a hyphen with a leading quote — `int 'limit = 20`, `@http:Header string x\-user\-id`.

`http:Ok`, `http:Created`, `http:BadRequest`, `http:Unauthorized`, `http:NotFound` are `record {| *CommonResponse; … |}`, so each takes `body?`, `headers?` and `mediaType?`. `http:NoContent` takes `headers?` only — no body — and `http:NO_CONTENT` is its empty value.

```ballerina
resource function get items(string? status, int 'limit = 20) returns http:Ok|http:BadRequest {
    return <http:Ok>{body: rows, mediaType: "application/json"};
}

resource function post items(@http:Header string x\-user\-id, ItemInput payload) returns http:Created {
    return <http:Created>{body: item, headers: {location: "/items/" + item.id}};
}
```

## SQL Queries

- Values interpolate into a `sql:ParameterizedQuery` backtick template — that *is* the parameter binding, so never assemble SQL by string concatenation.
- Add a conditional clause with `sql:queryConcat(q, ` AND status = ${status}`)`.
- `dbClient->query(q)` returns `stream<RowType, sql:Error?>`. `queryRow(q)` returns one row, or `sql:NoRowsError` when nothing matched — that is a 404, never a 500. `execute(q)` returns `sql:ExecutionResult` (`affectedRowCount`, `lastInsertId`).
- A `timestamptz` column binds to `time:Utc` (`sql:TimestampValue` wraps `string|time:Utc?`); a plain `timestamp` binds to `time:Civil` (`sql:DateTimeValue`).

## Time

`time:utcNow()` gives a `time:Utc`. `time:utcToString` / `time:utcFromString` are the RFC3339 round trip an OpenAPI `date-time` field needs. `time:utcToCivil` / `time:utcFromCivil` convert to and from `time:Civil` — there is no `civilToUtc`.

## GraphQL Services

If the user requests a GraphQL service and has not provided their own schema:
- Write the proposed GraphQL schema first (before generating Ballerina code).
- Use the same names from the GraphQL schema when defining Ballerina record types.

## Workspace Projects

When working with a Ballerina workspace (root `Ballerina.toml` with a `[workspace]` section):

**Creating a new package:**
1. Create the package directory with a `Ballerina.toml` containing the `[package]` section (`name`, `org`, `version`).
2. Add the new package path to the `packages` array in the root workspace `Ballerina.toml`.
3. Create initial `.bal` files in the new package.

**Guidelines:**
- Always prefer modifying existing packages over creating new ones.
- The root workspace `Ballerina.toml` should only contain a `[workspace]` section.
- Do not modify existing package `Ballerina.toml` files for dependency management.

## Environment Variables

- Read a platform-injected environment variable (e.g. a dependency's `envBindings` in `design.json`) as a one-line `configurable` in `config.bal`, using `ballerina/os`:
  ```ballerina
  import ballerina/os;

  configurable string envVar = os:getEnv("MY_ENV_VAR");
  ```
- One declaration per env var, all in `config.bal` — don't scatter `os:getEnv` calls across other files.

## Config.toml

- Never read `Config.toml` or `tests/Config.toml` directly — they may contain secrets.
- Providing values to configurables is a runtime task. Only do it before running or testing.
- If the user needs to supply values, list the configurable variable names in the summary.

## Logging & Observability

- Use the `ballerina/log` module for logging: `log:printInfo`, `log:printError`, `log:printWarn`, `log:printDebug`. Attach context as structured key-value pairs (named arguments) rather than concatenating into the message — e.g. `log:printError("order failed", id = orderId)`.
- Never log secrets, auth tokens/headers, or raw request/response payloads — redact or hash sensitive values before logging.
- Prefer Ballerina's built-in runtime observability (metrics + distributed tracing) over hand-rolled instrumentation. It needs no code changes — enable it via `Config.toml`, or pass `--observability-included` to `bal run`/`bal build` (already set in the `Ballerina.toml` generated by `bal new`):
  ```toml
  [ballerina.observe]
  enabled = true
  provider = "<provider>"   # or set metricsEnabled/metricsReporter and tracingEnabled/tracingProvider separately
  ```
  Metrics (e.g. Prometheus) and traces (e.g. Jaeger) are then emitted automatically for services and clients.
- Only add custom spans/metrics via the `ballerina/observe` module when the built-in instrumentation isn't enough.

## File Organization

- Split code by concern across multiple `.bal` files rather than cramming everything into `main.bal` — files in a package share one module, so splitting is free; use submodules or packages for larger separation.
- Reuse a fitting existing file before adding a new one; name new files for their concern (`snake_case.bal`). Naming and granularity are your call, not a fixed scheme.
- Do not create documentation markdown files.
- **Never hand-edit `Dependencies.toml`** — it is auto-managed by the build tool. Do not create or hand-modify it to manage dependencies; deleting it to force a clean re-resolution (then rebuilding) is a valid troubleshooting step.
- **Never edit `Ballerina.toml` to add dependencies** — add the `import` statement in the `.bal` file and run `bal build`; Ballerina resolves and downloads packages from Central automatically.

## Tests

- Only write tests if the user explicitly asks.
- Use the `ballerina/test` module and any service-specific test libraries.
- Follow the `instructions` field in `ballerina/test` library docs and the `testGenerationInstruction` field in the service library's API docs when writing tests.
- Test an HTTP service through an `http:Client` against the running service — assert its public contract, not internals.
- Override `configurable` values for tests in `tests/Config.toml` (not the package's `Config.toml`).
- To mock a client or connector, wrap its construction in a small init function so `@test:Mock` can replace it.
- Use `dependsOn` only when test ordering is the behavior under test — not to sequence otherwise-independent tests.

## Other Rules

- No dynamic listener registrations.
- No code that requires assigning values to function parameters.
- Propagate errors with `check`, or handle them with a `do`/`on fail` block; never use `checkpanic` to silence an error return in real code.
- `//` for single-line comments only. Keep comments minimal.
