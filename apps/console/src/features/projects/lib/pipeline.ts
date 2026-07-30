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

import type { components } from "../../../generated/aep-api";

type ProjectStatus = components["schemas"]["ProjectStatus"];

// One rendered stage of the overview pipeline (#183). Views are pure
// derivations of the ProjectStatus stage aggregates — the spec stage in
// particular has no stored status: exists/version/dirty decide everything.
export type StageTone = "ghost" | "neutral" | "info" | "warning" | "success" | "error";

// StageTone → Oxygen/MUI Chip colour. Lives beside the tone union so every
// consumer maps it the same way; "neutral"/"ghost" are ours, "default" is theirs.
export const CHIP_COLOR: Record<
  StageTone,
  "default" | "info" | "warning" | "success" | "error"
> = {
  ghost: "default",
  neutral: "default",
  info: "info",
  warning: "warning",
  success: "success",
  error: "error",
};

export interface StageView {
  /** Version chip text ("v1", "v1+"); "" renders an em-dash. */
  version: string;
  /** One-line state under the chip. */
  line: string;
  tone: StageTone;
  /** Spec stage only: render the Generate-spec CTA instead of a state. */
  cta?: boolean;
  /** Build stage only: failed-task count, called out in red when > 0. */
  failed?: number;
}

export function specStageView(status: ProjectStatus): StageView {
  const { exists, version, dirty } = status.spec;
  if (!exists) return { version: "", line: "", tone: "neutral", cta: true };
  if (!version) return { version: "", line: "draft · not published", tone: "info" };
  if (dirty) return { version: `${version}+`, line: "draft changes", tone: "warning" };
  return { version, line: "published", tone: "success" };
}

export function buildStageView(status: ProjectStatus): StageView {
  const { version, status: state, tasks } = status.build;
  const progress = `${tasks.done}/${tasks.total} done`;
  switch (state) {
    case "running":
      // total is written once the plan step finishes, so a running build
      // with no tasks is still planning — say so instead of "0/0 done".
      if (tasks.total === 0) {
        return { version, line: "building · generating tasks", tone: "info" };
      }
      return {
        version,
        line: `building · ${progress}`,
        tone: "info",
        failed: tasks.failed,
      };
    case "failed":
      return {
        version,
        line: `build failed · ${progress}`,
        tone: "error",
        failed: tasks.failed,
      };
    case "succeeded":
      return { version, line: `built · ${progress}`, tone: "success" };
    default:
      return { version: "", line: "waiting on spec", tone: "ghost" };
  }
}

export function deployStageView(status: ProjectStatus): StageView {
  const { version, status: state, components: comps } = status.deploy;
  switch (state) {
    case "deploying":
      return {
        version,
        line: `deploying · ${comps.ready}/${comps.total} components`,
        tone: "info",
      };
    case "deployed": {
      // Validation runs after the components deploy, so its state is appended to
      // the live-in-dev line (deployed stays the deploy tone; validation is
      // informational text here — the deployments board carries the loud chip).
      const v = validationView(
        status.deploy.validation,
        status.deploy.validationVerdict,
        status.deploy.validationFailureKind,
      );
      return {
        version,
        line: v ? `live in dev · ${v.label}` : "live in dev",
        tone: "success",
      };
    }
    case "failed":
      return { version, line: "deploy failed", tone: "error" };
    default: {
      // No live deploy status — but validation only runs after the app
      // deploys, so a non-none validation state means it IS live in dev.
      // Surface it even when the binding read lags or returns nothing (a
      // transient/degraded deploy-status read must not hide validation).
      const v = validationView(
        status.deploy.validation,
        status.deploy.validationVerdict,
        status.deploy.validationFailureKind,
      );
      if (v) return { version, line: `live in dev · ${v.label}`, tone: v.tone };
      return { version: "", line: "nothing deployed", tone: "ghost" };
    }
  }
}

// Human copy for each machine-readable failure cause. These describe the RUN
// breaking, never the criteria failing — a failing suite is `finished` with a
// `fail` verdict, so nothing in this map can be confused for a test result.
const FAILURE_KIND_DETAIL: Record<string, string> = {
  internal_error: "the platform hit an internal error",
  gate_rejected: "a gate was declined",
  dispatch_failed: "the validation runner never started",
  runner_crashed: "the validation runner died mid-run",
  timed_out: "the run timed out",
  no_pr_opened: "the run opened no pull request",
  report_missing: "the run never reported its results",
  report_invalid: "the run's report could not be read",
  merge_failed: "the validation pull request did not merge",
};

// validationView maps the validation LIFECYCLE state plus its verdict to a label
// + tone, shared by the overview deploy line (suffix), the deployments board chip
// and the Validation page header.
//
// The two axes are deliberate: `validation` says whether the run reached an
// answer, `verdict` says what the answer was. That is why a failing test suite
// reads "validation failed" from finished+fail, while a broken run reads
// "validation errored" — previously both rendered the same word.
//
// null = nothing to show (no validation reached, or no acceptance criteria).
export function validationView(
  validation: string,
  verdict?: string,
  failureKind?: string,
): { label: string; tone: StageTone; detail?: string } | null {
  switch (validation) {
    case "running":
      return { label: "validating", tone: "info" };
    case "finished":
      switch (verdict) {
        case "pass":
          return { label: "validation passed", tone: "success" };
        case "fail":
          return { label: "validation failed", tone: "error" };
        case "awaiting_review":
          // A human has to decide: manual/scenario criteria are present, or an
          // e2e criterion produced no result. Warning, not error — nothing is
          // broken and nothing has failed yet.
          return { label: "awaiting review", tone: "warning" };
        default:
          // Finished with no verdict: a run that predates the verdict field.
          // Name what the chip opens rather than guessing an outcome.
          return { label: "validation report", tone: "info" };
      }
    case "errored": {
      const detail = failureKind ? FAILURE_KIND_DETAIL[failureKind] : undefined;
      return {
        label: "validation errored",
        tone: "error",
        ...(detail ? { detail } : {}),
      };
    }
    case "canceled":
      return { label: "validation canceled", tone: "neutral" };
    default: // "none" | "" | unknown
      return null;
  }
}
