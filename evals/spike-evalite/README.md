# SPIKE — evalite as the eval harness (wayfinder ticket #353)

Throwaway prototype, NOT production code. Proves evalite can host a multi-turn
eval of the requirements section: it drives the REAL agents service in-process
through the playground's production-parity waist (`openSession` + `chatTurn`),
runs the `/start` interview with an LLM-simulated product owner answering from
a scenario brief, and scores the produced `specs/requirements/requirements.md`
with a deterministic structural scorer plus an LLM rubric judge.

Run (standalone dir, not a workspace package — imports repo TS sources by
absolute path, so paths are machine-specific):

```
npm install
npx evalite run     # once;  `npx evalite serve` for the local UI
```

Requires `ANTHROPIC_API_KEY` (read from `deployments/.env` if unset).
`sample-output/requirements.md` is the artifact one real run produced
(score 77%: structural 5/5; rubric judge 3.2/6 — it correctly caught that the
interview never asked about notifications, so the brief's Slack fact is
missing from the document).

Verdict and full findings: the resolution comment on
https://github.com/wso2/labs-agentic-engineer/issues/353
