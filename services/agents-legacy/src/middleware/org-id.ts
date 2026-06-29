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

import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Derives the org id from the verified BFF identity token — the `ocOrgId`
 * claim placed on `res.locals.tokenClaims` by jwtAuthMiddleware — and stashes
 * it on `res.locals.orgId`. The org travels in the signed claim, not a trusted
 * header, so a caller can only ever act on the org the BFF minted the token
 * for. Required for every /internal/v1/agents/* route (org-key vs.
 * platform-fallback scoping); the sibling dsl/render needs no org and is not
 * gated by this.
 *
 * Returns 401 if the claim is absent (a token without an org is a contract
 * violation), 400 if it is not a valid OC org slug (DNS-label-like; mirrors
 * git-service's `validate.Slug`).
 */
const ORG_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function requireOrgId(): RequestHandler {
  return function orgId(_req: Request, res: Response, next: NextFunction): void {
    const claims = (res.locals as Record<string, unknown>).tokenClaims as
      | Record<string, unknown>
      | undefined;
    const raw = claims?.ocOrgId;
    if (typeof raw !== "string" || raw.length === 0) {
      res.status(401).json({
        error: "service token missing ocOrgId claim",
        code: "org_claim_required",
      });
      return;
    }
    if (!ORG_ID_PATTERN.test(raw)) {
      res.status(400).json({
        error: `ocOrgId "${raw}" does not match a valid OC org slug`,
        code: "org_id_invalid",
      });
      return;
    }
    (res.locals as Record<string, unknown>).orgId = raw;
    next();
  };
}

/** Convenience getter — returns the org id stored by requireOrgId. */
export function getOrgId(res: Response): string {
  const v = (res.locals as Record<string, unknown>).orgId;
  if (typeof v !== "string" || v.length === 0) {
    throw new Error("orgId not present on res.locals — requireOrgId middleware not applied?");
  }
  return v;
}

export const ANTHROPIC_KEY_HEADER = "x-anthropic-key";

/**
 * Reads X-Anthropic-Key and stashes it on `res.locals.anthropicKey`. The BFF
 * resolves the per-org effective key in-process (from the gated, token-derived
 * org) and forwards it on every /internal/v1/agents/* call, so agents-service no longer
 * resolves it. Returns 400 if the header is missing.
 */
export function requireAnthropicKey(): RequestHandler {
  return function anthropicKey(req: Request, res: Response, next: NextFunction): void {
    const raw = req.header(ANTHROPIC_KEY_HEADER);
    if (!raw || raw.length === 0) {
      res.status(400).json({
        error: "missing required header X-Anthropic-Key",
        code: "anthropic_key_required",
      });
      return;
    }
    (res.locals as Record<string, unknown>).anthropicKey = raw;
    next();
  };
}

/** Convenience getter — returns the key stored by requireAnthropicKey. */
export function getAnthropicKey(res: Response): string {
  const v = (res.locals as Record<string, unknown>).anthropicKey;
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(
      "anthropicKey not present on res.locals — requireAnthropicKey middleware not applied?",
    );
  }
  return v;
}
