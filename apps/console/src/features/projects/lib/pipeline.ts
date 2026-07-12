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
    case "deployed":
      return { version, line: "live in dev", tone: "success" };
    case "failed":
      return { version, line: "deploy failed", tone: "error" };
    default:
      return { version: "", line: "nothing deployed", tone: "ghost" };
  }
}
