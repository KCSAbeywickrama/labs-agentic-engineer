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

import type { AreaId } from "@aep/agent-stream";

/**
 * A branch note: what an area's chat did since the main chat's previous
 * turn, which that turn's prompt is told (`prompts/turn.ts`
 * `branchNotesNote`). The ThreadBook counts them; only the Issues area's own
 * chat leaves one (its scope reports back with an outcome note; the area
 * focused on an issue works on that issue and tells the main chat nothing).
 */
export interface BranchNote {
  area: AreaId;
  /** Turns that chat completed since then (a positive integer). */
  turns: number;
  /** The newest of those turns' outcome (`areas/outcome.ts`). */
  outcome: string;
}
