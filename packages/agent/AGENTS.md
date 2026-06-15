# AGENTS.md — packages/agent

Shared agent building blocks — the **SDK-agnostic** surface: skills, tool
schemas, prompt fragments, the `anthropic-key-resolver`, shared types.

**Status:** empty bucket. Consolidated from the three skill locations
(`asdlc-service/skills`, `agents/src/skills`, `remote-worker/plugin/skills/asdlc`)
when services are ported (`plan.md` §10). Ownership of that merge is a deferred
decision (`plan.md` §0).

## Conventions

- SDK-specific wiring stays in each consumer, not here: the spec agents use the
  Vercel AI SDK; the coding-agent runner uses the Claude Agent SDK.
- Latest Claude models by default (see the `claude-api` skill for model ids).
