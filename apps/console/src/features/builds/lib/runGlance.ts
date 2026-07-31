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

import type { SpineStage } from "./stage";

// THE GLANCE — one run's flow as a single line, plus the one stage worth words.
//
// The rail this sits over renders every stage in full: each one's note, its
// issues, its log. That is the right surface for reading a finished run, and the
// wrong one for answering "what is happening right now", which is what a reader
// arrives with while a run is live. Six expanded stages make the reader do the
// scanning; the glance does it for them and keeps the rest one click away.
//
// Nothing here re-derives a stage. The states come from `sessionStages` and
// `provisioningStage` exactly as the rail gets them — this only decides which
// one is NOW and what "the rest" collapses to.

export interface GlanceStage {
  stage: SpineStage;
  /** Its number in the run's one flow, matching the rail's numbering. */
  step: number;
}

export interface RunGlance {
  stages: GlanceStage[];
  /**
   * Index into `stages` of the stage the NOW panel narrates, or null when the
   * flow has nothing left to say (every stage done).
   */
  nowIndex: number | null;
  /** The stages after `nowIndex` — the quiet "then …" tail. */
  ahead: GlanceStage[];
}

/** A stage nobody is waiting on any more. */
function isSettled(stage: SpineStage): boolean {
  return stage.state === "done";
}

/**
 * Collapse a run's stages into the glance.
 *
 * NOW is the FIRST stage that is not done — which is the same stage the rail
 * would show as the frontier, whether it is running, waiting on the platform,
 * or stopped needing a human. Loudness does not reorder anything: a failed
 * stage is already the first non-done one, because nothing after it ran.
 *
 * `stepFrom` keeps the numbers identical to the rail's, so the glance and the
 * rail never disagree about which stage is "3".
 */
export function buildGlance(stages: SpineStage[], stepFrom = 1): RunGlance {
  const numbered = stages.map(
    (stage, i): GlanceStage => ({ stage, step: stepFrom + i }),
  );

  const found = numbered.findIndex((entry) => !isSettled(entry.stage));
  const nowIndex = found === -1 ? null : found;

  return {
    stages: numbered,
    nowIndex,
    ahead: nowIndex === null ? [] : numbered.slice(nowIndex + 1),
  };
}

/**
 * The NOW headline — what is happening, as a sentence.
 *
 * The stage's own `note` says what the stage DOES; this says what its current
 * state MEANS, so the panel leads with the state and follows with the detail
 * rather than making the reader infer the first from the second.
 */
export function glanceHeadline(stage: SpineStage): string {
  switch (stage.state) {
    case "active":
      return `${stage.name} — running`;
    case "waiting":
      return `${stage.name} — waiting`;
    case "attention":
      return `${stage.name} — needs a human`;
    case "failed":
      return `${stage.name} — stopped`;
    default:
      return stage.name;
  }
}
