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

import type { DesignQueue, FeatureView } from "./workspace";

// The Spec card's step forward, at its top right (D07 rule 6, amended): the
// next interview while features are still stubs, and Design beside it. The
// Spec screen has exactly one primary:
//
//  - while a feature is a stub, Interview <its name> is the primary and Design
//    is secondary (designing early is allowed; the interviews go on). On the
//    stub's own page its Start interview is the primary, so the header's goes;
//  - once every feature is interviewed, Design is the primary while there is
//    something to design ("Design 3 features", "Update design · 1 feature");
//  - before any feature is interviewed, Design is there but disabled, with why.
//
// A page whose own box asks for an answer (a blocking question) keeps that
// box's Answer as its primary: the header's buttons are then secondary.

export interface SpecActionsView {
  /** The next stub to interview, and whether its button is the primary; null when none is offered here. */
  interview: { feature: FeatureView; primary: boolean } | null;
  /** Design: its words and whether it is the primary, or disabled with the reason; null when nothing waits to be designed. */
  design: { label: string; primary: boolean } | { disabled: string } | null;
}

export function specActions(input: { features: readonly FeatureView[]; design: Pick<DesignQueue, "label">; file: string | undefined }): SpecActionsView {
  const { features, design, file } = input;
  const open = features.find((f) => f.id === file);
  // The open page has a primary of its own: a stub's Start interview, or a blocking question's Answer.
  const onStub = open?.stage === "Not interviewed";
  const pageAsks = (open?.blocking.length ?? 0) > 0;
  const stubs = features.filter((f) => f.stage === "Not interviewed");
  const nextStub = stubs.find((f) => f.blocking.length === 0);
  const interview = nextStub && !onStub ? { feature: nextStub, primary: !pageAsks } : null;
  const interviewed = features.length - stubs.length;
  if (features.length > 0 && interviewed === 0) return { interview, design: { disabled: "Interview a feature first" } };
  if (!design.label) return { interview, design: null };
  return { interview, design: { label: design.label, primary: stubs.length === 0 && !onStub && !pageAsks } };
}
