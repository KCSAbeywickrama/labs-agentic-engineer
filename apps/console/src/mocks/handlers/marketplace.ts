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
  externalResourceCatalog,
  marketplaceError,
  marketplaceLoadError,
  seedOrgEndpoints,
  seedOrgEnvironments,
  seedPlatformResourceTypes,
  type MarketplaceScenario,
} from "../fixtures/marketplace";

type ApiError = components["schemas"]["Error"];
type RegisterExternalResourceRequest =
  components["schemas"]["RegisterExternalResourceRequest"];
type ExternalResourceDTO = components["schemas"]["ExternalResourceDTO"];
type EnvValueCellDTO = components["schemas"]["EnvValueCellDTO"];

function scenario(): MarketplaceScenario {
  return (
    (localStorage.getItem("aep:mock:marketplace") as MarketplaceScenario | null) ??
    "empty"
  );
}

function errorJson(body: ApiError, status: number) {
  return HttpResponse.json(body, { status });
}

function missingRequired(body: RegisterExternalResourceRequest): boolean {
  if (typeof body.name !== "string" || body.name.trim() === "") return true;
  if (typeof body.description !== "string" || body.description.trim() === "") {
    return true;
  }
  if (
    typeof body.consumptionInstructions !== "string" ||
    body.consumptionInstructions.trim() === ""
  ) {
    return true;
  }
  if (!Array.isArray(body.config) || body.config.length === 0) return true;
  if (!Array.isArray(body.envValues) || body.envValues.length === 0) return true;
  return false;
}

function emptyEnvValue(body: RegisterExternalResourceRequest): boolean {
  return body.envValues.some(
    (row) => typeof row.value !== "string" || row.value.trim() === "",
  );
}

function sameConfigIdentity(
  existing: NonNullable<ExternalResourceDTO["config"]>,
  next: RegisterExternalResourceRequest["config"],
): boolean {
  if (existing.length !== next.length) return false;
  const got = new Map<string, boolean>();
  for (const k of next) {
    if (got.has(k.key)) return false;
    got.set(k.key, Boolean(k.secret));
  }
  if (got.size !== existing.length) return false;
  for (const k of existing) {
    const secret = got.get(k.key);
    if (secret === undefined || secret !== Boolean(k.secret)) return false;
  }
  return true;
}

function registeredFromRequest(
  body: RegisterExternalResourceRequest,
): ExternalResourceDTO {
  const secretKeys = new Set(
    body.config.filter((k) => k.secret === true).map((k) => k.key),
  );
  const envCells: EnvValueCellDTO[] = body.envValues.map((row) => {
    const cell: EnvValueCellDTO = {
      environment: row.environment,
      key: row.key,
      status: "configured",
    };
    if (!secretKeys.has(row.key)) {
      cell.value = row.value;
    }
    return cell;
  });
  return {
    name: body.name.trim(),
    description: body.description,
    consumptionInstructions: body.consumptionInstructions,
    config: body.config,
    consumers: [],
    envCells,
    ...(body.resourceDocs ? { resourceDocs: body.resourceDocs } : {}),
  };
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

  http.get("*/api/v1/dependencies/environments", () => {
    if (scenario() === "error") return errorJson(marketplaceLoadError, 500);
    if (scenario() === "empty") return HttpResponse.json([]);
    return HttpResponse.json(seedOrgEnvironments);
  }),

  http.get("*/api/v1/dependencies/external-resources", () => {
    if (scenario() === "error") return errorJson(marketplaceLoadError, 500);
    return HttpResponse.json(externalResourceCatalog(scenario()));
  }),

  http.post("*/api/v1/dependencies/external-resources", async ({ request }) => {
    const body = (await request.json()) as RegisterExternalResourceRequest | null;
    if (!body || missingRequired(body) || emptyEnvValue(body)) {
      return errorJson(
        { code: "bad_request", message: "Missing required field or empty env value" },
        400,
      );
    }
    const catalog = externalResourceCatalog(scenario());
    if (catalog.some((r) => r.name === body.name.trim())) {
      return errorJson(
        {
          code: "conflict",
          message: `External resource ${body.name.trim()} is already registered`,
        },
        409,
      );
    }
    const created = registeredFromRequest(body);
    catalog.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.put("*/api/v1/dependencies/external-resources/:name", async ({ params, request }) => {
    const name = String(params.name);
    const body = (await request.json()) as RegisterExternalResourceRequest | null;
    const catalog = externalResourceCatalog(scenario());
    const idx = catalog.findIndex((r) => r.name === name);
    if (idx < 0) {
      return errorJson(
        { code: "not_found", message: `External resource ${name} not found` },
        404,
      );
    }
    const current = catalog[idx]!;
    if (!Array.isArray(current.envCells) || current.envCells.length === 0) {
      return errorJson(
        {
          code: "conflict",
          message: `External resource ${name} is a Project External resource`,
        },
        409,
      );
    }
    if (!body || missingRequired(body)) {
      return errorJson(
        { code: "bad_request", message: "Missing required field" },
        400,
      );
    }
    if (!sameConfigIdentity(current.config ?? [], body.config)) {
      return errorJson(
        { code: "bad_request", message: "config key identity cannot be changed" },
        400,
      );
    }

    const secretKeys = new Set(
      body.config.filter((k) => k.secret === true).map((k) => k.key),
    );
    const submitted = new Map<string, string>();
    for (const row of body.envValues) {
      submitted.set(`${row.environment}:${row.key}`, row.value);
    }

    const envCells: EnvValueCellDTO[] = [];
    for (const cell of current.envCells) {
      const id = `${cell.environment}:${cell.key}`;
      const value = submitted.get(id);
      const empty = value === undefined || value.trim() === "";
      const isSecret = secretKeys.has(cell.key);
      if (isSecret && empty) {
        if (cell.status !== "configured") {
          return errorJson(
            {
              code: "bad_request",
              message: `missing env value for key ${cell.key} in environment ${cell.environment}`,
            },
            400,
          );
        }
        envCells.push({
          environment: cell.environment,
          key: cell.key,
          status: "configured",
        });
        continue;
      }
      if (empty) {
        return errorJson(
          {
            code: "bad_request",
            message: `missing env value for key ${cell.key} in environment ${cell.environment}`,
          },
          400,
        );
      }
      const next: EnvValueCellDTO = {
        environment: cell.environment,
        key: cell.key,
        status: "configured",
      };
      if (!isSecret) {
        next.value = value;
      }
      envCells.push(next);
    }

    const updated: ExternalResourceDTO = {
      ...current,
      name,
      description: body.description,
      consumptionInstructions: body.consumptionInstructions,
      config: body.config,
      envCells,
    };
    if (body.resourceDocs) {
      updated.resourceDocs = body.resourceDocs;
    } else {
      delete updated.resourceDocs;
    }
    catalog[idx] = updated;
    return HttpResponse.json(updated, { status: 200 });
  }),
];
