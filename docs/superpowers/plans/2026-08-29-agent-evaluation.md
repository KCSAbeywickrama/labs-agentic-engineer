# Agent Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During an ai-agent's build, run scenario-based evaluations against the
agent it just wrote, revise the PROMPT when a scenario scores poorly, and open a
second PR when the prompt changed.

**Architecture:** A published package (`@aep/agent-eval`) supplies a promptfoo
custom provider that boots the generated agent in-process, stubs its tool
providers from their committed OpenAPI contracts, and drives a simulated-user
conversation, returning the transcript for promptfoo to grade. The
`agent-building` skill tells the coding agent to run it, read the JSON verdict,
and revise the prompt within bounds. Scenarios are authored at design time from
the requirements alone.

**Tech Stack:** TypeScript (Node 22, `nodenext`), promptfoo (pinned), Vercel AI
SDK v7 (already the agent's), zod, vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-agent-evaluation-design.md` — read
it before Task 1. Every decision below argues from it.

## Global Constraints

- **The loop may change the PROMPT ONLY** — the `# Role` / `# Instructions` /
  `# Style` body of `agent.afm.md`. Never front matter. `x-aep.tools.openapi[].allow`
  is the security boundary; a loop widening it grants itself permissions.
- **Threshold is 0.8** of achievable `mustCover` weight, with ZERO tolerance for
  any `mustNot` violation.
- **Hard iteration cap of 3.** Stop early if a round scores worse than the one
  before it, and keep the earlier prompt.
- **The best-scoring prompt ships**, not the last one tried.
- **Evaluation reports; it never fails the build.** A low score is report
  content.
- **Scenarios derive from `specs/requirements/` ONLY** — never from
  `agent.afm.md`.
- **The org's Anthropic key** is the credential, for both the agent under test
  and the judge. Never `CLAUDE_CODE_OAUTH_TOKEN`.
- **promptfoo's version is PINNED.** Never `@latest`.
- Apache licence header on every new source file; `make license-check` passes.
- Comments explain WHY, not what.

---

## File Structure

**New package — `packages/agent-eval/`** (`@aep/agent-eval`)

| File | Responsibility |
|---|---|
| `src/scenario.ts` | zod schema for `agent-scenarios.json`; parse + validate |
| `src/stub-server.ts` | serve a provider's `openapi.yaml` with deterministic fixtures |
| `src/sim-user.ts` | the simulated user: answers from `brief`, withholds what `withholds` names |
| `src/conversation.ts` | drive one scenario end-to-end, return a transcript |
| `src/provider.ts` | the promptfoo custom provider (`callApi`) wrapping the above |
| `src/config.ts` | emit a `promptfooconfig.yaml` from a scenario file |
| `src/verdict.ts` | read promptfoo's JSON output into a typed verdict |
| `bin/agent-eval.ts` | CLI the coding agent invokes |

**Modified**

| File | Change |
|---|---|
| `skills/agent-building/references/designing.md` | authoring `agent-scenarios.json` |
| `skills/agent-building/references/building.md` | the eval step + the bounded fix loop |
| `skills/validation-criteria/SKILL.md` | emit agent scenarios alongside criteria |

---

### Task 1: The scenario schema

**Files:**
- Create: `packages/agent-eval/package.json`, `tsconfig.json`, `src/scenario.ts`
- Test: `packages/agent-eval/test/scenario.test.ts`

**Interfaces:**
- Produces: `parseScenarios(json: unknown): ScenarioFile`, types `ScenarioFile`,
  `Scenario`, `Rubric`, `RubricItem`. Throws `ScenarioError` with a path-prefixed
  message on invalid input.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseScenarios } from "../src/scenario.js";

const VALID = {
  version: 1,
  component: "trip-agent",
  scenarios: [
    {
      id: "SC-001",
      criteria: ["AC-003-a"],
      brief: { goal: "Book three nights in London", facts: { city: "London" }, withholds: ["dates"] },
      rubric: {
        mustCover: [{ id: "MC-1", must: "Asks for the missing dates", weight: 2 }],
        mustNot: [{ id: "MN-1", mustNot: "States a price the API did not return" }],
      },
    },
  ],
};

describe("parseScenarios", () => {
  it("accepts a well-formed file and defaults an omitted weight to 1", () => {
    const parsed = parseScenarios(VALID);
    expect(parsed.scenarios[0]!.rubric.mustCover[0]!.weight).toBe(2);
    expect(parsed.component).toBe("trip-agent");
  });

  // A rubric that asserts nothing cannot fail, so it would report green forever.
  it("rejects a rubric with neither mustCover nor mustNot", () => {
    const bad = structuredClone(VALID);
    bad.scenarios[0]!.rubric = { mustCover: [], mustNot: [] } as never;
    expect(() => parseScenarios(bad)).toThrow(/rubric/i);
  });

  // Scenario ids are cited in reports and in the fix loop's reasoning.
  it("rejects duplicate scenario ids", () => {
    const bad = structuredClone(VALID);
    bad.scenarios.push(structuredClone(bad.scenarios[0]!));
    expect(() => parseScenarios(bad)).toThrow(/SC-001/);
  });

  it("names the offending path in the error", () => {
    expect(() => parseScenarios({ version: 1, component: "x", scenarios: [{ id: "SC-1" }] }))
      .toThrow(/scenarios\[0\]/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/agent-eval && corepack pnpm vitest run test/scenario.test.ts`
Expected: FAIL — cannot resolve `../src/scenario.js`

- [ ] **Step 3: Implement**

```ts
import { z } from "zod";

const rubricItem = z.object({
  id: z.string().min(1),
  must: z.string().min(1),
  weight: z.number().positive().default(1),
});
const mustNotItem = z.object({ id: z.string().min(1), mustNot: z.string().min(1) });

const rubric = z
  .object({ mustCover: z.array(rubricItem).default([]), mustNot: z.array(mustNotItem).default([]) })
  // A rubric with nothing in it cannot fail, so a scenario carrying one would
  // report green forever while testing nothing.
  .refine((r) => r.mustCover.length + r.mustNot.length > 0, {
    message: "rubric: needs at least one mustCover or mustNot entry",
  });

const scenario = z.object({
  id: z.string().min(1),
  criteria: z.array(z.string()).default([]),
  brief: z.object({
    goal: z.string().min(1),
    facts: z.record(z.string(), z.unknown()).default({}),
    // What the sim user KNOWS but will not volunteer — this is what turns
    // "asks for what it needs" into something observable rather than asserted.
    withholds: z.array(z.string()).default([]),
  }),
  rubric,
});

export const scenarioFileSchema = z.object({
  version: z.literal(1),
  component: z.string().min(1),
  scenarios: z.array(scenario).min(1),
});

export type ScenarioFile = z.infer<typeof scenarioFileSchema>;
export type Scenario = ScenarioFile["scenarios"][number];
export type Rubric = Scenario["rubric"];
export type RubricItem = Rubric["mustCover"][number];

export class ScenarioError extends Error {}

export function parseScenarios(input: unknown): ScenarioFile {
  const result = scenarioFileSchema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0]!;
    throw new ScenarioError(`${first.path.join(".") || "<root>"}: ${first.message}`);
  }
  const seen = new Set<string>();
  for (const s of result.data.scenarios) {
    if (seen.has(s.id)) throw new ScenarioError(`duplicate scenario id: ${s.id}`);
    seen.add(s.id);
  }
  return result.data;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/agent-eval && corepack pnpm vitest run`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add packages/agent-eval
git commit -m "feat(agent-eval): the scenario schema, and a rubric that cannot assert nothing"
```

---

### Task 2: The simulated user

**Files:**
- Create: `packages/agent-eval/src/sim-user.ts`
- Test: `packages/agent-eval/test/sim-user.test.ts`

**Interfaces:**
- Consumes: `Scenario` from Task 1.
- Produces: `simAnswer(brief: Scenario["brief"], agentSaid: string, turn: number): string`
  and `withheldValue(brief, name): string | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { simAnswer } from "../src/sim-user.js";

const BRIEF = {
  goal: "Book a hotel in London",
  facts: { city: "London", nights: 3, dates: "25th-28th December" },
  withholds: ["dates"],
};

describe("simAnswer", () => {
  it("opens with the goal and nothing else", () => {
    const said = simAnswer(BRIEF, "", 0);
    expect(said).toContain("London");
    // The withheld fact must NOT be volunteered — that is the whole test.
    expect(said).not.toContain("December");
  });

  it("gives up a withheld fact only when the agent asks for it", () => {
    expect(simAnswer(BRIEF, "Which dates are you travelling?", 1)).toContain("December");
  });

  it("does not volunteer a withheld fact for an unrelated question", () => {
    expect(simAnswer(BRIEF, "How many guests?", 1)).not.toContain("December");
  });

  it("answers a non-withheld fact freely", () => {
    expect(simAnswer(BRIEF, "How many nights?", 1)).toContain("3");
  });

  // A conversation that never ends burns the org's key.
  it("closes the conversation once the agent stops asking", () => {
    expect(simAnswer(BRIEF, "Here are two options.", 2).toLowerCase()).toMatch(/thanks|that's all/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/agent-eval && corepack pnpm vitest run test/sim-user.test.ts`
Expected: FAIL — cannot resolve `../src/sim-user.js`

- [ ] **Step 3: Implement**

```ts
import type { Scenario } from "./scenario.js";

type Brief = Scenario["brief"];

/** The value of a fact the brief holds back until asked for by name. */
export function withheldValue(brief: Brief, name: string): string | undefined {
  if (!brief.withholds.includes(name)) return undefined;
  const v = brief.facts[name];
  return v === undefined ? undefined : String(v);
}

/**
 * What the simulated user says next.
 *
 * Deliberately RULE-BASED, not a model: the sim is part of the measuring
 * instrument, so it must behave identically between two runs of the same
 * scenario. A model here would make a score change unattributable — you could
 * not tell a better prompt from a chattier user.
 */
export function simAnswer(brief: Brief, agentSaid: string, turn: number): string {
  if (turn === 0) return brief.goal;

  const asked = agentSaid.toLowerCase();
  for (const [name, value] of Object.entries(brief.facts)) {
    // A fact is offered when the agent's turn mentions it by name. Withheld
    // facts take the same path — withholding is about not VOLUNTEERING, not
    // about refusing to answer.
    if (asked.includes(name.toLowerCase())) return String(value);
  }
  // Nothing recognisable was asked, so there is nothing to add. Closing keeps
  // a scenario bounded rather than looping on the org's key.
  return "That's all, thanks.";
}
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/agent-eval && corepack pnpm vitest run`
Expected: 9 passed

- [ ] **Step 5: Commit**

```bash
git add packages/agent-eval
git commit -m "feat(agent-eval): a rule-based sim user that withholds until asked"
```

---

### Task 3: Deterministic tool stubs

**Files:**
- Create: `packages/agent-eval/src/stub-server.ts`
- Test: `packages/agent-eval/test/stub-server.test.ts`

**Interfaces:**
- Produces: `startStubServer(spec: unknown): Promise<{ url: string; calls: StubCall[]; close(): Promise<void> }>`
  where `StubCall = { method: string; path: string; operationId?: string }`.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { startStubServer } from "../src/stub-server.js";

const SPEC = {
  openapi: "3.0.0",
  paths: {
    "/hotels": {
      get: {
        operationId: "listHotels",
        responses: {
          "200": {
            content: {
              "application/json": {
                example: [{ id: "h1", name: "The Kensington", price: 210 }],
              },
            },
          },
        },
      },
    },
  },
};

let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });

describe("startStubServer", () => {
  it("serves the contract's example for an operation", async () => {
    const s = await startStubServer(SPEC); stop = s.close;
    const body = await (await fetch(`${s.url}/hotels`)).json();
    expect(body[0].name).toBe("The Kensington");
  });

  // Same input, same output, every iteration — otherwise a score change cannot
  // be attributed to the prompt.
  it("answers identically across calls", async () => {
    const s = await startStubServer(SPEC); stop = s.close;
    const a = await (await fetch(`${s.url}/hotels`)).text();
    const b = await (await fetch(`${s.url}/hotels`)).text();
    expect(a).toBe(b);
  });

  it("records which operations the agent actually called", async () => {
    const s = await startStubServer(SPEC); stop = s.close;
    await fetch(`${s.url}/hotels`);
    expect(s.calls.map((c) => c.operationId)).toEqual(["listHotels"]);
  });

  // An unmodelled path must be visibly absent, not silently empty — otherwise a
  // tool calling the wrong URL looks like a tool returning no results.
  it("404s a path the contract does not define", async () => {
    const s = await startStubServer(SPEC); stop = s.close;
    expect((await fetch(`${s.url}/nope`)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/agent-eval && corepack pnpm vitest run test/stub-server.test.ts`
Expected: FAIL — cannot resolve `../src/stub-server.js`

- [ ] **Step 3: Implement**

```ts
import { createServer, type Server } from "node:http";

export interface StubCall {
  method: string;
  path: string;
  operationId?: string | undefined;
}

interface Op {
  operationId?: string;
  example: unknown;
}

/** Index the contract by `METHOD path` so a request is one lookup. */
function indexOperations(spec: unknown): Map<string, Op> {
  const out = new Map<string, Op>();
  const paths = (spec as { paths?: Record<string, Record<string, unknown>> })?.paths ?? {};
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, opRaw] of Object.entries(methods)) {
      const op = opRaw as {
        operationId?: string;
        responses?: Record<string, { content?: Record<string, { example?: unknown }> }>;
      };
      const example = op.responses?.["200"]?.content?.["application/json"]?.example ?? [];
      out.set(`${method.toUpperCase()} ${path}`, { operationId: op.operationId, example });
    }
  }
  return out;
}

/**
 * A provider component's contract, served from its own declared examples.
 *
 * The world an evaluation runs in must be FIXED: the same prompt against the
 * same stubs twice must produce the same tool calls, or a score change cannot
 * be attributed to the prompt. Serving the contract's `example` also keeps the
 * fixture honest — it is what the provider itself documents, not data invented
 * for the test.
 */
export async function startStubServer(spec: unknown): Promise<{
  url: string;
  calls: StubCall[];
  close: () => Promise<void>;
}> {
  const ops = indexOperations(spec);
  const calls: StubCall[] = [];

  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    const op = ops.get(`${(req.method ?? "GET").toUpperCase()} ${path}`);
    calls.push({ method: req.method ?? "GET", path, operationId: op?.operationId });
    res.setHeader("content-type", "application/json");
    if (!op) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "no such operation in the contract" }));
      return;
    }
    res.end(JSON.stringify(op.example));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/agent-eval && corepack pnpm vitest run`
Expected: 13 passed

- [ ] **Step 5: Commit**

```bash
git add packages/agent-eval
git commit -m "feat(agent-eval): tool stubs served from the provider's own contract examples"
```

---

### Task 4: The promptfoo provider

**Files:**
- Create: `packages/agent-eval/src/conversation.ts`, `packages/agent-eval/src/provider.ts`
- Test: `packages/agent-eval/test/conversation.test.ts`

**Interfaces:**
- Consumes: `simAnswer` (Task 2), `startStubServer` (Task 3), `Scenario` (Task 1).
- Produces: `runConversation(opts: { scenario: Scenario; ask: AskFn; maxTurns?: number }): Promise<Transcript>`
  where `AskFn = (messages: {role: "user"|"assistant"; content: string}[]) => Promise<string>`
  and `Transcript = { text: string; turns: number; messages: {...}[] }`.
  Default export class `AgentEvalProvider` with `id()` and `callApi()`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { runConversation } from "../src/conversation.js";

const SCENARIO = {
  id: "SC-001",
  criteria: [],
  brief: { goal: "Book a hotel in London", facts: { dates: "25th December" }, withholds: ["dates"] },
  rubric: { mustCover: [{ id: "MC-1", must: "asks for dates", weight: 1 }], mustNot: [] },
};

describe("runConversation", () => {
  it("runs turns until the user closes, and returns a readable transcript", async () => {
    const ask = async (msgs: { content: string }[]) =>
      msgs.length === 1 ? "Which dates are you travelling?" : "Here are two options.";

    const t = await runConversation({ scenario: SCENARIO as never, ask });

    expect(t.text).toContain("User: Book a hotel in London");
    expect(t.text).toContain("Agent: Which dates are you travelling?");
    expect(t.text).toContain("User: 25th December");
    expect(t.turns).toBeGreaterThanOrEqual(2);
  });

  // An agent that never stops asking must not run forever on the org's key.
  it("stops at maxTurns even if the agent keeps asking", async () => {
    const ask = async () => "And what dates?";
    const t = await runConversation({ scenario: SCENARIO as never, ask, maxTurns: 3 });
    expect(t.turns).toBe(3);
  });

  it("passes the WHOLE history to the agent each turn, not just the last message", async () => {
    const seen: number[] = [];
    const ask = async (msgs: unknown[]) => { seen.push(msgs.length); return "Which dates?"; };
    await runConversation({ scenario: SCENARIO as never, ask, maxTurns: 3 });
    expect(seen).toEqual([1, 3, 5]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/agent-eval && corepack pnpm vitest run test/conversation.test.ts`
Expected: FAIL — cannot resolve `../src/conversation.js`

- [ ] **Step 3: Implement**

```ts
// src/conversation.ts
import { simAnswer } from "./sim-user.js";
import type { Scenario } from "./scenario.js";

export interface Message { role: "user" | "assistant"; content: string }
export type AskFn = (messages: Message[]) => Promise<string>;
export interface Transcript { text: string; turns: number; messages: Message[] }

const DEFAULT_MAX_TURNS = 6;

/**
 * One scenario, start to finish.
 *
 * `ask` is injected rather than built here so this file has no opinion about
 * HOW the agent is reached — in a build it is an in-process handler; in a test
 * it is a function. That seam is what lets the conversation logic be tested
 * without a model.
 */
export async function runConversation(opts: {
  scenario: Scenario;
  ask: AskFn;
  maxTurns?: number;
}): Promise<Transcript> {
  const max = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const messages: Message[] = [];
  let agentSaid = "";
  let turns = 0;

  for (let i = 0; i < max; i++) {
    const userSays = simAnswer(opts.scenario.brief, agentSaid, i);
    messages.push({ role: "user", content: userSays });
    agentSaid = await opts.ask(messages);
    messages.push({ role: "assistant", content: agentSaid });
    turns = i + 1;
    if (i > 0 && /that's all, thanks/i.test(userSays)) break;
  }

  const text = messages
    .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
    .join("\n");
  return { text, turns, messages };
}
```

```ts
// src/provider.ts
import { runConversation, type AskFn } from "./conversation.js";
import type { Scenario } from "./scenario.js";

/**
 * promptfoo's unit is a prompt and its output; ours is a conversation. The
 * bridge is this provider: it runs the whole conversation and returns the
 * TRANSCRIPT as `output`, which promptfoo's rubrics then grade. promptfoo's
 * `prompts:` field is satisfied but unused — the scenario drives, not a prompt.
 */
export default class AgentEvalProvider {
  private readonly config: { maxTurns?: number };
  constructor(options?: { config?: { maxTurns?: number } }) {
    this.config = options?.config ?? {};
  }
  id(): string {
    return "aep:agent-eval";
  }
  async callApi(
    _prompt: string,
    context?: { vars?: { scenario?: Scenario; ask?: AskFn } },
  ): Promise<{ output: string; metadata: Record<string, unknown> }> {
    const scenario = context?.vars?.scenario;
    const ask = context?.vars?.ask;
    if (!scenario || !ask) throw new Error("agent-eval: scenario and ask are required vars");
    const t = await runConversation({
      scenario,
      ask,
      ...(this.config.maxTurns === undefined ? {} : { maxTurns: this.config.maxTurns }),
    });
    return { output: t.text, metadata: { turns: t.turns, scenarioId: scenario.id } };
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/agent-eval && corepack pnpm vitest run`
Expected: 16 passed

- [ ] **Step 5: Commit**

```bash
git add packages/agent-eval
git commit -m "feat(agent-eval): a promptfoo provider whose output is the whole transcript"
```

---

### Task 5: Config emission and the verdict

**Files:**
- Create: `packages/agent-eval/src/config.ts`, `packages/agent-eval/src/verdict.ts`
- Test: `packages/agent-eval/test/config.test.ts`, `packages/agent-eval/test/verdict.test.ts`

**Interfaces:**
- Consumes: `ScenarioFile` (Task 1).
- Produces: `buildPromptfooConfig(file: ScenarioFile, opts: { providerPath: string; graderModel: string }): unknown`
  and `readVerdict(promptfooJson: unknown): Verdict` where
  `Verdict = { passed: boolean; overall: number; scenarios: ScenarioVerdict[] }` and
  `ScenarioVerdict = { id: string; score: number; passed: boolean; failed: { id: string; reason: string }[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/config.test.ts
import { describe, expect, it } from "vitest";
import { buildPromptfooConfig } from "../src/config.js";

const FILE = {
  version: 1 as const,
  component: "trip-agent",
  scenarios: [
    {
      id: "SC-001",
      criteria: [],
      brief: { goal: "g", facts: {}, withholds: [] },
      rubric: {
        mustCover: [{ id: "MC-1", must: "asks for dates", weight: 2 }],
        mustNot: [{ id: "MN-1", mustNot: "invents a price" }],
      },
    },
  ],
};

describe("buildPromptfooConfig", () => {
  it("pins the grader so a score means the same thing between runs", () => {
    const c = buildPromptfooConfig(FILE, { providerPath: "./p.js", graderModel: "anthropic:messages:claude-sonnet-5" }) as never;
    expect((c as any).defaultTest.options.provider).toBe("anthropic:messages:claude-sonnet-5");
  });

  it("carries each mustCover through with its weight", () => {
    const c = buildPromptfooConfig(FILE, { providerPath: "./p.js", graderModel: "m" }) as any;
    const cover = c.tests[0].assert.find((a: any) => a.metric === "MC-1");
    expect(cover.type).toBe("llm-rubric");
    expect(cover.weight).toBe(2);
  });

  // A mustNot is not a low score — it is a zero. Encoding it as a weighted
  // rubric line would let a good scenario average away a harm.
  it("makes a mustNot a hard failure, not a weighted line", () => {
    const c = buildPromptfooConfig(FILE, { providerPath: "./p.js", graderModel: "m" }) as any;
    const not = c.tests[0].assert.find((a: any) => a.metric === "MN-1");
    expect(not.type).toBe("llm-rubric");
    expect(not.threshold).toBe(1);
  });
});
```

```ts
// test/verdict.test.ts
import { describe, expect, it } from "vitest";
import { readVerdict } from "../src/verdict.js";

const OUT = {
  results: {
    results: [
      {
        success: false,
        score: 0.5,
        metadata: { scenarioId: "SC-001" },
        gradingResult: {
          componentResults: [
            { pass: true, score: 1, assertion: { metric: "MC-1" }, reason: "ok" },
            { pass: false, score: 0, assertion: { metric: "MN-1" }, reason: "invented a price" },
          ],
        },
      },
    ],
  },
};

describe("readVerdict", () => {
  it("names which rubric lines failed, so a fix can cite them", () => {
    const v = readVerdict(OUT);
    expect(v.scenarios[0]!.failed).toEqual([{ id: "MN-1", reason: "invented a price" }]);
  });

  it("does not pass a scenario below the 0.8 threshold", () => {
    expect(readVerdict(OUT).passed).toBe(false);
  });

  it("passes at exactly 0.8", () => {
    const at = structuredClone(OUT);
    at.results.results[0]!.score = 0.8;
    at.results.results[0]!.success = true;
    at.results.results[0]!.gradingResult.componentResults[1]!.pass = true;
    expect(readVerdict(at).passed).toBe(true);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/agent-eval && corepack pnpm vitest run test/config.test.ts test/verdict.test.ts`
Expected: FAIL — cannot resolve `../src/config.js`

- [ ] **Step 3: Implement**

```ts
// src/config.ts
import type { ScenarioFile } from "./scenario.js";

export const THRESHOLD = 0.8;

/**
 * A scenario file becomes a promptfoo config.
 *
 * `mustCover` lines are weighted rubric assertions and average into the score.
 * `mustNot` lines are NOT: each gets `threshold: 1`, so a violation fails its
 * assertion outright rather than being averaged away by a scenario that did
 * well elsewhere. A rubric that tolerates inventing a price 20% of the time is
 * not a rubric.
 */
export function buildPromptfooConfig(
  file: ScenarioFile,
  opts: { providerPath: string; graderModel: string },
): unknown {
  return {
    description: `agent evaluation — ${file.component}`,
    providers: [{ id: `file://${opts.providerPath}` }],
    prompts: ["{{scenario.brief.goal}}"],
    defaultTest: { options: { provider: opts.graderModel } },
    tests: file.scenarios.map((s) => ({
      description: `${s.id}: ${s.brief.goal}`,
      vars: { scenario: s },
      assert: [
        ...s.rubric.mustCover.map((m) => ({
          type: "llm-rubric",
          metric: m.id,
          weight: m.weight,
          value: `${m.must}\n\nTranscript:\n{{output}}`,
        })),
        ...s.rubric.mustNot.map((m) => ({
          type: "llm-rubric",
          metric: m.id,
          threshold: 1,
          value: `The agent did NOT do this: ${m.mustNot}\n\nTranscript:\n{{output}}`,
        })),
      ],
    })),
  };
}
```

```ts
// src/verdict.ts
import { THRESHOLD } from "./config.js";

export interface ScenarioVerdict {
  id: string;
  score: number;
  passed: boolean;
  failed: { id: string; reason: string }[];
}
export interface Verdict { passed: boolean; overall: number; scenarios: ScenarioVerdict[] }

/**
 * promptfoo's JSON, read as the one thing the fix loop needs: which rubric
 * lines failed and why. The reasons are quoted verbatim into the revision
 * prompt, so a fix cites the line that drove it rather than guessing.
 */
export function readVerdict(json: unknown): Verdict {
  const rows =
    (json as { results?: { results?: unknown[] } })?.results?.results ?? [];
  const scenarios: ScenarioVerdict[] = rows.map((rowRaw) => {
    const row = rowRaw as {
      score?: number;
      metadata?: { scenarioId?: string };
      gradingResult?: {
        componentResults?: { pass?: boolean; assertion?: { metric?: string }; reason?: string }[];
      };
    };
    const parts = row.gradingResult?.componentResults ?? [];
    const failed = parts
      .filter((p) => p.pass === false)
      .map((p) => ({ id: p.assertion?.metric ?? "?", reason: p.reason ?? "" }));
    const score = row.score ?? 0;
    return {
      id: row.metadata?.scenarioId ?? "?",
      score,
      passed: score >= THRESHOLD && failed.length === 0,
      failed,
    };
  });
  const overall = scenarios.length
    ? scenarios.reduce((a, s) => a + s.score, 0) / scenarios.length
    : 0;
  return { passed: scenarios.every((s) => s.passed), overall, scenarios };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/agent-eval && corepack pnpm vitest run`
Expected: 22 passed

- [ ] **Step 5: Commit**

```bash
git add packages/agent-eval
git commit -m "feat(agent-eval): emit a promptfoo config, and read its verdict back"
```

---

### Task 6: The bounded fix loop

**Files:**
- Create: `packages/agent-eval/src/loop.ts`
- Test: `packages/agent-eval/test/loop.test.ts`

**Interfaces:**
- Consumes: `Verdict` (Task 5).
- Produces: `runFixLoop(opts: { evaluate: () => Promise<Verdict>; revise: (v: Verdict, body: string) => Promise<string>; body: string; maxRounds?: number }): Promise<LoopResult>`
  where `LoopResult = { body: string; rounds: number; best: Verdict; history: Verdict[] }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { runFixLoop } from "../src/loop.js";

const verdict = (overall: number) => ({
  passed: overall >= 0.8,
  overall,
  scenarios: [{ id: "SC-1", score: overall, passed: overall >= 0.8, failed: [] }],
});

describe("runFixLoop", () => {
  it("stops as soon as the evaluation passes", async () => {
    const evaluate = vi.fn().mockResolvedValue(verdict(0.9));
    const revise = vi.fn();
    const r = await runFixLoop({ evaluate, revise, body: "original" });
    expect(r.rounds).toBe(1);
    expect(revise).not.toHaveBeenCalled();
    expect(r.body).toBe("original");
  });

  // Unbounded iteration on a probabilistic system spends the org's key with no
  // guarantee of converging.
  it("never exceeds the cap", async () => {
    const evaluate = vi.fn().mockResolvedValue(verdict(0.2));
    const revise = vi.fn(async (_v, b: string) => `${b}+`);
    const r = await runFixLoop({ evaluate, revise, body: "x", maxRounds: 3 });
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(r.rounds).toBe(3);
  });

  // The loop can talk itself into a worse agent; the best prompt must ship.
  it("keeps the best-scoring body, not the last one tried", async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce(verdict(0.5))
      .mockResolvedValueOnce(verdict(0.7))
      .mockResolvedValueOnce(verdict(0.3));
    const revise = vi.fn(async (_v, b: string) => `${b}+`);
    const r = await runFixLoop({ evaluate, revise, body: "v0", maxRounds: 3 });
    expect(r.body).toBe("v0+");
    expect(r.best.overall).toBe(0.7);
  });

  it("stops early when a round scores worse than the one before", async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce(verdict(0.6))
      .mockResolvedValueOnce(verdict(0.4));
    const revise = vi.fn(async (_v, b: string) => `${b}+`);
    const r = await runFixLoop({ evaluate, revise, body: "v0", maxRounds: 3 });
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(r.body).toBe("v0");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/agent-eval && corepack pnpm vitest run test/loop.test.ts`
Expected: FAIL — cannot resolve `../src/loop.js`

- [ ] **Step 3: Implement**

```ts
import type { Verdict } from "./verdict.js";

export interface LoopResult {
  body: string;
  rounds: number;
  best: Verdict;
  history: Verdict[];
}

const DEFAULT_MAX_ROUNDS = 3;

/**
 * Evaluate, revise, repeat — within bounds that exist because the system is
 * probabilistic and the model calls are on the org's key.
 *
 * Three rules, each earning its place:
 *  - a CAP, because "iterate until it passes" may never converge;
 *  - keep the BEST-scoring body, because a revision can make the agent worse
 *    and the last attempt is not automatically the right one to ship;
 *  - stop early when a round regresses, because a loop that has started going
 *    backwards has no reason to find its way forward by spending more.
 */
export async function runFixLoop(opts: {
  evaluate: () => Promise<Verdict>;
  revise: (verdict: Verdict, body: string) => Promise<string>;
  body: string;
  maxRounds?: number;
}): Promise<LoopResult> {
  const max = opts.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const history: Verdict[] = [];
  let body = opts.body;
  let bestBody = opts.body;
  let best: Verdict | null = null;

  for (let round = 1; round <= max; round++) {
    const verdict = await opts.evaluate();
    history.push(verdict);

    if (best === null || verdict.overall > best.overall) {
      best = verdict;
      bestBody = body;
    } else if (verdict.overall < history[history.length - 2]!.overall) {
      // Regressed: keep what was better and stop.
      break;
    }

    if (verdict.passed || round === max) break;
    body = await opts.revise(verdict, body);
  }

  return { body: bestBody, rounds: history.length, best: best!, history };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/agent-eval && corepack pnpm vitest run`
Expected: 26 passed

- [ ] **Step 5: Commit**

```bash
git add packages/agent-eval
git commit -m "feat(agent-eval): a fix loop that is bounded, and keeps the best prompt"
```

---

### Task 7: The CLI the coding agent runs

**Files:**
- Create: `packages/agent-eval/bin/agent-eval.ts`, `packages/agent-eval/src/report.ts`
- Test: `packages/agent-eval/test/report.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `renderReport(v: Verdict, opts: { component: string; promptChanged: boolean }): string`,
  and a CLI `agent-eval --scenarios <path> --app <dir> --out <dir>` exiting 0 even
  when scenarios fail.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { renderReport } from "../src/report.js";

const V = {
  passed: false,
  overall: 0.6,
  scenarios: [
    { id: "SC-001", score: 0.6, passed: false, failed: [{ id: "MC-1", reason: "did not ask for dates" }] },
    { id: "SC-002", score: 1, passed: true, failed: [] },
  ],
};

describe("renderReport", () => {
  it("leads with the score and says plainly that it did not gate the build", () => {
    const md = renderReport(V, { component: "trip-agent", promptChanged: true });
    expect(md).toMatch(/0\.6/);
    expect(md).toMatch(/does not fail the build|reported, not enforced/i);
  });

  it("names every failed rubric line with its reason", () => {
    const md = renderReport(V, { component: "trip-agent", promptChanged: false });
    expect(md).toContain("MC-1");
    expect(md).toContain("did not ask for dates");
  });

  // A reader must be able to tell whether the shipped prompt is the authored one.
  it("says whether the prompt was revised", () => {
    expect(renderReport(V, { component: "a", promptChanged: true })).toMatch(/prompt was revised/i);
    expect(renderReport(V, { component: "a", promptChanged: false })).toMatch(/prompt was not changed/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/agent-eval && corepack pnpm vitest run test/report.test.ts`
Expected: FAIL — cannot resolve `../src/report.js`

- [ ] **Step 3: Implement**

```ts
// src/report.ts
import type { Verdict } from "./verdict.js";

/**
 * The report a human reads in a PR. It states the score, every failed rubric
 * line with the judge's own reason, and — the line that stops a reader
 * misunderstanding what happened — that a low score did NOT block the build.
 */
export function renderReport(
  v: Verdict,
  opts: { component: string; promptChanged: boolean },
): string {
  const lines: string[] = [
    `# Agent evaluation — ${opts.component}`,
    "",
    `**Score: ${v.overall.toFixed(2)}** across ${v.scenarios.length} scenario(s).`,
    "",
    opts.promptChanged
      ? "The prompt was revised by evaluation. The revision ships with this build; a separate PR proposes the same change to `agent.afm.md`."
      : "The prompt was not changed — it scored well enough as authored.",
    "",
    "Evaluation is reported, not enforced: a low score does not fail the build.",
    "",
    "## Scenarios",
    "",
    "| Scenario | Score | Result |",
    "|---|---|---|",
    ...v.scenarios.map((s) => `| ${s.id} | ${s.score.toFixed(2)} | ${s.passed ? "met" : "below threshold"} |`),
  ];

  const failures = v.scenarios.filter((s) => s.failed.length > 0);
  if (failures.length > 0) {
    lines.push("", "## What fell short", "");
    for (const s of failures) {
      lines.push(`**${s.id}**`);
      for (const f of s.failed) lines.push(`- \`${f.id}\` — ${f.reason}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}
```

```ts
// bin/agent-eval.ts — wiring only; every decision it makes lives in src/.
#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseScenarios } from "../src/scenario.js";
import { buildPromptfooConfig } from "../src/config.js";
import { readVerdict } from "../src/verdict.js";
import { renderReport } from "../src/report.js";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1]) throw new Error(`agent-eval: --${name} is required`);
  return process.argv[i + 1]!;
}

const file = parseScenarios(JSON.parse(readFileSync(arg("scenarios"), "utf8")));
const outDir = arg("out");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  `${outDir}/promptfooconfig.json`,
  JSON.stringify(buildPromptfooConfig(file, {
    providerPath: new URL("../src/provider.js", import.meta.url).pathname,
    graderModel: process.env.AGENT_EVAL_GRADER ?? "anthropic:messages:claude-sonnet-5",
  }), null, 2),
);
// The runner invokes promptfoo against that config, then:
const verdict = readVerdict(JSON.parse(readFileSync(`${outDir}/out.json`, "utf8")));
writeFileSync(`${outDir}/report.md`, renderReport(verdict, {
  component: file.component,
  promptChanged: process.env.AGENT_EVAL_PROMPT_CHANGED === "1",
}));
// Exit 0 regardless: a failing scenario is report content, not a task failure.
process.exit(0);
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/agent-eval && corepack pnpm vitest run`
Expected: 29 passed

- [ ] **Step 5: Verify the gates**

Run from the repo root:
`corepack pnpm turbo run typecheck lint --filter=@aep/agent-eval && make license-check && make deadcode-ts-check`
Expected: all exit 0

- [ ] **Step 6: Commit**

```bash
git add packages/agent-eval
git commit -m "feat(agent-eval): the CLI, and a report that says what it did not do"
```

---

### Task 8: The skills

**Files:**
- Modify: `skills/agent-building/references/designing.md` (authoring scenarios)
- Modify: `skills/agent-building/references/building.md` (the eval step)
- Modify: `skills/validation-criteria/SKILL.md` (emit scenarios)
- Test: `services/agents/test/agent-building-skill-gate.test.ts`

**Interfaces:**
- Consumes: the CLI from Task 7.

- [ ] **Step 1: Write the failing gate test**

```ts
// appended to services/agents/test/agent-building-skill-gate.test.ts
describe("agent-building SKILL.md — the evaluation step", () => {
  it("tells the build to run evaluation before opening its PR", () => {
    assert.match(SKILL, /agent-eval/, "the build reference no longer names the eval CLI");
  });

  it("bounds the fix loop where the agent can read it", () => {
    assert.match(SKILL, /at most 3|three rounds/i);
  });

  // The one rule whose breach is a privilege escalation, not a bug.
  it("forbids the loop touching anything but the prompt body", () => {
    assert.match(SKILL, /only the .*(body|prompt)/i);
    assert.match(SKILL, /never .*front matter|front matter .*never/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd services/agents && corepack pnpm test`
Expected: FAIL — the three new assertions

- [ ] **Step 3: Write the skill changes**

In `references/building.md`, extend the Development flow to five steps plus
evaluation, and add this section:

```markdown
## Evaluate before you open the PR

After `npm run build` exits 0 and before the PR, run the agent's scenarios:

    npx --yes @aep/agent-eval --scenarios specs/validation/agent-scenarios.json \
      --app <component-path> --out tests/agent-eval

It boots the agent in-process, serves each tool provider's contract from its own
examples, and drives a simulated user that WITHHOLDS the facts the scenario says
to withhold — that is what makes "asks for what it needs" observable.

**When a scenario scores below 0.8, revise the PROMPT and run it again — at most
3 rounds.** Cite the rubric line that drove each change; the verdict names them.

**Revise ONLY the markdown body** — `# Role`, `# Instructions`, `# Style`. NEVER
the front matter. `x-aep.tools.openapi[].allow` is the security boundary: a
build that widened it to pass a scenario would be granting the agent permissions
nobody approved. A scenario failing because the agent lacks an operation is a
finding to report, not a thing to fix here.

**Keep the best-scoring prompt, not the last one tried** — a revision can make an
agent worse.

**A low score never fails the build.** Open the PR either way, with
`tests/agent-eval/report.md` in it. If the prompt changed, say so in the PR body
and open a SECOND PR carrying the same change to `agent.afm.md`, labelled
`agent-spec-updated`.
```

In `references/designing.md`, add a section stating that every ai-agent gets
`specs/validation/agent-scenarios.json`, written from `specs/requirements/`
ONLY — never from the `agent.afm.md` it will grade — with the file shape from
the spec and the `withholds` explanation.

In `skills/validation-criteria/SKILL.md`, add that a design containing an
`ai-agent` also emits `agent-scenarios.json`, citing criterion ids, under the
same requirement-only input rule the file already states.

- [ ] **Step 4: Run the tests**

Run: `cd services/agents && corepack pnpm test`
Expected: pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add skills services/agents/test
git commit -m "feat(skills): a build evaluates its agent, and may revise only the prompt"
```

---

### Task 9: The org key reaches the build

**Files:**
- Modify: `services/aep-api/internal/delivery/codingagent/coding_executor.go`
- Test: `services/aep-api/internal/delivery/codingagent/coding_executor_test.go`

**Interfaces:**
- Consumes: the existing `AnthropicKeyResolver` port.
- Produces: an implementation dispatch carrying `ANTHROPIC_API_KEY` from the
  org's connected key.

- [ ] **Step 1: Write the failing test**

```go
// A build that evaluates its agent needs a model key twice over — for the agent
// under test and for the judge. The org's connected key is the one that is
// correct on both counts: it is an API key (the coding token is OAuth-shaped),
// and the spend belongs to the org whose agent is being graded.
func TestImplementationDispatch_CarriesTheOrgModelKey(t *testing.T) {
	t.Parallel()
	exec, rec := newTestExecutor(t, withAnthropicKey("sk-ant-test"))

	_, err := exec.DispatchImplementation(context.Background(), testDispatch())
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}

	got := rec.lastJobEnv()
	if got["ANTHROPIC_API_KEY"] != "sk-ant-test" {
		t.Fatalf("want the org key on the job, got %q", got["ANTHROPIC_API_KEY"])
	}
	// The platform's coding credential is NOT the eval credential.
	if got["ANTHROPIC_API_KEY"] == got["CLAUDE_CODE_OAUTH_TOKEN"] {
		t.Fatal("eval must not run on the platform's coding budget")
	}
}

func TestImplementationDispatch_NoKeyConnected_StillDispatches(t *testing.T) {
	t.Parallel()
	exec, rec := newTestExecutor(t, withAnthropicKey(""))

	if _, err := exec.DispatchImplementation(context.Background(), testDispatch()); err != nil {
		t.Fatalf("a build must not fail because evaluation cannot run: %v", err)
	}
	if _, present := rec.lastJobEnv()["ANTHROPIC_API_KEY"]; present {
		t.Fatal("an absent key must be absent, not empty-string present")
	}
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd services/aep-api && go test ./internal/delivery/codingagent/ -run TestImplementationDispatch_Carries -count=1`
Expected: FAIL — `ANTHROPIC_API_KEY` not on the job

- [ ] **Step 3: Implement**

Resolve the org key where the dispatch is composed and add it to the job's env
when non-empty. An org with no connected key dispatches WITHOUT the var — the
build proceeds and evaluation reports that it could not run, because a missing
key must not fail a build that would otherwise deliver.

- [ ] **Step 4: Run the tests**

Run: `cd services/aep-api && go test ./internal/delivery/codingagent/ -count=1`
Expected: ok

- [ ] **Step 5: Commit**

```bash
git add services/aep-api
git commit -m "feat(aep-api): a build carries the org's model key, for the agent and the judge"
```

---

### Task 10: Full verification

- [ ] `cd services/aep-api && go build ./... && go test ./... 2>&1 | grep -c '^FAIL'` → `0`
- [ ] `corepack pnpm turbo run test --force` → all tasks pass
- [ ] `corepack pnpm turbo run typecheck` → pass
- [ ] `corepack pnpm turbo run lint` → pass
- [ ] `make license-check` → exit 0
- [ ] `make deadcode-ts-check` → exit 0
- [ ] `make -C services/aep-api deadcode-check` → exit 0
- [ ] Confirm the loop cannot touch front matter: `grep -rn "front matter" skills/agent-building/references/building.md`
- [ ] **Live proof (USER-RUN, after a container rebuild):** create a project with
  one ai-agent, let it build, and confirm `tests/agent-eval/report.md` appears in
  the PR with a score and per-scenario detail.
