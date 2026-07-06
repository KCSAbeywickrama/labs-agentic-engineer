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

import { Server } from "@hocuspocus/server";
import type {
  onAuthenticatePayload,
  onLoadDocumentPayload,
} from "@hocuspocus/server";
import type { CollabConfig } from "./env.js";
import type { BffClient, CollabIdentity } from "./bff.js";
import { isSpecRoom } from "./room.js";
import { seedDocument } from "./seed.js";
import { devSpecBundle } from "./fixtures.js";

// Connection context established by onAuthenticate and consumed by later
// hooks. The token is retained for the seed read (performed as the first
// joiner) — it never leaves this process except toward the BFF.
export interface CollabContext {
  user: CollabIdentity & { kind: "user" | "dev" };
  token: string | null;
  /** From the `project` ws request parameter; needed because the room ID
   *  can't be split without the org (only the BFF can do that). */
  projectName: string | null;
}

export interface CollabDeps {
  bff: BffClient | null;
  log?: (message: string) => void;
}

export function buildAuthenticateHook(config: CollabConfig, deps: CollabDeps) {
  return async (
    data: Pick<
      onAuthenticatePayload,
      "token" | "documentName" | "requestParameters"
    >,
  ): Promise<CollabContext> => {
    const { token, documentName, requestParameters } = data;
    if (!isSpecRoom(documentName)) {
      throw new Error(`unknown room: ${documentName}`);
    }
    const projectName = requestParameters.get("project") || null;

    if (config.devMode) {
      return {
        user: { name: "Dev User", email: "dev@localhost", kind: "dev" },
        token: null,
        projectName,
      };
    }

    if (!deps.bff) throw new Error("no BFF configured");
    if (!token) throw new Error("missing token");
    // The oracle does both halves: JWT verification (Thunder JWKS) and the
    // room's project-ownership/tenancy check. This service verifies nothing
    // itself (#86: identity stays the BFF's problem).
    const identity = await deps.bff.validateAccess(token, documentName);
    return {
      user: { ...identity, kind: "user" },
      token,
      projectName,
    };
  };
}

export function buildLoadDocumentHook(config: CollabConfig, deps: CollabDeps) {
  return async (
    data: Pick<onLoadDocumentPayload, "document" | "documentName"> & {
      context: CollabContext;
    },
  ) => {
    const { document, documentName, context } = data;

    if (config.devMode) {
      seedDocument(document, devSpecBundle);
      deps.log?.(`seeded ${documentName} from dev fixtures`);
      return document;
    }

    // Real path: read the spec bundle as the first joiner. Requires the
    // `project` ws parameter (the room ID alone can't be split, see room.ts).
    if (!deps.bff || !context.token || !context.projectName) {
      deps.log?.(
        `cannot seed ${documentName}: missing bff/token/project — opening empty`,
      );
      return document;
    }
    const files = await deps.bff.fetchSpecBundle(
      context.token,
      context.projectName,
    );
    seedDocument(document, files);
    deps.log?.(`seeded ${documentName} (${files.length} files) from BFF`);
    return document;
  };
}

export function createCollabServer(
  config: CollabConfig,
  deps: CollabDeps,
): Server<CollabContext> {
  return new Server<CollabContext>({
    name: "aep-collab",
    // No persistence extension yet: the committer worker is #86 phase 3.
    // Until then a doc's life is its room's life; the seed is the recovery
    // story. Keep docs loaded only while connections exist.
    unloadImmediately: true,
    onAuthenticate: buildAuthenticateHook(config, deps),
    onLoadDocument: buildLoadDocumentHook(config, deps) as (
      data: onLoadDocumentPayload<CollabContext>,
    ) => Promise<unknown>,
  });
}
