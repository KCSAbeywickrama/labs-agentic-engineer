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

import type { DesignArtifact, DesignDependency, DesignModel } from "../features/design/api/designModel";
import type { DesignSummary } from "../features/spec/api/specModel";
import { isRunning, projectTurns } from "./chatServer";
import type { ArtifactDraft } from "./fixtures/design";

// PROVISIONAL — mock-only until E1/E4; see features/design/api/designModel.ts.
//
// Each project's design, as the mock server keeps it: the artifacts, the
// dependencies found, and which features were designed from what spec. The
// review itself (comments, Checked) is not here: it is the room's
// specs/design/review.json, which the console writes and the mock agent's
// Address comments turn answers (fixtures/designTurns.ts).
//
// A design turn is scripted when it starts (fixtures/designTurns.ts) and
// carries its effect; the effect lands once the turn has finished, the first
// time the design is read after that. Every turn the conversation holds lands,
// as an interview's does (specState.ts): the conversation outlives a reload
// (chatServer.ts), and the design must say what the chat says the agent did,
// or a reload would offer the same design again and run it twice. A design
// made from spec edits a reload dropped then reads as out of date, which it is.
// The files each turn wrote are laid over the spec's on every read
// (`designFileWrites`), so a reload seeds the room with them.

/** What a design-review turn does to the design once it has finished. */
export type DesignEffect =
  | {
      kind: "design";
      features: string[];
      /** The spec each of them was designed from (spec/model/designWork.ts). */
      designedFrom: Record<string, string>;
      /** The whole design as it now reads. */
      drafts: ArtifactDraft[];
      dependencies: DesignDependency[];
      /** The room files it wrote, as the turn left them. */
      files: Record<string, string>;
    }
  | {
      kind: "address";
      /** The room files it wrote (review.json, and what the comments changed), as the turn left them. */
      files: Record<string, string>;
    };

interface StoredDesign {
  revision: number;
  designedFrom: Record<string, string>;
  artifacts: DesignArtifact[];
  dependencies: DesignDependency[];
  /** Turns whose effect has landed. */
  applied: string[];
}

const designs = new Map<string, StoredDesign>();

function empty(): StoredDesign {
  return { revision: 0, designedFrom: {}, artifacts: [], dependencies: [], applied: [] };
}

/** The drafts as artifacts of this revision: new ones added now, the rest changed now when the turn touched them. */
function stamp(previous: DesignArtifact[], drafts: ArtifactDraft[], revision: number, features: readonly string[]): DesignArtifact[] {
  return drafts.map((draft) => {
    const before = previous.find((a) => a.id === draft.id);
    if (!before) return { ...draft, addedIn: revision, changedIn: revision };
    const changed = draft.features.some((f) => features.includes(f)) || JSON.stringify(before.source) !== JSON.stringify(draft.source);
    return { ...draft, addedIn: before.addedIn, changedIn: changed ? revision : before.changedIn };
  });
}

function land(design: StoredDesign, effect: DesignEffect): void {
  design.revision += 1;
  if (effect.kind !== "design") return;
  design.designedFrom = { ...design.designedFrom, ...effect.designedFrom };
  design.artifacts = stamp(design.artifacts, effect.drafts, design.revision, effect.features);
  for (const found of effect.dependencies) {
    if (!design.dependencies.some((d) => d.featureId === found.featureId)) design.dependencies.push(found);
  }
}

/**
 * The project's design with every finished turn's effect landed. A caller
 * that changes it hands it back with `saveDesign`.
 */
export function liveDesign(projectName: string, now = Date.now()): StoredDesign {
  let design = designs.get(projectName);
  if (!design) {
    design = empty();
    designs.set(projectName, design);
  }
  for (const turn of projectTurns(projectName)) {
    if (!turn.design || isRunning(turn, now) || design.applied.includes(turn.turnId)) continue;
    land(design, turn.design);
    design.applied.push(turn.turnId);
  }
  return design;
}

export function saveDesign(projectName: string, design: StoredDesign): void {
  designs.set(projectName, design);
}

/** The design as served. */
export function designView(projectName: string): DesignModel {
  const design = liveDesign(projectName);
  const running = projectTurns(projectName).find((t) => t.design && isRunning(t));
  return {
    revision: design.revision,
    running: running?.design
      ? { kind: running.design.kind, features: running.design.kind === "design" ? running.design.features : [] }
      : null,
    artifacts: design.artifacts,
    dependencies: design.dependencies,
  };
}

/** What the spec model carries of the design (features/spec/api/specModel.ts). */
export function designSummary(projectName: string): DesignSummary {
  return { designedFrom: liveDesign(projectName).designedFrom };
}

/** The room files finished design turns wrote, the latest write of each. */
export function designFileWrites(projectName: string, now = Date.now()): Map<string, string> {
  const files = new Map<string, string>();
  for (const turn of projectTurns(projectName)) {
    const effect = turn.design;
    if (!effect || isRunning(turn, now)) continue;
    for (const [path, content] of Object.entries(effect.files)) files.set(path, content);
  }
  return files;
}
