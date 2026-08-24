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

import { http, HttpResponse } from "msw";
import type { components } from "../../generated/aep-api";
import {
  emptyOrgEndpoints,
  marketplaceError,
  marketplaceLoadError,
  seedExternalResources,
  seedOrgEndpoints,
  seedPlatformResourceTypes,
  type MarketplaceScenario,
} from "../fixtures/marketplace";

type ApiError = components["schemas"]["Error"];

function scenario(): MarketplaceScenario {
  return (
    (localStorage.getItem("aep:mock:marketplace") as MarketplaceScenario | null) ??
    "empty"
  );
}

function errorJson(body: ApiError, status: number) {
  return HttpResponse.json(body, { status });
}

export const marketplaceHandlers = [
  http.get("*/api/v1/dependencies/org-endpoints", () => {
    if (scenario() === "error") {
      return HttpResponse.json(marketplaceError, { status: 500 });
    }
    if (scenario() === "empty") {
      return HttpResponse.json(emptyOrgEndpoints);
    }
    return HttpResponse.json(seedOrgEndpoints);
  }),

  http.get("*/api/v1/dependencies/platform-resource-types", () => {
    if (scenario() === "error") return errorJson(marketplaceLoadError, 500);
    if (scenario() === "empty") return HttpResponse.json([]);
    return HttpResponse.json(seedPlatformResourceTypes);
  }),

  http.get("*/api/v1/dependencies/external-resources", () => {
    if (scenario() === "error") return errorJson(marketplaceLoadError, 500);
    if (scenario() === "empty") return HttpResponse.json([]);
    return HttpResponse.json(seedExternalResources);
  }),
];
