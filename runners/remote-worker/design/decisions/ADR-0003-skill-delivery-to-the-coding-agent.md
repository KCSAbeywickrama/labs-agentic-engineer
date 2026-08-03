# ADR-0003 — Skill delivery to the coding agent: allowlist the mirror, preload the pins

The BFF mirrors the coding-relevant slice of the org skill library into the
project clone at `.claude/skills/`, and records per component which of those a
build needs (`skillsPinned` in `design.json`). The runner's job is to turn that
into what the agent actually has: pinned guidance present without being asked
for, the rest of the mirror available if the work turns out to need it.

The Claude Agent SDK appeared to offer this in one option. It does not, and the
gap between the documented shape and the measured behaviour is the whole reason
this decision exists.

## What the SDK actually does

Three properties, each verified by driving the SDK directly rather than read off
the type definitions:

- **`settingSources` gates discovery.** With `settingSources: []` — the value
  the runner shipped, to keep a developer's `~/.claude` out of a container — a
  skill sitting in the clone's `.claude/skills/` is absent from the session
  entirely. With `["project"]` it is present. There is no "native discovery" of
  the working directory; discovery is a setting.
- **`skills:` is an allowlist, not a preference.** A discovered skill omitted
  from the array is rejected outright: `Skill <name> is not in this session's
  skills allowlist`.
- **Nothing in `skills:` is preloaded.** Membership buys a name and a
  description in the catalog. The body arrives when the model invokes the skill.
  An agent holding a listed skill cannot state a codeword written in that
  skill's body until it calls the tool.

## Decision

**Discovery on, the whole mirror allowed, pinned bodies on the system prompt.**

- `settingSources: ["project"]` — the project source resolves relative to `cwd`,
  which is the clone the platform provisioned. `user` and `local` stay out; the
  isolation that `[]` was protecting was the host's settings, not the platform's
  own mirror.
- `skills:` carries the base plugin's skills **plus every skill in the mirror**
  (`listMirroredSkills`), not just the pinned ones. The mirror is already the
  filtered set — audience and availability were decided by the BFF — so allowing
  a subset of it would put the same policy in two places and leave the rest as
  inert files on disk.
- Pinned skills' bodies are appended to the `claude_code` system-prompt preset
  (`readSkillBodies`). A pin is a design-time statement that this guidance *is*
  needed, so it should not depend on the model choosing to look. The appendix
  says the bodies are already loaded, or an agent that also sees them in the
  catalog will helpfully invoke the tool and pay for the same text twice.
- The run compares the `init` message's resolved skill list against what it
  asked for and warns on any gap (`skills_preload_check.ts`). It warns rather
  than fails: missing guidance degrades a build, aborting loses it.

## Consequences

- **`strictMcpConfig: true` is now required, not optional.** Admitting the
  project source also admits the clone's `.mcp.json`, so a project repo could
  otherwise declare MCP servers into its own build. That exclusion used to fall
  out of `settingSources: []` for free; it is now stated. Servers passed
  programmatically are unaffected.
- Admitting the project source also loads the repo's `CLAUDE.md`. That is the
  project's own guidance in a build of that project, which is appropriate.
- **A pinned skill's body is paid for on every turn**, being system-prompt
  content, whereas an on-demand load is paid once when invoked. That is the
  trade a pin buys: certainty over cost. It bounds how many skills a component
  should pin, and is a reason for pins to stay a short list rather than
  "everything that might apply".
- **This corrects a claim that was wrong for as long as it existed.** The
  runner's comments asserted that `skills:` "injects full bodies at startup",
  through the earlier synthesized `aep-task-skills` plugin as well as the mirror
  that replaced it. The same wrong model produced #295's "pinned skills preload,
  the rest available on demand" — accurate as intent, unimplementable as
  written. Unpinned skills were rejected by the allowlist for that whole period,
  and the symptom was benign: the agent grepped `SKILL.md` out of the tree and
  the build passed, so nothing surfaced.
- The lesson worth keeping: **a skill arriving by the agent's own exploration is
  indistinguishable, in a passing build, from a skill the platform delivered.**
  The `init`-message check exists because that class of failure cannot be seen
  in an outcome; it has to be asserted against what the SDK reports.
