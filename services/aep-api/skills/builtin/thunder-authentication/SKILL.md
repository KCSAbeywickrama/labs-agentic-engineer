---
name: thunder-authentication
description: How the platform's Thunder IDP is wired into SPAs that sign users in. Covers the thunder-app platform-resource dependency that triggers auth, the per-dependency Thunder OAuth client (platform-owned — agent never sees client_id), the window._env_.THUNDER_* key set, and OIDC client wiring with oidc-client-ts. Pairs with react-webapp when the SPA wiring patterns apply. Apply on any project whose spec implies users sign in.
metadata:
  aep.version: "1"
---

# Thunder Authentication

## What this skill does

The platform delegates end-user authentication to Thunder (the WSO2
Identity Provider running on the cluster). This skill tells the
architect when to mark a web-app for sign-in, what the BFF provisions
behind the scenes, and how the SPA code reads OIDC config at runtime to
sign users in via Authorization Code + PKCE.

## Platform facts

- One Thunder application is provisioned per `thunder-app` platform-resource
  dependency, created by the platform's Thunder Application operator once the
  dependency is provisioned. Its `client_id` is the OpenChoreo resource name.
  The agent never sees or hardcodes the `client_id`, `client_secret`, or
  redirect URIs — the platform owns them.
- The redirect URIs are platform-managed — computed from the SPA's public
  URL. They are never user- or architect-supplied.
- The platform reads the OIDC config from the `thunder-app` resource's
  binding outputs and writes it into `window._env_` via the SPA's
  ReleaseBinding, once the dependency is provisioned AND the SPA's public
  URL exists. Authoritative keys (use these EXACT spellings — inventing one
  produces a `ReferenceError` at module load because the value is
  `undefined`):

  | Key | Meaning |
  |---|---|
  | `THUNDER_URL` | OIDC issuer / authority for `oidc-client-ts` |
  | `THUNDER_CLIENT_ID` | the `thunder-app` resource's OAuth client id |
  | `THUNDER_REDIRECT_URI` | absolute URL of this SPA's `/callback` route |
  | `THUNDER_SCOPES` | space-separated OIDC scopes (e.g. `openid profile email`) |
  | `THUNDER_AFTER_SIGN_IN_URL` | absolute URL to land on after sign-in (usually the SPA root) |

- The Thunder OIDC discovery endpoint is `<THUNDER_URL>/.well-known/openid-configuration`.
- Token endpoint: `<THUNDER_URL>/oauth2/token`. The SPA posts to it
  cross-origin — there is NO same-origin `/oidc/` proxy in nginx.
- Default Thunder admin user (dev clusters): `admin` / `admin` in the
  `Administrators` group. Real orgs add their own users via Thunder's
  admin console / SCIM.
- Switching IDPs (Asgardeo, custom) is a settings-page action against
  the org's `OrganizationIDPProfile` record — NOT a skill edit. The
  `THUNDER_*` keys are emitted for every SPA that declares a `thunder-app`
  dependency; a future PR honours the profile flavour. Until
  then, attaching an `asgardeo-authentication` custom skill produces
  code that *talks Asgardeo client semantics against a Thunder backend*
  — the OIDC handshake completes but Asgardeo-specific extensions
  don't apply.

## Recommended practice

### Architect

**The sign-in trigger is an explicit `thunder-app` dependency — nothing
else provisions auth.** When the spec implies users sign in (keywords:
`login`, `sign in`, `user account`, `personal`, ...), the SPA **and** every
backend it calls each declare the SAME `platform-resource` dependency of
type `thunder-app`:

```json
{ "kind": "platform-resource", "name": "user-auth", "resourceType": "thunder-app", "description": "sign-in for shoppers" }
```

- Call `list_platform_resource_types` FIRST — never guess the type.
  `thunder-app` is the platform's auth resource type; it outputs
  `client_id` / `issuer` / `jwks_url` / `scopes`.
- You MAY propose the `scopes` parameter value derived from the spec — this
  is the one explicit exception to the never-invent-parameters rule (default
  `openid profile email`).
- NEVER set `redirectUris` — they are platform-managed (computed from the
  SPA's public URL).
- Do NOT emit `exposesAPI.auth: end-user-required` on the backend yourself —
  the platform DERIVES it from the shared `thunder-app` dependency. Setting
  an explicit `service-required` alongside the dependency is a validation
  error.
- Declare the dependency on the SPA and on each protected backend with the
  SAME dependency `name`, so the SPA signs in and its API calls carry a
  token the backend's gateway accepts. Without the dependency, NO Thunder
  application is provisioned, NO `THUNDER_*` keys land in `window._env_`,
  and the SPA deploys unable to sign in.

- The web-app's `componentAgentInstructions` MUST say (verbatim or close):
  `OIDC Authorization Code + PKCE against the platform IDP using oidc-client-ts. Read OIDC + upstream URLs from window._env_.THUNDER_* / window._env_.<UPSTREAM>_URL — typed via src/env.ts. Attach Authorization: Bearer <access_token> to every API call. DO NOT write a .env file. DO NOT read environment variables at build time (no import.meta.env). DO NOT use envsubst, /etc/nginx/templates/, or any custom nginx entrypoint — stock nginx:alpine serves the static bundle + env-config.js.`
- Do NOT create a separate `auth` / `identity` / `login` /
  `session` / `user-service` component. Thunder owns token issuance;
  the API just reads `X-User-Id` (covered by `api-management`).
- Do NOT add `/auth/login`, `/auth/register`, `/auth/logout` endpoints
  to ANY backend service. Thunder issues tokens; the SPA initiates the
  redirect.

### Tech-lead — issue body bullets

For every web-app task whose component declares a `thunder-app` dependency:

- Scope: "Implement OIDC Authorization Code + PKCE using
  `oidc-client-ts`, configured from `window._env_.THUNDER_*`. The
  platform writes OIDC + upstream URLs into `env-config.js` via the
  SPA's ReleaseBinding; the agent's `index.html` loads it synchronously
  before the bundle. Read values via the typed `src/env.ts` shim and
  throw at module top-level on missing keys — no `?? ''` fallback. Do
  NOT write a `.env` file. Do NOT use `import.meta.env.VITE_*`."
- Scope: "Attach `Authorization: Bearer <access_token>` to every
  `window._env_.API_BASE_URL` fetch. On 401, restart the login flow
  via `signIn()`. Do NOT write a `/login` form that POSTs credentials
  anywhere."
- Acceptance criteria: "Loading the webapp unauthenticated redirects to
  the OIDC authorize endpoint; after sign-in, the user lands back on
  the app with a token in sessionStorage; subsequent API calls carry
  `Authorization: Bearer <token>` and return per-user data; reloading
  the page keeps the user signed in."

### Coding agent — implementation

`src/env.ts` — the base shim (the `window._env_` presence guard,
`API_BASE_URL`, any `<UPSTREAM>_URL` keys, and the `export const env`)
is owned by the `react-webapp` skill — don't duplicate it. When the
component declares a `thunder-app` dependency, the platform
also populates the `THUNDER_*` keys; extend the `Env` type with them:

```ts
type Env = {
  API_BASE_URL: string;
  // ...plus any <UPSTREAM>_URL keys (see react-webapp).
  THUNDER_URL: string;
  THUNDER_CLIENT_ID: string;
  THUNDER_REDIRECT_URI: string;
  THUNDER_SCOPES: string;
  THUNDER_AFTER_SIGN_IN_URL: string;
};
```

`src/auth.ts` — `oidc-client-ts` wired to `env.THUNDER_*`:

```ts
import { UserManager, WebStorageStateStore } from "oidc-client-ts";
import { env } from "./env";

export const userManager = new UserManager({
  authority: env.THUNDER_URL,
  client_id: env.THUNDER_CLIENT_ID,
  redirect_uri: env.THUNDER_REDIRECT_URI,
  post_logout_redirect_uri: env.THUNDER_AFTER_SIGN_IN_URL,
  response_type: "code",
  scope: env.THUNDER_SCOPES,
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  loadUserInfo: false,
});

export async function signIn()         { await userManager.signinRedirect(); }
export async function signOut()        { await userManager.signoutRedirect(); }
export async function handleCallback() { return userManager.signinRedirectCallback(); }

export async function getAccessToken(): Promise<string | null> {
  const user = await userManager.getUser();
  return user?.access_token ?? null;
}
```

Add a `/callback` route in your router that calls `handleCallback()`
once on mount and then navigates to `/`.

`src/api.ts` — attach `Authorization: Bearer <token>`; redirect on 401:

```ts
import { env } from "./env";
import { getAccessToken, signIn } from "./auth";

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function listTodos() {
  const res = await fetch(`${env.API_BASE_URL}/todos`, {
    headers: await authHeaders(),
  });
  if (res.status === 401) { await signIn(); return []; }
  return res.json();
}
```

### Don't

- ❌ Write a `/login` form that POSTs credentials to your API. Thunder
  owns token issuance.
- ❌ Invent `THUNDER_ISSUER` — the key is `THUNDER_URL`.
- ❌ Add a same-origin `/oidc/` proxy in nginx. The browser posts to
  `${env.THUNDER_URL}/oauth2/token` cross-origin.
- ❌ Hardcode the `client_id`. It changes per project; the BFF puts it in
  `window._env_.THUNDER_CLIENT_ID`.
- ❌ Add Thunder client provisioning code anywhere — the platform's Thunder
  Application operator does it when the `thunder-app` dependency is provisioned.

### Common pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| SPA loads, redirects to `undefined/oauth2/authorize` | Agent invented `THUNDER_ISSUER`; the real key is `THUNDER_URL` | Use `env.THUNDER_URL`. |
| After login, the callback shows "invalid redirect URI" | Agent overrode `redirect_uri` from a hardcoded value | Always use `env.THUNDER_REDIRECT_URI`; the BFF computed it. |
| Sign-in loops endlessly | `oidc-client-ts` written without `WebStorageStateStore({ store: sessionStorage })` | Use the constructor shown above; without it, state and PKCE verifier don't survive the redirect. |
| Callback route never resolves | Router intercepts `/callback` before mounting the handler | Make sure the route is registered + reachable AND calls `handleCallback()` once; the platform's `THUNDER_REDIRECT_URI` points at this path. |
