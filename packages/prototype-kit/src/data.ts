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

/**
 * The mock data a prototype runs on, as it crosses the bridge: `defineApp`'s
 * `data`, keyed by name. An array of records that each have a string `id` is
 * a collection; anything else is a single value. JSON only.
 */

export type DataSnapshot = Record<string, unknown>;

export interface DataRecord {
  id: string;
  [field: string]: unknown;
}

export function isCollection(value: unknown): value is DataRecord[] {
  return (
    Array.isArray(value) &&
    value.every((r) => typeof r === "object" && r !== null && !Array.isArray(r) && typeof (r as { id?: unknown }).id === "string")
  );
}
