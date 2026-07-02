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

import express from "express";
import { jwtAuthMiddleware } from "../middleware/jwt.js";
import { correlationIdMiddleware } from "../middleware/correlation.js";
import { requireOrgId, requireAnthropicKey } from "../middleware/org-id.js";
import { registerDocumentGeneration } from "./routes/document-generation.js";
import { registerArchitect } from "./routes/architect.js";
import {
  registerTechLeadPlan,
  registerTechLeadDetail,
} from "./routes/tech-lead.js";
import { registerRequirementsChat } from "./routes/requirements-chat.js";
import { registerInternalDslRender } from "./routes/internal-dsl.js";
import { AGENTS_BASE, INTERNAL_V1 } from "../shared/config.js";

const port = parseInt(process.env.PORT || "3400", 10);

const app = express();
app.use(express.json({ limit: "1mb" }));

// Correlation ID first so /healthz also gets one in logs.
app.use(correlationIdMiddleware());

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

const jwksUrl = process.env.JWKS_URL;
const jwtIssuer = process.env.JWT_ISSUER;
const jwtAudience = process.env.JWT_AUDIENCE || "agents-service";
const resourceMetadataUrl = process.env.JWT_RESOURCE_METADATA_URL;

// Fail closed: every internal call carries a BFF-signed identity JWT, so the
// gate covers the whole INTERNAL_V1 subtree — both the AGENTS_BASE routes and
// the sibling dsl/render helper (previously unauthenticated). JWKS_URL +
// JWT_ISSUER point at the BFF (/auth/external/jwks.json, iss aep-bff), and
// the org travels in the verified ocOrgId claim, not a trusted header. A
// missing value is a misconfiguration, not a dev mode, so refuse to start
// rather than silently disable auth (matches the BFF).
if (!jwksUrl || !jwtIssuer) {
  console.error("JWKS_URL and JWT_ISSUER are required — refusing to start.");
  process.exit(1);
}
app.use(
  INTERNAL_V1,
  jwtAuthMiddleware({ jwksUrl, issuer: jwtIssuer, audience: jwtAudience, resourceMetadataUrl }),
);

// The AGENTS_BASE routes additionally need the org id (from the verified
// ocOrgId claim) and the effective Anthropic key (forwarded by the BFF as
// X-Anthropic-Key). dsl/render — a sibling under INTERNAL_V1 — needs neither,
// so these stay scoped to AGENTS_BASE.
app.use(AGENTS_BASE, requireOrgId());
app.use(AGENTS_BASE, requireAnthropicKey());

registerDocumentGeneration(app);
registerArchitect(app);
registerTechLeadPlan(app);
registerTechLeadDetail(app);
registerRequirementsChat(app);
registerInternalDslRender(app);

app.listen(port, () => {
  console.log(`agents-service listening on :${port}`);
});
