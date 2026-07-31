---
name: react-webapp
description: How to build a React SPA on the platform.
metadata:
  aep:
    kind: org
---

# React Webapp

A web-app on this platform: a Vite + TS SPA built to static files, served by
stock `nginx:alpine`. The image is **byte-identical across every environment** —
per-env values (API URLs, OIDC config, flags) arrive at request time in
`window._env_`, never at build time.

## Development flow

1. **Scaffold** per Layout.
2. **Implement** — `src/env.ts` first (every other module reads config through
   it), then `src/api.ts`, then pages. Every rule under Constraints is a runtime
   failure if broken, not a style preference.
3. **Verify** — from the app path:
   ```bash
   npm install 2>&1 | tail -30   # regenerates package-lock.json
   npx tsc --noEmit              # type-check without emitting
   npm run build 2>&1 | tail -20 # actually build
   ```
   Commit the `package-lock.json` this produces. Never commit `node_modules/`.
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

## Layout

```
<app-path>/
├── package.json
├── tsconfig.json
├── vite.config.ts        # no `base` — served at host root
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── env.ts            # typed window._env_ shim
│   ├── api.ts            # fetch helpers
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

`src/api.ts` — resolve the upstream URL at module top level, so a missing key
throws at load rather than at the first click:

```ts
import { env } from "./env";

const BASE_URL = env.API_BASE_URL; // or env.TODO_API_URL for a specific upstream
if (!BASE_URL) {
  throw new Error("API_BASE_URL not set in window._env_");
}
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

`workload.yaml` follows the standard format (one `http` endpoint,
`visibility: [external]`). A web-app may additionally declare its own safe
defaults, which become entries in `window._env_` — never secrets or per-env
values, which the platform owns:

```yaml
configurations:
  env:
    - name: SUPPORT_EMAIL
      value: support@example.com
```

## Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| SPA throws on load: `window._env_ not set` | `/env-config.js` failed to load — path wrong, 404, or the `<script>` was `defer`/`async` | Make the tag synchronous in `<head>`, BEFORE the bundle's `<script type="module">`. |
| `nginx: [emerg] host not found in upstream "thunder-service..."` at pod start | Legacy `/oidc/` proxy block in `nginx/default.conf` | Delete the block. The browser posts cross-origin. |
