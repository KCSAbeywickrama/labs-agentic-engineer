# thunder-app identity-claim contract

Every OAuth app the operator provisions carries the SAME identity claims, so a
signed-in user's end-user token is role-aware. This is a platform-wide contract
hardcoded in the operator (`internal/thunder/client.go`), NOT a per-app CR field
— it mirrors the seeded Console app
(`deployments/dev-thunder-setup/bootstrap/60-aep-console.yaml`). Companion to
`thunder-application-reconciler.md` and ADR-0006 (why auth is a platform
resource).

## What the operator emits

On BOTH create and update — so an app provisioned before this contract existed
self-heals on its next reconcile rather than staying bare — `EnsureApplication`
sets on the OAuth app:

- `token.idToken.userAttributes` **and** `token.accessToken.userAttributes` =
  `given_name, family_name, username, groups, email, name, ouId, ouName, ouHandle`.
- `scopeClaims`: `group → [groups]`, `ou → [ouId, ouName, ouHandle]`,
  `profile → […]`, `email → […]`.
- top-level `allowedUserTypes: [Person]` (lets org users authenticate).

The `thunder-app` `ClusterResourceType`'s `scopes` default is
`openid profile email group ou` (was `openid profile email`) — the SPA requests
those, and the operator's `scopeClaims` release the matching claims. The claim
set is a shared constant (`identityUserAttributes`, `tokenClaimConfig`,
`scopeClaimConfig`, `allowedUserTypes`) used by both `createApp` and `updateApp`.

## Why the id_token + the group/ou scopes (the decision)

The SPA reads roles from `user.profile.groups` — i.e. the **id_token**. Verified
empirically on Thunder 0.34 by driving the full auth-code+PKCE flow for a real
org user:

| requested scope | id_token `groups` | access_token `groups` |
|---|---|---|
| `openid profile email` | absent | present |
| `openid profile email group ou` | present | present |

So `groups` reaches the id_token ONLY when the `group` scope is granted (given
the `scopeClaims` map + `idToken.userAttributes` above). That is why `group` and
`ou` are in the default scope set — omit them and a role-aware SPA sees no role
(the original "Unknown role" bug).

**Chosen over** having the SPA decode the **access token** for groups: that
token is opaque to a public client by design, and decoding it in every app (plus
teaching the skill to) is worse than standard-OIDC id_token claims. See the
`thunder-authentication` skill for the SPA side.

**Chosen over** making the claim set a per-app CR / resourcetype parameter:
identity claims are a platform contract that shouldn't vary per app; a per-app
knob only invites the "forgot `groups` → no role" misconfig this fixes. `scopes`
stays the one genuinely variable knob (already a resourcetype parameter), and it
is inert for apps that don't check roles — the extra claims simply go unread.

## Scope

Single-cluster (v1 local) only today: the `thunder-app` operator is not part of
the cloud deployment (`deployments-v2/wso2cloud-deployment` has no
`ThunderApplication`). When end-user auth is promoted there, this contract
travels with the operator source.
