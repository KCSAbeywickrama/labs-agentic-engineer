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

import { describe, expect, it } from "vitest";
import type { components } from "../../generated/aep-api";
import { approvalInputsFor, buildBody, fixBody, repairOfBody, selectionOfBody } from "./buildSelection";

type PreflightItem = components["schemas"]["PreflightItem"];

const database: PreflightItem = {
  component: "lunch-api",
  dependency: "lunch-db",
  kind: "platform-resource",
  description: "Postgres database",
  resourceType: "postgres-cnpg",
  parameters: { instances: 1 },
};
const billing: PreflightItem = { component: "lunch-api", dependency: "billing", kind: "org-service", description: "Billing endpoint" };

describe("the build selection on the wire", () => {
  it("rides the contract's selection, with no version, approving nothing when the preflight lists nothing", () => {
    const body = buildBody({ features: ["F1", "F2"], productWide: ["P5"] }, []);
    expect(body).toEqual({ inputs: [], selection: { features: ["F1", "F2"], productWide: ["P5"] } });
    expect(body).not.toHaveProperty("version");
  });

  it("approves what the preflight lists", () => {
    const body = buildBody({ features: ["F1"], productWide: [] }, [database]);
    expect(body.inputs).toEqual(approvalInputsFor([database]));
  });

  it("reads back as the server would", () => {
    const selection = { features: ["F1"], productWide: [] };
    expect(selectionOfBody(buildBody(selection, []))).toEqual(selection);
  });

  it("reads a body without a selection, or a malformed one, as none", () => {
    expect(selectionOfBody({ inputs: [] })).toBeNull();
    expect(selectionOfBody({ selection: { features: [1], productWide: [] } } as never)).toBeNull();
  });
});

describe("a repair build on the wire", () => {
  it("names the version it fixes, and reads back as the server would", () => {
    const body = fixBody("v1");
    expect(body).toEqual({ repair: { of: "v1" } });
    expect(repairOfBody(body)).toEqual({ of: "v1" });
    expect(selectionOfBody(body)).toBeNull();
  });

  it("reads a body without a repair, or a malformed one, as none", () => {
    expect(repairOfBody(buildBody({ features: ["F1"], productWide: [] }, []))).toBeNull();
    expect(repairOfBody({ repair: { of: 4 } } as never)).toBeNull();
  });
});

// Clicking Build is the consent to what the build provisions: the platform
// provisions a resource only from its approval (the classic console's
// approvalInputsFor).
describe("the approvals a build carries", () => {
  it("approves a platform resource that is not provisioned yet, carrying the design's parameters", () => {
    expect(approvalInputsFor([database])).toEqual([
      { component: "lunch-api", dependency: "lunch-db", kind: "platform-resource", approved: true, parameters: { instances: 1 } },
    ]);
  });

  it("leaves parameters out when the design authored none", () => {
    const cache: PreflightItem = { component: "lunch-api", dependency: "cache", kind: "platform-resource", description: "Redis", resourceType: "redis" };
    expect(approvalInputsFor([cache])[0]).not.toHaveProperty("parameters");
  });

  it("approves an unresolved cross-project endpoint", () => {
    expect(approvalInputsFor([billing])).toEqual([
      { component: "lunch-api", dependency: "billing", kind: "org-service", approved: true },
    ]);
  });

  it("approves nothing for an external dependency's values or a resolution blocker", () => {
    const items: PreflightItem[] = [
      { component: "lunch-api", dependency: "stripe", kind: "external-config", description: "Stripe", config: [{ key: "STRIPE_KEY", secret: true }] },
      { component: "lunch-api", dependency: "crm", kind: "external-unresolved", description: "No provider chosen yet." },
      { component: "lunch-api", dependency: "partner", kind: "external-spec", description: "No API spec yet." },
    ];
    expect(approvalInputsFor(items)).toEqual([]);
  });

  it("approves a shared resource once per component that consumes it", () => {
    const auth = { ...database, dependency: "user-auth", resourceType: "auth" };
    expect(approvalInputsFor([auth, { ...auth, component: "lunch-web" }]).map((i) => i.component)).toEqual(["lunch-api", "lunch-web"]);
  });
});
