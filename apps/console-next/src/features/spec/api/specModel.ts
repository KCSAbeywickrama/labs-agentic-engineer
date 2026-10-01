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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { env } from "../../../config/env";

// PROVISIONAL — MOCK-ONLY until S3 lands the spec model's contract.
//
// The spec workspace needs the spec model: each feature's stage, which
// product-wide items apply where, the source documents, and the markdown of
// every file. Nothing in aep-api serves that yet. Until it does, the shape lives here, behind this one module, and only
// MSW answers it (mocks/handlers/spec.ts, on a path that is not in the
// contract). When S3 ships, this module becomes a call on the generated client
// with contract types, and the handler and these hand-written types go.
//
// What is NOT here, on purpose: anything the documents already say. The ID
// index, the Fog, the lines still to confirm, the questions a feature waits on
// (model/questions.ts) and Next up are all worked out in the browser from the
// live documents (model/workspace.ts), so an edit shows in them at once and
// nothing says the same thing twice.
//
// `files` is the stand-in for the collab room: the local doc is seeded from it
// (collab/specDoc.ts). When the provider is wired, the room holds the files
// and the agent's marked writes, and the field is deleted.
//
// Plain `fetch`, as in builds/api/builds.ts: the path is not in the contract,
// and no real server answers it, so there is no token to attach.

/** Where a feature is in its journey. */
export type FeatureStage = "Not interviewed" | "Interviewing" | "Interviewed" | "Designed";

export interface SpecFeature {
  /** "F2". */
  id: string;
  name: string;
  /** Its file in the spec room, e.g. "specs/requirements/features/F2-approvals.md". */
  path: string;
  purpose: string;
  stage: FeatureStage;
}

/** A product-wide item and the features it applies to. Its words are in product-wide.md. */
export interface ProductWideItem {
  /** "P4". */
  id: string;
  /** Feature IDs, or "all". */
  appliesTo: string[] | "all";
}

/** A document the user attached: what it says, page by page, and where each point landed. */
export interface SourceDocument {
  id: string;
  title: string;
  pages: number;
  rows: { page: string; says: string; landedIn: string | null }[];
}

/** Who wrote a pending change: the attributes of its agentInsertion marks in the doc. */
export interface AgentWriter {
  agent: string;
  at: string;
}

/**
 * A spec line a design comment changed: the comment was really a
 * requirement, so addressing it rewrote the line. It stays marked in the spec
 * until the comment is resolved; `seen` turns true once the user has opened
 * the Spec tab since (the tab's dot).
 */
export interface DesignSpecChange {
  /** The line's ID, "F2.2". */
  lineId: string;
  featureId: string;
  /** The comment's pin number. */
  comment: number;
  seen: boolean;
}

/**
 * What the spec workspace knows of the design review (the design card reads
 * the rest, features/design/api/designModel.ts). Which features wait for
 * design, and which designs are out of date, is worked out in the browser
 * from `designedFrom` and the live documents (model/designWork.ts).
 */
export interface DesignSummary {
  /** Each designed feature, and the spec it was designed from (its basis, model/designWork.ts). */
  designedFrom: Record<string, string>;
  /** Design comments not yet addressed. */
  openComments: number;
  specChanges: DesignSpecChange[];
}

export interface SpecModel {
  features: SpecFeature[];
  documents: SourceDocument[];
  design: DesignSummary;
  /** Markdown by room path ("specs/requirements/prd.md"). The collab room replaces this. */
  files: Record<string, string>;
}

/** The provisional path MSW serves; `:projectName` is the project's slug. */
export const PROVISIONAL_SPEC_PATH = "/api/v1/projects/:projectName/provisional/spec";

/** The user has seen the spec lines design comments changed: POST, answered with the model. */
export const PROVISIONAL_SPEC_CHANGES_SEEN_PATH = `${PROVISIONAL_SPEC_PATH}/design-changes/seen`;

/** The spec model's query key: what changes the model (an agent turn) invalidates. */
export function specKey(projectName: string) {
  return ["projects", projectName, "provisional-spec"] as const;
}

function url(template: string, params: Record<string, string>): string {
  const path = template.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(params[name] ?? ""));
  return `${env.apiBaseUrl}${path}`;
}

async function readModel(response: Response, failure: string): Promise<SpecModel> {
  if (!response.ok) throw new Error(failure);
  return (await response.json()) as SpecModel;
}

export function useSpecModel(projectName: string) {
  return useQuery({
    queryKey: specKey(projectName),
    queryFn: async () => readModel(await fetch(url(PROVISIONAL_SPEC_PATH, { projectName })), "Couldn't load the spec"),
  });
}

/** Mark the spec lines design comments changed as seen: the Spec tab's dot goes. */
export function useSeeDesignChanges(projectName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      readModel(
        await fetch(url(PROVISIONAL_SPEC_CHANGES_SEEN_PATH, { projectName }), { method: "POST" }),
        "Couldn't update the spec",
      ),
    onSuccess: (model) => queryClient.setQueryData(specKey(projectName), model),
  });
}
