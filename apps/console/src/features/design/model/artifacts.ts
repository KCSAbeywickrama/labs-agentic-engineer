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

import type { DesignDependency } from "../api/designModel";
import type { DesignItem } from "./designFiles";

// What the Design card opens (`?art=`): the Overview (no key), every comment
// (`comments`), one of the design's files by its item key, or a dependency
// the design leaves waiting on a person (`dep-F3`), which blocks its own
// feature's build and nothing else.

/** Dependencies still waiting on an answer. */
export function blockingDependencies(dependencies: DesignDependency[]): DesignDependency[] {
  return dependencies.filter((d) => d.answer === null);
}

/** The key the design card's URL names a dependency by (`?art=dep-F3`), beside the files' own keys. */
export function dependencyKey(featureId: string): string {
  return `dep-${featureId}`;
}

/** The pane `?art=` names; the Overview for none, or for a key nothing has any more. */
export type DesignPane =
  | { kind: "overview" }
  | { kind: "comments" }
  | { kind: "item"; item: DesignItem }
  | { kind: "blocking"; dependency: DesignDependency };

export const COMMENTS_KEY = "comments";

export function openPane(items: readonly DesignItem[], blocking: readonly DesignDependency[], art: string | undefined): DesignPane {
  if (art === COMMENTS_KEY) return { kind: "comments" };
  const item = items.find((i) => i.key === art);
  if (item) return { kind: "item", item };
  const dependency = blocking.find((d) => dependencyKey(d.featureId) === art);
  return dependency ? { kind: "blocking", dependency } : { kind: "overview" };
}
