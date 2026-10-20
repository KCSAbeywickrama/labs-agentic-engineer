/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import type { components } from "../../generated/aep-api";

// One build's coding session, scripted as today's runner reports it: the
// runner's startup (RunCycleView.boot: scheduled, pulling, starting), then the
// lead reading the spec and writing its plan, building the foundation itself,
// and fanning the features out to background agents — one per feature and
// layer, as the build skill tells a lead to — while it waits on them. One web
// agent spawns a reviewer in the foreground and waits inside it; one API agent
// fails a test and fixes it; one rides out a model retry. Each agent settles
// with its own totals and report, and the lead runs the suite, commits, pushes
// and opens the pull request.
//
// A repair build is the lead alone, working the fix entries one after another.
//
// For the amber "stalled" row, which needs a minute of real silence, a build
// started after
//   localStorage.setItem("aep:mock:build-stall", "on")
// holds the last web agent's build call unanswered for 75 seconds.

type RunEvent = components["schemas"]["RunEvent"];
type BootCode = components["schemas"]["RunCycleBoot"]["code"];

/** A RunEvent before the script numbers and stamps it. */
export type EventBody = Omit<RunEvent, "v" | "seq" | "ts" | "agentId"> & { agentId?: string };

export interface TimedBody {
  at: number;
  body: EventBody;
}

export interface SessionInput {
  version: string;
  features: { id: string; name: string }[];
  repair: { of: string; stories: string[] } | null;
  criteria: { path: string; content: string }[];
  /** How long the stalled call is held, ms; 0 for none. */
  stallMs?: number | undefined;
}

export interface Session {
  events: TimedBody[];
  /** The runner's startup states, each from when it began. */
  boot: { at: number; code: BootCode }[];
  /** When the runner's first event lands, which ends the startup. */
  spoke: number;
  ended: number;
}

/** How long a build started now holds its stalled call, by the reviewer's switch. */
export function mockStallMs(): number {
  try {
    return localStorage.getItem("aep:mock:build-stall") === "on" ? 75_000 : 0;
  } catch {
    return 0;
  }
}

export const MODEL = "claude-opus-4";

const ENTRY_MS = 2_500;

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function pascal(text: string): string {
  return text.replace(/(^|[^a-zA-Z0-9]+)([a-zA-Z0-9])/g, (_, __, c: string) => c.toUpperCase());
}

/** A file tool's call, by `agentId` (the lead when absent). */
const fileCall = (tool: string) => (path: string, agentId = "lead"): EventBody => ({ kind: "tool_use", tool, summary: path, agentId });
const write = fileCall("Write");
const edit = fileCall("Edit");
const read = fileCall("Read");

/** A shell call and its answer, `ms` apart: one step row with its outcome on it. */
function shell(out: TimedBody[], at: number, agentId: string, command: string, ms: number, result: Partial<EventBody> = {}): number {
  const toolUseId = `${agentId}:${command}:${String(at)}`;
  out.push({ at, body: { kind: "tool_use", tool: "Bash", summary: command, toolUseId, agentId } });
  out.push({ at: at + ms, body: { kind: "tool_result", tool: "Bash", ok: true, exitCode: 0, durationMs: ms, toolUseId, agentId, ...result } });
  return at + ms;
}

/** A command put in the background: its call, its task, and the task's ending `ms` later. */
function background(out: TimedBody[], at: number, agentId: string, command: string, ms: number): number {
  const toolUseId = `${agentId}:${command}:${String(at)}`;
  const taskId = `bg-${String(at)}`;
  out.push({ at, body: { kind: "tool_use", tool: "Bash", summary: command, toolUseId, agentId } });
  out.push({ at: at + 50, body: { kind: "task_started", toolUseId, taskId, summary: command, agentId } });
  out.push({ at: at + ms, body: { kind: "task_settled", toolUseId, taskId, summary: command, status: "completed", outputBytes: 4_812, agentId } });
  return at + ms;
}

function spread(out: TimedBody[], start: number, span: number, bodies: EventBody[]): number {
  bodies.forEach((body, i) => out.push({ at: start + Math.round(((i + 1) * span) / (bodies.length + 1)), body }));
  return start + span;
}

interface AgentSpec {
  id: string;
  label: string;
  parent: string;
  depth: number;
  background: boolean;
  phrase: string;
  report: string;
  linesAdded: number;
}

/** One spawned agent's whole life: started, its phrase, its work (from `work`), settled with its totals. */
function agent(out: TimedBody[], spec: AgentSpec, start: number, work: (t: number) => number): number {
  out.push({
    at: start,
    body: { kind: "agent_started", agentId: spec.id, parentAgentId: spec.parent, depth: spec.depth, label: spec.label, background: spec.background, model: MODEL },
  });
  out.push({ at: start + 100, body: { kind: "agent_progress", agentId: spec.id, phrase: spec.phrase } });
  const before = out.length;
  const end = work(start + 300) + 200;
  const tools = out.slice(before).filter((e) => e.body.kind === "tool_use" && e.body.agentId === spec.id).length;
  out.push({
    at: end,
    body: {
      kind: "agent_settled",
      agentId: spec.id,
      status: "completed",
      durationMs: end - start,
      toolCount: tools,
      linesAdded: spec.linesAdded,
      linesRemoved: Math.round(spec.linesAdded / 20),
      tokens: 18_000 + spec.linesAdded * 40,
      report: spec.report,
    },
  });
  return end;
}

interface Entry {
  id: string;
  title: string;
  owner: string;
}

function planItem(entry: Entry, itemStatus: NonNullable<RunEvent["itemStatus"]>): EventBody {
  return { kind: "work_item", source: "plan", itemId: entry.id, title: entry.title, itemStatus, ownerAgentId: entry.owner };
}

/** The runner's startup and the lead's first reads, common to a build and a repair. */
function opening(out: TimedBody[], input: SessionInput, start: number): { boot: Session["boot"]; spoke: number; t: number } {
  const boot: Session["boot"] = [
    { at: start, code: "runner_scheduling" },
    { at: start + 700, code: "runner_pulling_image" },
    { at: start + 1_500, code: "runner_starting" },
  ];
  const spoke = start + 2_000;
  // The runner's own two pre-session conditions are events: it emits them.
  out.push({ at: spoke, body: { kind: "notice", level: "info", code: "workspace_provisioning" } });
  out.push({ at: spoke + 300, body: { kind: "notice", level: "info", code: "workspace_ready" } });
  out.push({ at: spoke + 400, body: { kind: "run_started", taskKind: "implementation", runtime: "claude-code", model: MODEL } });
  const reads = input.repair
    ? [read("tests/acceptance/report.json"), ...input.criteria.map((c) => read(c.path))]
    : [
        read("specs/requirements/prd.md"),
        read("specs/requirements/product-wide.md"),
        ...input.features.map((f) => read(`specs/requirements/features/${f.id}-${slug(f.name)}.md`)),
        read("specs/design/architecture.cell"),
      ];
  const t = spread(out, spoke + 400, 1_100, reads);
  out.push({ at: t, body: { kind: "agent_progress", phrase: `Planning ${input.version}` } });
  return { boot, spoke, t: t + 100 };
}

/** The lead's close: the whole suite, the commit, the push, the pull request, the attempt's end. */
function closing(out: TimedBody[], t: number, files: number, version: string): number {
  out.push({ at: t, body: { kind: "agent_progress", phrase: "Checking the whole build" } });
  t = shell(out, t + 100, "lead", "pnpm test", 1_200, { summary: "64 passed" });
  out.push({ at: t + 100, body: { kind: "git_commit", sha: "4f2a9c1e", files } });
  out.push({ at: t + 200, body: { kind: "git_push", branch: `aep/${version}` } });
  out.push({ at: t + 300, body: { kind: "gh_action", summary: `gh pr create --title "${version}"`, ok: true } });
  out.push({ at: t + 400, body: { kind: "run_settled", outcome: "success" } });
  return t + 500;
}

/** A repair: the lead alone, one fix entry after another. */
function repairSession(input: SessionInput, start: number): Session {
  const out: TimedBody[] = [];
  const { boot, spoke, t: planned } = opening(out, input, start);
  const ids = new Set((input.repair?.stories ?? []).map((s) => s.split(".")[0]));
  const entries = input.features
    .filter((f) => ids.has(f.id))
    .map((f): Entry => ({ id: `${f.id}-api-fix`, title: `${f.id} ${f.name} · API fix`, owner: "lead" }));
  entries.forEach((e) => out.push({ at: planned, body: planItem(e, "pending") }));
  let t = planned + 200;
  for (const [i, entry] of entries.entries()) {
    const f = input.features.filter((x) => ids.has(x.id))[i];
    const s = slug(f?.name ?? entry.id);
    out.push({ at: t, body: planItem(entry, "in_progress") });
    spread(out, t, ENTRY_MS - 900, [edit(`api/src/${s}/queue.ts`), write(`api/src/${s}/queue.test.ts`)]);
    shell(out, t + ENTRY_MS - 800, "lead", `pnpm --filter api test -- ${s}`, 600, { summary: "22 passed" });
    out.push({ at: t + ENTRY_MS - 50, body: planItem(entry, "completed") });
    t += ENTRY_MS;
  }
  const ended = closing(out, t + 100, entries.length * 2, input.version);
  return { events: out, boot, spoke, ended };
}

/** A first build: the foundation by the lead, then the features fanned out. */
function buildSession(input: SessionInput, start: number): Session {
  const out: TimedBody[] = [];
  const { boot, spoke, t: planned } = opening(out, input, start);

  const foundation: Entry = { id: "foundation", title: "Foundation · API", owner: "lead" };
  const fanned = input.features.flatMap((f) => [
    { feature: f, layer: "api" as const, entry: { id: `${f.id}-api`, title: `${f.id} ${f.name} · API`, owner: `agent-${f.id}-api` } },
    { feature: f, layer: "web" as const, entry: { id: `${f.id}-web`, title: `${f.id} ${f.name} · Web app`, owner: `agent-${f.id}-web` } },
  ]);
  [foundation, ...fanned.map((x) => x.entry)].forEach((e) => out.push({ at: planned, body: planItem(e, "pending") }));

  // The foundation, by the lead itself.
  let t = planned + 200;
  out.push({ at: t, body: planItem(foundation, "in_progress") });
  out.push({ at: t + 50, body: { kind: "agent_progress", phrase: "Building the API foundation" } });
  spread(out, t, 1_400, [write("api/src/app.ts"), write("api/src/auth/sso.ts"), write("api/src/audit/log.ts"), write("api/src/jobs/retention.ts")]);
  t = shell(out, t + 1_500, "lead", "pnpm --filter api test", 700, { summary: "18 passed" });
  out.push({ at: t + 50, body: planItem(foundation, "completed") });

  // The fan-out: every feature layer at once, in the background.
  const dispatch = t + 200;
  out.push({ at: dispatch, body: { kind: "agent_progress", phrase: `Dispatched ${String(fanned.length)} agents; waiting on them` } });
  const ends: { id: string; end: number }[] = [];
  fanned.forEach(({ feature, layer, entry }, i) => {
    const s = slug(feature.name);
    const begin = dispatch + 100 + i * 150;
    out.push({ at: begin - 20, body: planItem(entry, "in_progress") });
    const last = i === fanned.length - 1;
    const end =
      layer === "api"
        ? agent(
            out,
            {
              id: entry.owner,
              label: entry.title,
              parent: "lead",
              depth: 1,
              background: true,
              phrase: `Building the ${feature.name} API`,
              report: `Added the ${feature.name} routes, store and rules with their tests; all pass.`,
              linesAdded: 420 + i * 30,
            },
            begin,
            (w) => {
              w = spread(out, w, 1_200, [write(`api/src/${s}/routes.ts`, entry.owner), write(`api/src/${s}/store.ts`, entry.owner), write(`api/src/${s}/rules.ts`, entry.owner)]);
              if (i === 0) {
                // A model retry, which explains a short silence while it is the newest thing that happened.
                out.push({ at: w + 100, body: { kind: "notice", agentId: entry.owner, level: "warn", code: "api_retry", detail: "overloaded_error · attempt 2" } });
                w += 900;
              }
              if (feature.id === input.features.at(-1)?.id) {
                // A failing test, then the fix.
                w = shell(out, w + 100, entry.owner, `pnpm --filter api test -- ${s}`, 800, { ok: false, exitCode: 1, summary: `2 failed · ${s}/rules.test.ts` });
                out.push({ at: w + 200, body: edit(`api/src/${s}/rules.ts`, entry.owner) });
                return shell(out, w + 500, entry.owner, `pnpm --filter api test -- ${s}`, 3_400, { summary: "21 passed" });
              }
              return background(out, w + 100, entry.owner, `pnpm --filter api test -- ${s}`, 1_600);
            },
          )
        : agent(
            out,
            {
              id: entry.owner,
              label: entry.title,
              parent: "lead",
              depth: 1,
              background: true,
              phrase: `Building the ${feature.name} screens`,
              report: `Built the ${pascal(feature.name)} page and its API client; the reviewer's two notes are fixed.`,
              linesAdded: 310 + i * 25,
            },
            begin,
            (w) => {
              w = spread(out, w, 1_000, [write(`web/src/pages/${pascal(feature.name)}.tsx`, entry.owner), write(`web/src/api/${s}.ts`, entry.owner)]);
              if (i === 1) {
                // A reviewer in the FOREGROUND: its parent waits inside it.
                w = agent(
                  out,
                  {
                    id: `reviewer-${feature.id}`,
                    label: `Review ${feature.name} screens against the design`,
                    parent: entry.owner,
                    depth: 2,
                    background: false,
                    phrase: "Comparing the screens with the design",
                    report: "Two notes: the empty state lacks its call to action, and the amount column is not right-aligned.",
                    linesAdded: 0,
                  },
                  w + 100,
                  (r) => spread(out, r, 2_200, [read(`web/src/pages/${pascal(feature.name)}.tsx`, `reviewer-${feature.id}`), read("specs/design/screens.md", `reviewer-${feature.id}`)]),
                );
                out.push({ at: w + 100, body: edit(`web/src/pages/${pascal(feature.name)}.tsx`, entry.owner) });
                w += 300;
              }
              const held = last ? (input.stallMs ?? 0) : 0;
              return shell(out, w + 100, entry.owner, last ? "pnpm --filter web build" : `pnpm --filter web test -- ${s}`, held || 900, { summary: last ? "built in 4.1s" : "9 passed" });
            },
          );
    out.push({ at: end + 30, body: planItem(entry, "completed") });
    ends.push({ id: entry.owner, end });
  });

  // While it waits, the lead says on what: the agent it has waited on longest.
  const allDone = Math.max(...ends.map((e) => e.end));
  for (let beat = dispatch + 2_500; beat < allDone; beat += 2_500) {
    const waitingOn = ends.find((e) => e.end > beat);
    if (waitingOn) out.push({ at: beat, body: { kind: "heartbeat", waitingOn: "agent", ref: waitingOn.id, elapsedMs: beat - dispatch } });
  }

  const ended = closing(out, allDone + 300, 4 + fanned.length * 3, input.version);
  return { events: out, boot, spoke, ended };
}

/** The coding session of a build or a repair, from `start` ms after the run began. */
export function codingSession(input: SessionInput, start: number): Session {
  return input.repair ? repairSession(input, start) : buildSession(input, start);
}
