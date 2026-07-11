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

import type { components } from "../../../generated/aep-api";

type Deployment = components["schemas"]["Deployment"];

// A web app's public URL from its deployments (#196): the first deployment
// carrying a resolved endpointUrl — the same "first non-empty" rule aep-api's
// runtime-config uses. Today only the dev environment deploys, so first
// non-empty and "the dev URL" coincide.
export function firstEndpointUrl(
  items: Deployment[] | null | undefined,
): string | undefined {
  for (const d of items ?? []) {
    if (d.endpointUrl) return d.endpointUrl;
  }
  return undefined;
}
