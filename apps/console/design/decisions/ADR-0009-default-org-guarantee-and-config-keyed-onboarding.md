# ADR-0009: Default org is a platform guarantee; onboarding gates on config, not org existence

- **Status:** Accepted
- **Date:** 2026-07-10 (grilling of the onboarding feature,
  [#102](https://github.com/wso2/labs-agentic-engineer/issues/102))
- **Context:** the onboarding issue originally opened with a
  create-organization wizard step and a `POST /organizations` contract
  question (aep-api is deliberately read-only over OC namespaces). Phase 1
  was refactored: every user gets a **default organization** provisioned
  platform-side at signup. Console-side org creation was proposed and
  rejected.

## Decision

The platform guarantees that by the time the console receives a token, the
user's default org exists and the JWT carries its `ou*` claim. The console
therefore **assumes `orgHandle` is non-null after sign-in** and keeps no
zero-org state, no org-creation UI, and no lazy "ensure my org" call.

First-run onboarding is keyed on **org configuration, not org existence**:
if `GET /config` reports `gitProvider` or `llm` as `null`, the console hard-
gates every route into the onboarding wizard (#102). Config is org-level,
so resume-after-abandon and "later members of a configured org skip
onboarding" need no extra bookkeeping.

## Consequences

- No console feature may introduce org-creation UI or a zero-org state;
  supersede this ADR explicitly if multi-org creation becomes a product
  goal.
- `orgHandle ?? "default"`-style fallbacks in the codebase are legacy
  defensiveness, not a supported state; new code must not add them.
- The onboarding gate's trigger is `GET /config` completeness only — no
  "is the org bootstrapped" contract signal exists or should be requested
  for gating.
- If the platform-side guarantee is ever weakened (JWTs without `ou*`
  claims in some flow), that is a platform bug, not a state the console
  handles.
