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

import type { LegState, ProjectTrack } from "./model/track";

// The overview's track, Spec · Design · Build · Deploy, as the four legs it
// draws: each with its number, its status lamp, the short state line, and
// what it opens: the Spec, Design or Builds card, or the Deploy Page. Their
// states are worked out from the page's state (model/track.ts).

/** What a leg opens: a card over the overview, or the Deploy Page. */
export type LegTarget = "spec" | "design" | "builds" | "deploy";

export interface TrackLegView {
  key: "spec" | "design" | "build" | "deploy";
  step: number;
  title: string;
  state: LegState;
  /** What the lamp means in words: colour is never the only signal. */
  stateLabel: string;
  summary: string;
  /** The leg read out whole: title, state in words, and the state line when it adds to them. */
  accessibleName: string;
  opens: LegTarget;
}

const STATE_LABEL: Record<LegState, string> = {
  done: "Done",
  live: "In progress",
  waiting: "Waiting on you",
  notyet: "Not yet",
};

export function legStateLabel(state: LegState): string {
  return STATE_LABEL[state];
}

function leg(
  key: TrackLegView["key"],
  step: number,
  title: string,
  opens: LegTarget,
  state: LegState,
  summary: string,
): TrackLegView {
  const stateLabel = legStateLabel(state);
  const accessibleName =
    summary && summary !== stateLabel ? `${title}: ${stateLabel}. ${summary}` : `${title}: ${stateLabel}`;
  return { key, step, title, opens, state, summary, stateLabel, accessibleName };
}

export function trackLegs(track: ProjectTrack): TrackLegView[] {
  return [
    leg("spec", 1, "Spec", "spec", track.spec.state, track.spec.summary),
    leg("design", 2, "Design", "design", track.design.state, track.design.summary),
    leg("build", 3, "Build", "builds", track.build.state, track.build.summary),
    leg("deploy", 4, "Deploy", "deploy", track.deploy.state, track.deploy.summary),
  ];
}
