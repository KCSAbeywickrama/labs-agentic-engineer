---
name: react-webapp
description: How to build a React SPA on the platform — project layout, the build-verify command, and this stack's constraints and pitfalls. Apply when a component's `type` is `web-application`.
metadata:
  aep:
    kind: org
    audience: [coding]
---

# React Webapp

A web-app on this platform: a Vite + TS SPA built to static files, served by
stock `nginx:alpine`. The image is **byte-identical across every environment** —
per-env values (API URLs, OIDC config, flags) arrive at request time in
`window._env_`, never at build time.

## Development flow

1. **Scaffold** per Layout.
2. **Implement** — `src/env.ts` first (every other module reads config through
   it), then generate `src/generated/` from each dependency's OpenAPI contract,
   then `src/api.ts`, then pages. Every rule under Constraints is a runtime
   failure if broken, not a style preference.
3. **Verify** — from the app path:
   ```bash
   npm install                   # regenerates package-lock.json
   npx tsc --noEmit              # type-check without emitting
   npm run build                 # actually build
   ```
   Commit the `package-lock.json` this produces. Never commit `node_modules/`.

   The `build` script is `tsc --noEmit && vite build` — **not** `tsc -b`, which
   needs a composite project: a `tsconfig.json` that `references` a
   `tsconfig.node.json` setting `noEmit` fails with `TS6310: Referenced project
   may not disable emit`, and unwinding that costs more than it buys.

   Verification ends at exit 0. **Never run `npm audit` or `npm audit fix`** —
   the advisories land on Vite's dev-only transitive dependencies, which never
   reach a static bundle served by nginx, and `audit fix` bumps pinned
   dependencies behind your back.
4. **PR** — only once step 3 exits 0.

## Constraints

**Runtime config, not build-time.** The platform mounts `/env-config.js` into
the served root and it populates `window._env_`. You never generate or commit
that file. `import.meta.env.VITE_*`, `process.env.REACT_APP_*`,
`NEXT_PUBLIC_*` and `.env` files are all build-time mechanisms the platform does
not use — reading one gets you `undefined` in production.

**The key set is fixed.** It is hardcoded in platform code, so a key you invent
is `undefined` at module load. Use these exact spellings:

| Key | Set when | Meaning |
|---|---|---|
| `API_BASE_URL` | this web-app has a `component`-kind `dependencies` entry on a service sibling | external gateway URL of the primary upstream service in this project |
| `<UPSTREAM>_URL` | this web-app depends on `<upstream>` (a `component`-kind entry) | external gateway URL of that sibling (`<UPSTREAM>` = component name in `UPPER_SNAKE_CASE`, e.g. `todo-api` → `TODO_API_URL`) |
| `<NAME>_URL` | `dependencies` include an `external`-kind entry `<name>` | external gateway URL of that external upstream API (same convention, e.g. `employee-api` → `EMPLOYEE_API_URL`) |
| `<DEP>_*` | this web-app declares an auth `platform-resource` dependency named `<dep>` | OIDC config (`<DEP>_CLIENT_ID`, `<DEP>_ISSUER`, `<DEP>_JWKS_URL`, `<DEP>_SCOPES`), `<DEP>` = UPPER_SNAKE of the dependency name (`user-auth` → `USER_AUTH_*`) — owned by `thunder-authentication` |
| `<NAME>` (any) | you declared it in `workload.yaml` `configurations.env` | app-config default, per-env override possible |

**Throw on a missing key, never default it.** No `?? ""`, no `|| ''`. A silent
fallback turns every fetch into a relative URL against the SPA's own nginx,
which answers `405` on a `POST` — a bug that looks like a backend fault.

**Served at host root.** Each web-app gets its **own** gateway hostname, so the
stock Vite default is correct: **do NOT set `base`**. Asset URLs, any react-router
`basename`, and any OAuth `redirect_uri` are plain root paths (`/assets/…`,
`/callback`). Services ARE path-routed, under `/<project>-<component>-http` on a
shared gateway — copying that prefix into `base` 404s every asset (nginx serves
`index.html` instead, so the browser gets HTML for a module script) and the page
renders blank.

**Static nginx only.** No `proxy_pass`, no `/oidc/` block, no `envsubst`, no
`/etc/nginx/templates/`, no `NGINX_ENVSUBST_*`, no custom
`/docker-entrypoint.d/` script. The platform-mounted `/env-config.js` is served
by the same static config as plain JS.

**Auth.** If the component declares an auth `platform-resource` dependency, add
`src/auth.ts` and attach `Authorization: Bearer <token>` to every API call —
`thunder-authentication` owns that wiring.

**Never `exposesAPI`.** That toggle is for backends only; a web-app expresses
auth through its auth dependency instead.

**Contract-first client, never hand-rolled shapes.** Every dependency has a
committed OpenAPI contract: `specs/design/components/<component-name>/openapi.yaml`
for a `component`-kind dependency, or
`specs/design/components/<this-app>/dependencies/<dep-name>.openapi.yaml` for an
`external`-kind one — project-root paths, sibling to this app's own folder.
Generate types from it and call through `openapi-fetch`'s typed client (Layout);
don't hand-write request/response shapes, they drift from the real contract the
moment it changes. Commit `src/generated/` — the per-component Docker build's
context is this app's own folder alone, so unlike a monorepo-wide `gen` step
there is no later stage that can reach the sibling spec to regenerate it.

## Layout

```
<app-path>/
├── package.json
├── tsconfig.json         # ONE file — no project references, no tsconfig.node.json
├── vite.config.ts        # no `base` — served at host root
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── env.ts            # typed window._env_ shim
│   ├── generated/        # openapi-typescript output, one file per dependency — commit, never hand-edit
│   ├── api.ts            # openapi-fetch client(s), typed against generated/
│   ├── auth.ts           # only with an auth dependency — see thunder-authentication
│   └── pages/
├── nginx/
│   └── default.conf
└── Dockerfile
```

`index.html` — the `env-config.js` tag is **synchronous** and comes BEFORE the
bundle. No `async`, no `defer`, no `type="module"` on it; that is what guarantees
`window._env_` is populated before any ES module evaluates.

```html
<head>
  <script src="./env-config.js"></script>          <!-- 1. synchronous -->
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>  <!-- 2. the bundle -->
</body>
```

`src/env.ts` — typed read, throwing if the file never loaded:

```ts
type Env = {
  API_BASE_URL: string;
  // ...one <UPSTREAM>_URL per component-kind dependency, plus the <DEP>_* OIDC
  // keys if this SPA declares an auth dependency.
};

declare global {
  interface Window { _env_: Env }
}

if (!window._env_) {
  throw new Error(
    "window._env_ not set — /env-config.js failed to load. " +
    "The platform mounts this file; if you see this locally, host " +
    "/env-config.js from your dev server.",
  );
}

export const env: Env = window._env_;
```

`src/generated/<component-name>.ts` — one run per dependency, before writing
`api.ts`. `openapi-typescript` is a devDependency (codegen only, no runtime
footprint); `openapi-fetch` is a regular dependency (it ships in the bundle):

```bash
npx openapi-typescript ../specs/design/components/<component-name>/openapi.yaml \
  -o src/generated/<component-name>.ts
```

(`external`-kind dependency: point at
`../specs/design/components/<this-app>/dependencies/<dep-name>.openapi.yaml`
instead.) Re-run and commit the diff whenever the upstream spec changes.

`src/api.ts` — resolve the upstream URL at module top level, so a missing key
throws at load rather than at the first click; the client is typed end-to-end
against the generated file, so a path or method typo is a compile error, not a
runtime 404:

```ts
import createClient from "openapi-fetch";
import type { paths } from "./generated/todo-api";
import { env } from "./env";

const BASE_URL = env.TODO_API_URL; // or env.API_BASE_URL for the primary upstream
if (!BASE_URL) {
  throw new Error("TODO_API_URL not set in window._env_");
}

export const todoApi = createClient<paths>({ baseUrl: BASE_URL });

// call sites use the typed client directly, e.g.:
// const { data, error } = await todoApi.GET("/todos");
```

`nginx/default.conf` — pure static:

```nginx
server {
    listen 9090;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

`Dockerfile` — multi-stage build onto stock `nginx:alpine`:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm i
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 9090
CMD ["nginx", "-g", "daemon off;"]
```

`workload.yaml` follows your prompt — as given when it carries one, else per the
component contract. Any default it declares under `configurations.env` arrives as
a `window._env_` entry (see Config above).

## Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| SPA throws on load: `window._env_ not set` | `/env-config.js` failed to load — path wrong, 404, or the `<script>` was `defer`/`async` | Make the tag synchronous in `<head>`, BEFORE the bundle's `<script type="module">`. |
| `nginx: [emerg] host not found in upstream "thunder-service..."` at pod start | Legacy `/oidc/` proxy block in `nginx/default.conf` | Delete the block. The browser posts cross-origin. |
| Types in `src/generated/*` don't match the live service | Upstream `openapi.yaml` changed since last generation | Re-run the `openapi-typescript` command and commit the diff. |
| Docker build succeeds but ships stale/hand-written shapes, or fails `ENOENT ../specs/...` | `src/generated/` wasn't committed — the per-component build context is this app's folder alone, `specs/` isn't reachable from it | Generate and commit `src/generated/` before PR; never rely on a build-time regen step. |
