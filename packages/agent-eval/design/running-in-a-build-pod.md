# Running in a build pod

This package is a workspace package of the platform monorepo, but the place it
actually earns its keep is a build pod — the `remote-worker` container where the
coding agent generates an ai-agent component and, before opening the PR,
evaluates what it built. A build pod holds no monorepo. Two things follow.

## The harness ships in the runner image

`runners/remote-worker/Dockerfile` installs this package at
`/opt/aep/agent-eval` (`$AEP_AGENT_EVAL_HOME`) and puts a one-line wrapper on
`PATH` as `agent-eval`. It reaches the image through a BuildKit **named build
context** (`--build-context agent-eval=packages/agent-eval`), the same mechanism
the skill library and the `bal library` tool already use, and every builder of
that image passes it: `release.yml`'s matrix row,
`deployments/scripts/build-runner.sh`, and `runners/remote-worker/local/run-local.sh`.
`runners/remote-worker/src/agent_eval_packaging.test.ts` pins all three — a
context passed by one builder and not another produces an image that carries the
harness locally and not in the cloud, which is the failure this step is least
able to notice on its own.

It runs from SOURCE under `tsx`, the interpreter that image's ENTRYPOINT already
uses, rather than being compiled to `dist/`. Compiling in the image would need
the monorepo's `tsconfig.base.json`, which is outside every build context that
image has; duplicating those compiler options into the Dockerfile would be a
copy that can silently disagree with the one the tests compile against.

Dependencies install with `npm ci` from `package-lock.json` — a second lockfile
beside the workspace's `pnpm-lock.yaml`, exactly as `runners/remote-worker`
carries one. **Bump a dependency and both have to move**
(`npm install --package-lock-only` here). The loud failure is `npm ci` refusing
an out-of-sync lockfile during an image build; the quiet one is a pod grading
agents against a promptfoo the tests never saw, and a score nobody can reproduce.

It is a large install — promptfoo pulls every model provider's SDK, and the
layer measured **~2.3 GB**. It sits deliberately BEFORE the runner's own sources
in the Dockerfile so a runner source edit does not re-run it.

## The credential arrives under a different name

In a pod the org's Anthropic key arrives as `AEP_EVAL_ANTHROPIC_API_KEY`, not as
`ANTHROPIC_API_KEY`. That name already belongs to Claude Code, whose
authentication precedence ranks it above `CLAUDE_CODE_OAUTH_TOKEN` — so a
platform that mounted the evaluation key there would move the coding session of
every OAuth-billing organization onto it in silence (`docs/decisions/ADR-0016`).

`buildChildEnv` therefore resolves `AEP_EVAL_ANTHROPIC_API_KEY` first and
`ANTHROPIC_API_KEY` second — the fallback is what makes the harness work
unchanged on a developer's machine, where the second name is the only one there
is. It forwards the resolved value to the promptfoo child under BOTH names the
run needs (`ANTHROPIC_API_KEY` for the judge, `MODEL_API_KEY` for the agent under
test), and it never treats `CLAUDE_CODE_OAUTH_TOKEN` as a fallback: that is the
platform's own coding budget, and it authenticates none of the API calls the
judge makes.

With no key at all the agent boots without a `MODEL_API_KEY`, answers 503 on its
own `/healthz`, and the report says it never became ready. The run still exits 0.
Evaluation reports; it never fails a build.
