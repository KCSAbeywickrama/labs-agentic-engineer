# A test user's token, minted server-side for the invoke relay

**What is true.** `InvokeRequest.actAs.testUser` makes the console's Try it
relay a call AS one of the project's platform-owned test accounts. aep-api
signs that account in to the project's environment identity provider and
forwards its token; the caller's own bearer is not sent, no `X-User-Id` is
set, and the token never leaves the process.

**Why a mint, and why here.** A protected component's gateway accepts one
thing: a token the ENVIRONMENT's identity provider issued for the project's
resource server. The console's sign-in is the platform provider's, and neither
token exchange nor jwt-bearer is authorised for any client here, so no
translation of the caller's session exists. The project's test users are the
right identities — they exist for exactly this (ADR-0022) — and the platform
already holds their sealed passwords for the validation agent. Minting inside
the relay, rather than returning a token to the browser, keeps the relay's
invariant ("a body-supplied Authorization is never accepted") and keeps the
credential and the token on the server.

**The fences are the panel's.** `TestUserTokenMinter` reaches ownership through
`PanelService.resolveOwned`: the project must declare the username and the
platform must own the account. Whoever could not reveal the password cannot
mint with it. `ErrPanelNotFound` is the answer to both, for the same reason
Reveal gives it: describing the difference would describe an account the
caller may not have.

**The protocol is the Gate's** (`clients/thunderflow`): authorize with a
registered `redirect_uri` and the `resource`; open the view; submit
credentials selecting the action with the key `action`; hand the assertion
and `authId` to `/oauth2/auth/callback`; exchange the code with the PKCE
verifier as the public client. Two facts cost an hour and are pinned by tests:
`actionRef` is ignored and re-renders the view — indistinguishable from a wrong
password — and `authId` belongs to the callback, not to any execute body. A
re-rendered view after credentials is `ErrRefused`, surfaced at once.

**Scopes are asked for, not assumed.** The issuer narrows a request to what the
account's roles grant on the resource, so the mint asks for `openid` plus the
account's published scopes (the panel's own union); asking for `openid` alone
would get `openid` alone.

**The registered redirect exists because of `TRY_IT_CALLBACK_URL`.** Nothing
listens there; the code is read off the callback's answer. It is registered on
every sign-in resource by the deploy stage (runtimeconfig), which is what lets a
project with no web app be signed in to at all.

**Not built, on purpose.** A token-returning endpoint (a later tester SPA may
need one); acting as anyone but a platform-owned test user; a retry on refusal.
