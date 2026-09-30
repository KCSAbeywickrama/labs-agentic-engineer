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
import type { SpecFeature } from "../spec/api/specModel";
import { bundlePath, roomPathOf } from "../spec/model/files";
import type { ProjectCard } from "../shell/scope";

// A project has one conversation; each turn in it carries a scope, taken from
// where the user was when they sent it. A feature file open in the spec card
// scopes the turn to that feature; the design card, to the design review;
// anywhere else in the project, to the whole product.
//
// The contract has no scope field yet (backend S6). Until it does, this module
// is the one place a scope meets the wire:
//  - a feature rides the contract's own `target`, which is "the spec-bundle
//    path this turn should write to": exactly what a feature scope means;
//  - the whole product is the absence of a target, as it is today;
//  - the design review has no field that fits, so it rides a PROVISIONAL
//    `scope` field. aep-api ignores unknown JSON fields, so only MSW reads it.
// When S6 lands, `turnBody` and `scopeOfBody` change and nothing else does.

type TurnInputBody = components["schemas"]["TurnInputBody"];

/** What one turn is about. */
export type TurnScope =
  | { kind: "product" }
  | { kind: "feature"; featureId: string; name: string; path: string }
  | { kind: "design" };

/** PROVISIONAL (S6): the one scope the contract cannot say yet. Read only by MSW. */
interface ProvisionalScopeField {
  scope?: "design-review";
}

/** A turn's request body: the contract's, plus the provisional scope field. */
export type TurnBody = TurnInputBody & ProvisionalScopeField;

/** The scope of a turn sent from here: the open card, and the feature open in the spec card. */
export function turnScopeFor(
  card: ProjectCard | null,
  feature: Pick<SpecFeature, "id" | "name" | "path"> | null,
): TurnScope {
  if (card === "design") return { kind: "design" };
  if (card === "spec" && feature) return featureScope(feature);
  return { kind: "product" };
}

export function featureScope(feature: Pick<SpecFeature, "id" | "name" | "path">): TurnScope {
  return { kind: "feature", featureId: feature.id, name: feature.name, path: feature.path };
}

/**
 * The request body of a turn: the user's words, scoped. `collab` makes it a
 * room turn, as the console's spec chat is: the agent edits the shared spec.
 */
export function turnBody(instruction: string, scope: TurnScope): TurnBody {
  const body: TurnBody = { instruction, collab: true };
  if (scope.kind === "feature") body.target = bundlePath(scope.path);
  if (scope.kind === "design") body.scope = "design-review";
  return body;
}

/** A body's scope, read back as the server would: a feature by its room path. */
export type WireScope = { kind: "product" } | { kind: "feature"; path: string } | { kind: "design" };

export function scopeOfBody(body: TurnBody): WireScope {
  if (body.target) return { kind: "feature", path: roomPathOf(body.target) };
  if (body.scope === "design-review") return { kind: "design" };
  return { kind: "product" };
}
