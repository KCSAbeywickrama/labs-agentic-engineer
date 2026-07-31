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
// consumer maps it identically; "ghost"/"neutral" are ours, "default" is theirs.
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
}

export function specStageView(status: ProjectStatus): StageView {
  const { exists, version, dirty } = status.spec;
  if (!exists) return { version: "", line: "", tone: "neutral", cta: true };
  if (!version) return { version: "", line: "draft · not published", tone: "info" };
  if (dirty) return { version: `${version}+`, line: "draft changes", tone: "warning" };
  return { version, line: "published", tone: "success" };
}

// The build stage is COUNT-FREE. A per-version task tally can only come from
// the version's milestone on GitHub, and this aggregate is polled at 5s, so the
// status read does not carry one — the Builds page renders counts from the
// issue list it already pays for. What the overview says instead is what the
// version's run is doing, which is a run row and costs nothing.
export function buildStageView(status: ProjectStatus): StageView {
  const { version, status: state } = status.build;
  switch (state) {
    case "running":
      return { version, line: "building", tone: "info" };
    case "failed":
      return { version, line: "build failed", tone: "error" };
    case "succeeded":
      return { version, line: "built", tone: "success" };
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
      const v = validationView(status.deploy.validation);
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
      const v = validationView(status.deploy.validation);
      if (v) return { version, line: `live in dev · ${v.label}`, tone: v.tone };
      return { version: "", line: "nothing deployed", tone: "ghost" };
    }
  }
}

// validationView maps deploy.validation to a label + tone, shared by the overview
// deploy line (suffix) and the deployments board chip. null = nothing to show yet.
//
// deploy.validation MIRRORS the run's verdict rather than folding it, so this is a
// one-to-one rename into human words with nothing discarded on the way. That is
// what lets every label name the outcome instead of naming an artifact the reader
// would have to open to find the outcome out — the failing of the old vocabulary,
// where "completed" covered a green run and a red one alike.
export function validationView(
  validation: string,
): { label: string; tone: StageTone } | null {
  switch (validation) {
    // The one lifecycle value with anything to say: a validation CYCLE is in
    // flight. It is derived from the run's latest cycle, not from "the run is live
    // and has no verdict" — that older rule made the chip claim to be validating
    // through every coding cycle of every run.
    case "running":
      return { label: "validating", tone: "info" };

    // The rest are the run's verdict verbatim, which is why each label can name
    // the outcome instead of naming an artifact to go and open.
    case "passed":
      return { label: "validation passed", tone: "success" };
    case "partial":
      // Something passed, nothing failed, and some criteria were never covered.
      // Warning rather than success: reporting this as "passed" would claim a
      // result for criteria nobody checked.
      return { label: "partially validated", tone: "warning" };
    case "failed":
      return { label: "validation failed", tone: "error" };
    case "inconclusive":
      // No test results at all. Names the situation rather than the category —
      // "inconclusive" alone leaves a reader guessing why.
      return { label: "no test results", tone: "warning" };
    case "unreported":
      // The agent merged its pull request and committed no report, so the run
      // learned nothing. An agent-contract breach, hence error tone.
      return { label: "validation didn't report", tone: "error" };
    case "skipped":
      // No acceptance criteria authored. Distinct from `none` and actionable —
      // "author some" — where none means there is nothing to say yet.
      return { label: "no acceptance criteria", tone: "neutral" };

    default: // "none" | "" | unknown
      return null;
  }
}
