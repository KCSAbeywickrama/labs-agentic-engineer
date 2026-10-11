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

// A build is a selection of features: the ones the user picked in the build
// picker, and any new product-wide item that pulls in every feature it
// applies to. It rides the contract's `selection`; the server plans the rest
// (what the picked features need) and refuses a feature that cannot be built.
//
// Starting a build is also the user's consent to what the build provisions:
// the platform resources the design needs that are not provisioned yet, and
// the cross-project endpoints it will ask for. The build preflight lists them,
// and the body carries one approval per item (`inputs`); the platform
// provisions a platform resource only from its approval, and refuses a build
// that would deploy one nobody approved.
//
// A repair build (Fix on a failing scenario: v1.1 fixes v1) rides the
// contract's `repair`, naming the version to fix; the server files the
// scenarios that version's final validation failed as the repair's work.

type BuildRequest = components["schemas"]["BuildRequest"];
type BuildRepair = components["schemas"]["BuildRepair"];
type BuildInputItem = components["schemas"]["BuildInputItem"];
type PreflightItem = components["schemas"]["PreflightItem"];

/** What goes into a build: features by ID ("F1"), and new product-wide items ("P5"). */
export interface BuildSelection {
  features: string[];
  productWide: string[];
}

/** A build's request body. */
export type BuildBody = BuildRequest;

/**
 * The approvals a build carries, one per preflight item it consents to (the
 * classic console's `approvalInputsFor`):
 *
 *   - `platform-resource`: a resource the design needs that is not provisioned
 *     yet. Its design-authored `parameters` ride along, since they are what
 *     the provisioner reads.
 *   - `org-service`: an unresolved cross-project endpoint.
 *
 * Every other kind carries no approval: an external dependency's values are
 * collected while the build runs (the server ignores any it is sent), and a
 * resolution blocker has no input to submit. The preflight lists only what is
 * not provisioned or in flight, so a design whose resources are all ready
 * approves nothing.
 */
export function approvalInputsFor(items: readonly PreflightItem[]): BuildInputItem[] {
  return items.flatMap((item): BuildInputItem[] => {
    const { component, dependency } = item;
    switch (item.kind) {
      case "platform-resource":
        return [
          {
            component,
            dependency,
            kind: "platform-resource",
            approved: true,
            ...(item.parameters ? { parameters: item.parameters } : {}),
          },
        ];
      case "org-service":
        return [{ component, dependency, kind: "org-service", approved: true }];
      default:
        return [];
    }
  });
}

/**
 * The request body that starts a build of this selection, approving what the
 * current preflight lists. No version: the platform names the version, as an
 * untouched name field does in the old console's Start build dialog.
 */
export function buildBody(selection: BuildSelection, preflight: readonly PreflightItem[]): BuildBody {
  return {
    inputs: approvalInputsFor(preflight),
    selection: { features: [...selection.features], productWide: [...selection.productWide] },
  };
}

/** A body's selection, read back as the server would; null when it carries none or a malformed one. */
export function selectionOfBody(body: BuildBody): BuildSelection | null {
  // The body comes off the wire (MSW reads it as JSON), so its shape is checked.
  const s = body.selection as Partial<BuildSelection> | undefined;
  const ids = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
  if (!s || !ids(s.features) || !ids(s.productWide ?? [])) return null;
  if (s.features.length + (s.productWide?.length ?? 0) === 0) return null;
  return { features: s.features, productWide: s.productWide ?? [] };
}

/** The request body that starts a repair build of a version, fixing what failed in it. */
export function fixBody(of: string): BuildBody {
  return { repair: { of } };
}

/** A body's repair, read back as the server would; null when it asks for none or a malformed one. */
export function repairOfBody(body: BuildBody): BuildRepair | null {
  const r = body.repair as Partial<BuildRepair> | undefined;
  return r && typeof r.of === "string" && r.of !== "" ? { of: r.of } : null;
}
