# SPIKE — evalite as the eval harness (wayfinder ticket #353)

Throwaway prototype, NOT production code. Proves evalite can host a multi-turn
eval of the requirements section: it drives the REAL agents service in-process
through the playground's production-parity waist (`openSession` + `runSpecTurn`),
runs the `/start` interview with an LLM-simulated product owner answering from
a scenario brief, and scores the produced `specs/requirements/requirements.md`
with a deterministic structural scorer plus an LLM rubric judge.

## Layout — data-driven

| Piece | File |
|---|---|
| Scenario artifacts (one eval case each): `brief` = the sim-user prompt side, `rubric` = the evaluation side | `scenarios/*.yaml` |
| Section driver with full tracing | `driver.ts` |
| Simulated product owner (answers strictly from the brief; never sees the rubric) | `sim-user.ts` |
| The eval: loads every scenario, wires scorers | `requirements.eval.ts` |
| Sample artifact from a real run | `sample-output/requirements.md` |

Add a scenario = drop another `scenarios/<name>.yaml`. No code changes.

## Run

```
npm install
npx evalite run      # once
npx evalite serve    # once + local web UI (scores, judge evidence, per-turn traces)
```

Requires `ANTHROPIC_API_KEY` (read from `deployments/.env` if unset). Not a
workspace package — imports repo TS sources by absolute path, so paths are
machine-specific.

## Full agent communication per run

- **evalite serve UI → Traces**: one trace per turn (instruction in, agent text
  + questions + sim answers out, timing).
- `playground/.projects/evalite-spike/<name>.transcript.md` — readable
  agent↔sim conversation plus the produced document.
- `playground/.projects/evalite-spike/<name>.trace.json` — the raw, unabridged
  `StreamPart` stream of every turn (every text delta, tool call, tool result).
- The generated project itself: `playground/.projects/evalite-spike/<name>/`.

Verdict and full findings: the resolution comment on
https://github.com/wso2/labs-agentic-engineer/issues/353
