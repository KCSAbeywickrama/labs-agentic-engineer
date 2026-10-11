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
import type { ScopeRoles } from "@aep/ui-openapi-view";
import { env } from "../../../config/env";

// The design model's shape: the artifacts a design yields, the dependencies
// that block a feature's build, and the design turn running now. On the
// platform it is worked out from the room (../useDesignModel.ts); the mock
// serves it whole, on the path below, which is not in the contract. The
// design review itself (comments, Checked) is not here: it is the room's
// specs/design/review.json (../model/review.ts).
//
// PROVISIONAL — MOCK-ONLY until E1/E4 land the design's contract: only MSW
// answers the path (mocks/handlers/design.ts). When they ship, this module
// becomes calls on the generated client with contract types, and the handler
// and these hand-written types go.
//
// What is NOT here, on purpose: which features wait for design and which
// designs are out of date. Those are worked out in the browser from the live
// spec (spec/model/designWork.ts), so an edit shows at once.
//
// Plain `fetch`, as in spec/api/specModel.ts: the path is not in the
// contract, and no real server answers it, so there is no token to attach.

/** Who an artifact is for: the business reader, or the engineer. */
export type ArtifactDepth = "business" | "technical";

/** What an artifact's viewer draws. */
export type ArtifactSource =
  | { kind: "roles"; roles: string[]; rows: { action: string; grants: boolean[] }[]; note: string }
  /** The cell architecture (@aep/ui-cell-diagram-view). */
  | { kind: "architecture"; cell: string }
  /** A component's design.json and its API contract (@aep/ui-design-view, @aep/ui-openapi-view). */
  | {
      kind: "contract";
      design: string;
      openapi: string | null;
      roles?: ScopeRoles;
      /** The organization's Registered External resources the component's dependencies reuse, by name. */
      resources?: string[];
    }
  | { kind: "security"; rows: { subject: string; rule: string }[] }
  /** A feature's acceptance file, Gherkin with rules tagged `@story-F2.3` (@aep/ui-acceptance-view). */
  | { kind: "acceptance"; path: string; content: string }
  /** A design document as the design writes it: prose around one mermaid diagram (a flow, the domain model). */
  | { kind: "document"; path: string; markdown: string };

export interface DesignArtifact {
  id: string;
  title: string;
  depth: ArtifactDepth;
  /** The features it covers, by ID. */
  features: string[];
  /** The design revision that added it, and the last one that changed it (DesignModel.revision). */
  addedIn: number;
  changedIn: number;
  source: ArtifactSource;
}

/** Something outside the product a feature needs before it can be built; it blocks that feature only. */
export interface DesignDependency {
  featureId: string;
  /** "Xero". */
  needs: string;
  question: string;
  /** What it blocks, in words. */
  why: string;
  options: string[];
  /** The answer, once settled. */
  answer: string | null;
}

/** The design turn running now, as the server knows it. */
export interface DesignRun {
  kind: "design" | "address";
  /** Features being designed; empty while comments are addressed. */
  features: string[];
}

export interface DesignModel {
  /**
   * Bumped by every turn that changes the design; 0 before the first. null
   * where the design tracks no revisions: on the platform the design is read
   * from the room's files, which carry none.
   */
  revision: number | null;
  running: DesignRun | null;
  artifacts: DesignArtifact[];
  dependencies: DesignDependency[];
}

/** The provisional path MSW serves; `:projectName` is the project's slug. */
export const PROVISIONAL_DESIGN_PATH = "/api/v1/projects/:projectName/provisional/design";

/** Settle a dependency: POST `{ answer }`, answered with the model. */
export const PROVISIONAL_DEPENDENCY_PATH = `${PROVISIONAL_DESIGN_PATH}/dependencies/:featureId/answer`;

/** The design model's query key: what a design turn invalidates. */
export function designKey(projectName: string) {
  return ["projects", projectName, "provisional-design"] as const;
}

function url(template: string, params: Record<string, string>): string {
  const path = template.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(params[name] ?? ""));
  return `${env.apiBaseUrl}${path}`;
}

async function readModel(response: Response, failure: string): Promise<DesignModel> {
  if (!response.ok) throw new Error(failure);
  return (await response.json()) as DesignModel;
}

function post(body?: unknown): RequestInit {
  return body === undefined
    ? { method: "POST" }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/** The mock's design review, whole; never asked for on the platform. */
export function useMockDesignModel(projectName: string, enabled: boolean) {
  return useQuery({
    queryKey: designKey(projectName),
    queryFn: async () =>
      readModel(await fetch(url(PROVISIONAL_DESIGN_PATH, { projectName })), "Couldn't load the design"),
    enabled,
  });
}

/** A change to the design model: the mock answers with the whole model. */
function useDesignMutation<T>(projectName: string, send: (input: T) => Promise<DesignModel>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: (model) => queryClient.setQueryData(designKey(projectName), model),
  });
}

export function useSettleDependency(projectName: string) {
  return useDesignMutation(projectName, async (input: { featureId: string; answer: string }) =>
    readModel(
      await fetch(url(PROVISIONAL_DEPENDENCY_PATH, { projectName, featureId: input.featureId }), post({ answer: input.answer })),
      "Couldn't send your answer",
    ),
  );
}
