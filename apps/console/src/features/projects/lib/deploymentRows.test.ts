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
import {
  deploymentsAreMoving,
  groupDeploymentCards,
  statusKind,
} from "./deploymentRows";
import type { components } from "../../../generated/aep-api";

type Component = components["schemas"]["Component"];
type Deployment = components["schemas"]["Deployment"];

function component(name: string, displayName?: string): Component {
  return {
    name,
    displayName: displayName ?? name,
    description: "",
    type: "service",
    status: "active",
  };
}

const devReady: Deployment = {
  componentName: "catalog-api",
  environment: "development",
  status: "Ready",
  releaseName: "demo-catalog-abc",
  endpointUrl: "https://catalog.dev.example.io",
  createdAt: "2026-07-12T05:00:00Z",
};

const prodReady: Deployment = {
  componentName: "catalog-api",
  environment: "production",
  status: "Ready",
  releaseName: "demo-catalog-abc",
  endpointUrl: "https://catalog.example.io",
  createdAt: "2026-07-12T06:00:00Z",
};

describe("statusKind", () => {
  it("maps Ready to success", () => {
    expect(statusKind("Ready")).toBe("success");
  });

  it("maps the distinguished Undeployed value to undeployed", () => {
    expect(statusKind("Undeployed")).toBe("undeployed");
  });

  it("maps failure-ish reasons to error", () => {
    expect(statusKind("ReleaseFailed")).toBe("error");
    expect(statusKind("DeploymentError")).toBe("error");
  });

  it("maps anything else to transitional", () => {
    expect(statusKind("Progressing")).toBe("transitional");
    expect(statusKind("ResourcesCreated")).toBe("transitional");
  });

  it("maps absent status to unknown", () => {
    expect(statusKind(undefined)).toBe("unknown");
    expect(statusKind("")).toBe("unknown");
  });
});

describe("groupDeploymentCards", () => {
  it("routes bindings to their environment's column", () => {
    const { development, production } = groupDeploymentCards(
      [component("catalog-api", "Catalog API")],
      [devReady, prodReady],
    );
    expect(development).toHaveLength(1);
    expect(development[0]?.deployment?.environment).toBe("development");
    expect(production).toHaveLength(1);
    expect(production[0]?.deployment?.environment).toBe("production");
    expect(production[0]?.displayName).toBe("Catalog API");
  });

  it("gives every component a development card, greyed Not deployed when unbound", () => {
    const { development, production } = groupDeploymentCards(
      [component("storefront", "Storefront"), component("catalog-api")],
      [devReady],
    );
    expect(development).toHaveLength(2);
    const storefront = development.find((c) => c.componentName === "storefront");
    expect(storefront?.kind).toBe("notDeployed");
    expect(storefront?.deployment).toBeUndefined();
    expect(production).toHaveLength(0);
  });

  it("keeps a component deployed only in production visible as Not deployed in dev", () => {
    const { development, production } = groupDeploymentCards(
      [component("catalog-api")],
      [prodReady],
    );
    expect(production).toHaveLength(1);
    expect(development).toHaveLength(1);
    expect(development[0]?.kind).toBe("notDeployed");
  });

  it("puts non-production environments in the development column", () => {
    const staging: Deployment = {
      componentName: "catalog-api",
      environment: "staging",
      status: "Ready",
    };
    const { development, production } = groupDeploymentCards(
      [component("catalog-api")],
      [devReady, staging],
    );
    expect(production).toHaveLength(0);
    expect(development).toHaveLength(2);
    expect(development.map((c) => c.deployment?.environment)).toEqual([
      "development",
      "staging",
    ]);
  });

  it("shows deployments whose component is missing from the list", () => {
    const { development } = groupDeploymentCards([], [devReady]);
    expect(development).toHaveLength(1);
    expect(development[0]?.componentName).toBe("catalog-api");
    expect(development[0]?.displayName).toBe("catalog-api");
  });

  it("sorts each column by component name", () => {
    const { development } = groupDeploymentCards(
      [component("zeta"), component("alpha")],
      [],
    );
    expect(development.map((c) => c.componentName)).toEqual(["alpha", "zeta"]);
  });

  it("marks intentionally undeployed bindings", () => {
    const { development } = groupDeploymentCards(
      [component("orders-api")],
      [
        {
          componentName: "orders-api",
          environment: "development",
          status: "Undeployed",
        },
      ],
    );
    expect(development[0]?.kind).toBe("undeployed");
  });
});

describe("deploymentsAreMoving", () => {
  it("is true while any binding is transitional", () => {
    expect(
      deploymentsAreMoving([devReady, { ...devReady, status: "Progressing" }]),
    ).toBe(true);
  });

  it("is false when everything is settled (ready, failed, or undeployed)", () => {
    expect(
      deploymentsAreMoving([
        devReady,
        { ...devReady, status: "ReleaseFailed" },
        { ...devReady, status: "Undeployed" },
      ]),
    ).toBe(false);
  });

  it("treats unknown status as moving (still being evaluated)", () => {
    const noStatus: Deployment = {
      componentName: "catalog-api",
      environment: "development",
    };
    expect(deploymentsAreMoving([noStatus])).toBe(true);
  });

  it("is false for no deployments", () => {
    expect(deploymentsAreMoving([])).toBe(false);
    expect(deploymentsAreMoving(undefined)).toBe(false);
  });
});
