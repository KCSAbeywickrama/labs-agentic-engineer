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
// applies to. The contract's build request cannot say that yet (backend B1).
// Until it does, this module is the one place a selection meets the wire: it
// rides a PROVISIONAL `selection` field beside the contract's own fields.
// aep-api ignores unknown JSON fields, so only MSW reads it. When B1 lands,
// `buildBody` and `selectionOfBody` change and nothing else does.
//
// A repair build (Fix on a failing scenario: v1.1 fixes v1) rides the same
// way, as a PROVISIONAL `repair` field naming the version and the stories
// that failed in it: the contract has no way to ask for one yet.

type BuildRequest = components["schemas"]["BuildRequest"];

/** What goes into a build: features by ID ("F1"), and new product-wide items ("P5"). */
export interface BuildSelection {
  features: string[];
  productWide: string[];
}

/** What a repair build fixes: the version, and the stories whose scenarios failed in it. */
export interface BuildRepair {
  of: string;
  stories: string[];
}

/** PROVISIONAL (B1): the selection, or the repair, which the contract cannot carry yet. Read only by MSW. */
interface ProvisionalSelectionField {
  selection?: BuildSelection;
  repair?: BuildRepair;
}

/** A build's request body: the contract's, plus the provisional selection. */
export type BuildBody = BuildRequest & ProvisionalSelectionField;

/**
 * The request body that starts a build of this selection. No inputs and no
 * version: the platform names the version, as an untouched name field does
 * in the console's Start build dialog.
 */
export function buildBody(selection: BuildSelection): BuildBody {
  return {
    inputs: [],
    selection: { features: [...selection.features], productWide: [...selection.productWide] },
  };
}

/** A body's selection, read back as the server would; null when it carries none or a malformed one. */
export function selectionOfBody(body: BuildBody): BuildSelection | null {
  const s = body.selection as Partial<BuildSelection> | undefined;
  const ids = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
  if (!s || !ids(s.features) || !ids(s.productWide ?? [])) return null;
  return { features: s.features, productWide: s.productWide ?? [] };
}

/** The request body that starts a repair build of a version, fixing what failed in it. */
export function fixBody(of: string, stories: string[]): BuildBody {
  return { inputs: [], repair: { of, stories: [...stories] } };
}

/** A body's repair, read back as the server would; null when it asks for none or a malformed one. */
export function repairOfBody(body: BuildBody): BuildRepair | null {
  const r = body.repair as Partial<BuildRepair> | undefined;
  if (!r || typeof r.of !== "string" || !Array.isArray(r.stories) || !r.stories.every((x) => typeof x === "string")) {
    return null;
  }
  return { of: r.of, stories: r.stories };
}
