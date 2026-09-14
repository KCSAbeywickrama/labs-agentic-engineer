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

// The Development card as a FLOW (ADR-0032): deployed → validated → promoted,
// three numbered steps whose state says where the version is and whose one
// action says what to do about it. Everything here is a pure derivation over
// reads the page already makes — the environment row, the deploy aggregate,
// the validation evidence, the design's connections, the readiness read, and
// the newest run's park at the deploy gate — so the card cannot say anything
// the platform did not.

import type { StatusTone } from "../../../components/StatusChip";
import type { components } from "../../../generated/aep-api";
import { externalValuesPark } from "../../builds/lib/runView";
import type { ValidationCounts } from "../../validation/lib/verdict";
import { cardChip, type EnvironmentRow } from "./deploymentLedger";
import type { DeploymentCard } from "./deploymentRows";
import {
  canPromote,
  connectionIsSet,
  type ConnectionRow,
  type ConnectionValues,
} from "./promotion";

type MilestoneRunView = components["schemas"]["MilestoneRunView"];
type ComponentDependencies = components["schemas"]["ComponentDependencies"];
type DeployStage = components["schemas"]["DeployStage"];
type ProjectDependencyReadiness =
  components["schemas"]["ProjectDependencyReadiness"];

/** Where a step is: done, the one moving, held by a person, broken, or not yet. */
export type StepState = "done" | "active" | "hold" | "error" | "pending";

export interface StepChip {
  label: string;
  tone: StatusTone;
  /** Pulses — the step is actually moving. */
  live?: boolean;
  /** Accessible name for a label that hedges with a mark. */
  spoken?: string;
}

export interface FlowStep {
  state: StepState;
  title: string;
  chip?: StepChip;
  /** One sentence under the title — what the step is waiting for, or did. */
  note?: string;
}

// ── On hold ─────────────────────────────────────────────────────────────────

/**
 * A deployment waiting on a person: the newest run parked at the deploy gate
 * (`waiting` / `external-values`), and which components each missing value
 * holds up. Null when nothing is parked.
 *
 * The run names dependencies by SLUG; the design spells them. Matching is
 * case-insensitive for the same reason `externalResourceRows` does it, and the
 * design's spelling wins on the way out — it is what a person reads on the
 * Spec view too.
 */
export interface DeployHold {
  /** The values still owed, in the design's spelling. */
  blocking: string[];
  /** Component name → the blocking dependencies it declares. */
  dependents: Record<string, string[]>;
}

export function deployHold(
  runs: MilestoneRunView[] | undefined,
  design: ComponentDependencies[] | null | undefined,
): DeployHold | null {
  const park = externalValuesPark(runs?.[0]);
  if (park === null) return null;
  const wanted = new Set(park.map((n) => n.toLowerCase()));
  const spelled = new Map<string, string>();
  const dependents: Record<string, string[]> = {};
  for (const comp of design ?? []) {
    for (const dep of comp.dependencies ?? []) {
      if (dep.kind !== "external") continue;
      const slug = dep.name.toLowerCase();
      if (!wanted.has(slug)) continue;
      spelled.set(slug, dep.name);
      (dependents[comp.componentName] ??= []).push(dep.name);
    }
  }
  return {
    blocking: park.map((n) => spelled.get(n.toLowerCase()) ?? n),
    dependents,
  };
}

/** "currency-service" · "stripe and sendgrid" · "stripe, sendgrid and mailer". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// ── Step 1: Deployed ────────────────────────────────────────────────────────

/** A stamp as the header chips print it — "Sep 10, 01:45 PM". */
export function stampLabel(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function deployStep(row: EnvironmentRow, hold: DeployHold | null): FlowStep {
  if (hold) {
    return { state: "hold", title: "Deploy", chip: { label: "On hold", tone: "warning" } };
  }
  const { status } = row;
  if (status.tone === "error") {
    return { state: "error", title: "Deploy failed", chip: { label: status.label, tone: "error" } };
  }
  if (status.live) {
    return {
      state: "active",
      title: "Deploying",
      chip: { label: `${row.live} of ${row.total} live`, tone: "info", live: true },
    };
  }
  if (status.tone === "success") {
    const stamp = stampLabel(row.deployedAt);
    return {
      state: "done",
      title: "Deployed",
      ...(stamp ? { chip: { label: stamp, tone: "neutral" } } : {}),
    };
  }
  return {
    state: "pending",
    title: "Deploy",
    note:
      status.label === "Undeployed"
        ? "Every component is undeployed."
        : "Deploys automatically when a build merges.",
  };
}

/** The sentence under a green step 1. */
export function deployedSentence(row: EnvironmentRow, validation: string): string {
  const since = stampLabel(row.deployedAt);
  const head = `${row.live} of ${row.total} components live${since ? ` since ${since}` : ""}.`;
  const inFlight = validation === "running" || validation === "awaiting-fix";
  return `${head} You can try them now${inFlight ? " while validation runs" : ""}.`;
}

/** The sentence under an on-hold step 1. */
export function holdSentence(hold: DeployHold): string {
  const n = hold.blocking.length;
  return `Deployment is on hold until ${n === 1 ? "one connection value is" : `${n} connection values are`} set. It continues automatically.`;
}

/** The notice's own line: what is needed, and who is waiting on it. */
export function holdNotice(hold: DeployHold): { title: string; body: string } {
  const named = listNames(hold.blocking);
  const dependents = Object.entries(hold.dependents)
    .filter(([, deps]) => deps.length > 0)
    .map(([component]) => component)
    .sort();
  const title = named
    ? `Needs a value for ${named} before deploying`
    : "Needs a connection value before deploying";
  const who =
    dependents.length > 0
      ? `${listNames(dependents)} depend${dependents.length === 1 ? "s" : ""} on it.`
      : "";
  return {
    title,
    body: `${who}${who ? " " : ""}Deployment continues automatically once it is set.`,
  };
}

// ── The component and connection lines ─────────────────────────────────────

export interface ComponentLine {
  card: DeploymentCard;
  /** "web app" · "service" — the type, as a person says it. */
  kind: string;
  label: string;
  tone: StatusTone;
}

function componentKind(type: string | undefined): string {
  switch (type) {
    case "web-application":
      return "web app";
    case "service":
      return "service";
    default:
      return type ?? "";
  }
}

/**
 * One component under step 1. A serving component reads "Live" — the card's
 * own word, the one its headline counts in — rather than the binding's raw
 * condition reason, which the environment page and the ledger keep for the
 * operator's vocabulary. Every other state keeps the shared chip.
 */
export function componentLine(
  card: DeploymentCard,
  type: string | undefined,
  hold: DeployHold | null,
): ComponentLine {
  const kind = componentKind(type);
  if (hold) {
    const needs = hold.dependents[card.componentName] ?? [];
    return needs.length > 0
      ? { card, kind, label: `Needs ${listNames(needs)}`, tone: "warning" }
      : { card, kind, label: "Waiting", tone: "neutral" };
  }
  if (card.kind === "success") return { card, kind, label: "Live", tone: "success" };
  const chip = cardChip(card);
  return { card, kind, label: chip.label, tone: chip.tone };
}

export type ConnectionState = "set" | "provisioned" | "missing" | "platform" | "unknown";

export interface ConnectionLine {
  row: ConnectionRow;
  state: ConnectionState;
  /** The trailing word, or "" when the state is not known. */
  label: string;
  /** Configure is offered — the values can be (re)collected here. */
  configure: boolean;
}

const STATE_LABEL: Record<ConnectionState, string> = {
  set: "Set",
  provisioned: "Provisioned",
  missing: "Missing",
  platform: "Platform-managed",
  unknown: "",
};

/**
 * The connections under step 1, in development. The readiness read says
 * whether the platform holds values for an external; a parked run says which
 * ones it is waiting on, and that word wins. Configure stays on every Project
 * External the way it did on the Connections card (#395: dummy values at build
 * time, real ones later) — a Registered External keeps its values on the org
 * catalog, and while the catalog is unknown no name may open the dialog.
 */
export function developmentConnections(
  rows: ConnectionRow[],
  readiness: ProjectDependencyReadiness | undefined,
  hold: DeployHold | null,
  registeredNames: Set<string>,
  catalogUnknown: boolean,
): ConnectionLine[] {
  const blocking = new Set((hold?.blocking ?? []).map((n) => n.toLowerCase()));
  const reported = new Map(
    (readiness?.dependencies ?? []).map((d) => [d.name.toLowerCase(), d.state]),
  );
  return rows.map((row) => {
    if (row.provisioned) return line(row, "provisioned", false);
    if (row.kind !== "external") return line(row, "platform", false);
    const configure = !catalogUnknown && !registeredNames.has(row.name);
    if (blocking.has(row.name.toLowerCase())) return line(row, "missing", configure);
    const state = reported.get(row.name.toLowerCase());
    if (state === undefined) return line(row, "unknown", configure);
    return line(row, state === "configured" ? "set" : "missing", configure);
  });
}

/** The connections a promotion needs, against the values entered so far. */
export function productionConnections(
  rows: ConnectionRow[],
  values: ConnectionValues,
): ConnectionLine[] {
  return rows.map((row) =>
    row.provisioned
      ? line(row, "provisioned", false)
      : connectionIsSet(row, values)
        ? line(row, "set", false)
        : line(row, "missing", true),
  );
}

function line(row: ConnectionRow, state: ConnectionState, configure: boolean): ConnectionLine {
  return { row, state, label: STATE_LABEL[state], configure };
}

/** "3 of 3 set" — a group's headline. */
export function connectionsHeadline(lines: ConnectionLine[]): string {
  const set = lines.filter((l) => l.state === "set" || l.state === "provisioned" || l.state === "platform").length;
  return `${set} of ${lines.length} set`;
}

// ── Step 2: Validation ──────────────────────────────────────────────────────

// The chip's word for each value of deploy.validation. Not `validationView`'s
// labels — those are lower-case predicates for a cell ("validating",
// "validated*"); a step names its outcome as a heading.
const VALIDATION_CHIP: Record<string, { label: string; tone: StatusTone; state: StepState; spoken?: string }> = {
  running: { label: "Running", tone: "info", state: "active" },
  "awaiting-fix": { label: "Awaiting fix", tone: "warning", state: "active" },
  passed: { label: "Passed", tone: "success", state: "done" },
  partial: { label: "Passed*", tone: "success", state: "done", spoken: "passed, partially" },
  failed: { label: "Failed", tone: "error", state: "error" },
  unreported: { label: "Unreported", tone: "error", state: "error" },
  inconclusive: { label: "Inconclusive", tone: "neutral", state: "done" },
  skipped: { label: "Skipped", tone: "neutral", state: "done" },
  cancelled: { label: "Cancelled", tone: "neutral", state: "done" },
};

/**
 * Step 2. `none` is pending — a verdict is expected and has not arrived — and
 * so is everything before the deployment exists. A settled verdict carries its
 * counts when the criteria/report join resolved them; a running one does not,
 * because its numbers would be the LAST attempt's under a heading that says
 * this one.
 */
export function validationStep(
  validation: string | undefined,
  counts: ValidationCounts | undefined,
  deployed: FlowStep,
): FlowStep {
  const known = validation ? VALIDATION_CHIP[validation] : undefined;
  if (!known || deployed.state === "hold" || deployed.state === "pending") {
    return {
      state: "pending",
      title: "Validation",
      note:
        deployed.state === "done"
          ? "Starts automatically now that the deployment is live."
          : "Runs automatically after deployment.",
    };
  }
  const settled = known.state !== "active";
  const withCounts =
    settled && counts && counts.total > 0
      ? `${known.label} · ${counts.passed} of ${counts.total}`
      : known.label;
  return {
    state: known.state,
    title: "Validation",
    chip: {
      label: withCounts,
      tone: known.tone,
      live: validation === "running",
      ...(known.spoken
        ? {
            spoken:
              settled && counts && counts.total > 0
                ? `${known.spoken}, ${counts.passed} of ${counts.total}`
                : known.spoken,
          }
        : {}),
    },
  };
}

// ── Step 3: Promote ─────────────────────────────────────────────────────────

export interface PromoteStep extends FlowStep {
  /** The button can be pressed: validation allows it and every value is set. */
  enabled: boolean;
  /** The caption beside the button — why it is disabled, or what it opens. */
  reason: string;
  /** Connections still missing a production value, one blocker line each. */
  missing: ConnectionRow[];
}

/**
 * Step 3, or null once production runs something — there is nothing left to
 * promote INTO, and the Production card says what runs there.
 *
 * Validation's say comes first (`canPromote`, the deploy aggregate's rule);
 * only then do the values matter. A step that is not yet reachable stays
 * pending with the reason on the button, so a reader never meets a disabled
 * control without the sentence that explains it.
 */
export function promoteStep(
  deploy: DeployStage | undefined,
  production: EnvironmentRow,
  connections: ConnectionRow[],
  values: ConnectionValues,
  hold: DeployHold | null,
  /** The version the card is about — the deployed one, or the build's while
   *  nothing is deployed yet. The aggregate's `version` is "" until a rollout
   *  lands, and a held version still has a name. */
  version: string = deploy?.version ?? "",
): PromoteStep | null {
  if (production.cards.length > 0) return null;
  if (!version) return null;
  const base = { title: "Promote to Production", missing: [] as ConnectionRow[] };
  if (hold || !deploy || deploy.status !== "deployed") {
    return {
      ...base,
      state: "pending",
      enabled: false,
      reason: `Unavailable until ${version} deploys and validates`,
    };
  }
  if (!canPromote(deploy)) {
    const failed = deploy.validation === "failed" || deploy.validation === "unreported";
    return {
      ...base,
      state: "pending",
      enabled: false,
      reason: failed ? "Blocked — validation failed" : "Enabled when validation passes",
    };
  }
  const missing = connections.filter((row) => !row.provisioned && !connectionIsSet(row, values));
  if (missing.length > 0) {
    return {
      ...base,
      state: "active",
      chip: {
        label: `${missing.length} value${missing.length === 1 ? "" : "s"} missing`,
        tone: "warning",
      },
      enabled: false,
      reason: `Enabled once the value${missing.length === 1 ? " is" : "s are"} set`,
      missing,
    };
  }
  return {
    ...base,
    state: "active",
    enabled: true,
    reason: "Opens a dialog to confirm the promotion.",
  };
}

/** The Production card's one sentence while it is empty. */
export function productionSentence(
  deploy: DeployStage | undefined,
  promote: PromoteStep | null,
  hold: DeployHold | null,
  version: string = deploy?.version ?? "",
): string {
  if (!version) return "Nothing running yet — promote a validated version from development.";
  if (hold || !deploy || deploy.status !== "deployed") {
    return `Nothing running yet. ${version} must deploy and validate in Development first.`;
  }
  if (!promote || !canPromote(deploy)) {
    return `Nothing running yet. ${version} can be promoted here once it passes validation.`;
  }
  if (promote.missing.length > 0) {
    return `Nothing running yet. ${version} is ready to promote once the missing value${promote.missing.length === 1 ? " is" : "s are"} set.`;
  }
  return `Nothing running yet. ${version} is ready to promote.`;
}
