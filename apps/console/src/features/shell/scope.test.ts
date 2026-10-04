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
import { cardOfRoute, chatTopic, pageOfCard, shellScope } from "./scope";

describe("shellScope", () => {
  const inProject = (routeId: string, search?: { file?: unknown }) =>
    shellScope({ routeId, params: { projectName: "acme-expenses" }, ...(search ? { search } : {}) });

  it("puts the Dashboard, the Projects grid and New project at org level", () => {
    expect(shellScope({ routeId: "/", params: {} })).toEqual({ kind: "org", page: "dashboard" });
    expect(shellScope({ routeId: "/projects/", params: {} })).toEqual({ kind: "org", page: "projects" });
    expect(shellScope({ routeId: "/projects/new", params: {} })).toEqual({
      kind: "org",
      page: "new",
    });
  });

  it("reads each project Page with no card open", () => {
    expect(inProject("/projects/$projectName/_overview/")).toEqual({
      kind: "project",
      projectName: "acme-expenses",
      page: "overview",
      card: null,
      specFile: null,
    });
    expect(inProject("/projects/$projectName/deploy")).toMatchObject({ page: "deploy", card: null });
  });

  it("reads each card route as its card over the Page that lists it", () => {
    const routes = [
      ["/projects/$projectName/_overview/spec", "spec", "overview"],
      ["/projects/$projectName/_overview/design", "design", "overview"],
      ["/projects/$projectName/_overview/builds/", "builds", "overview"],
      ["/projects/$projectName/_overview/builds/$version", "builds", "overview"],
      ["/projects/$projectName/deploy/$env/configure", "configure", "deploy"],
    ] as const;
    for (const [routeId, card, page] of routes) {
      expect(inProject(routeId)).toEqual({ kind: "project", projectName: "acme-expenses", page, card, specFile: null });
    }
  });

  it("reads an address the project does not have as its overview", () => {
    expect(inProject("/projects/$projectName")).toMatchObject({ page: "overview", card: null });
  });

  it("reads the spec card's open file from its search, and only on the spec card", () => {
    expect(inProject("/projects/$projectName/_overview/spec", { file: "F2" })).toMatchObject({ card: "spec", specFile: "F2" });
    expect(inProject("/projects/$projectName/_overview/spec", {})).toMatchObject({ card: "spec", specFile: null });
    expect(inProject("/projects/$projectName/_overview/design", { file: "F2" })).toMatchObject({
      card: "design",
      specFile: null,
    });
  });

  it("treats any other route as org level with no page of its own", () => {
    expect(shellScope({ routeId: "/callback", params: {} })).toEqual({
      kind: "org",
      page: "other",
    });
  });
});

describe("cards and the Pages they are over", () => {
  it("knows which routes draw a card", () => {
    expect(cardOfRoute("/projects/$projectName/deploy/$env/configure")).toBe("configure");
    expect(cardOfRoute("/projects/$projectName/_overview/builds/$version")).toBe("builds");
    expect(cardOfRoute("/projects/$projectName/_overview/")).toBeNull();
    expect(cardOfRoute("/projects/$projectName/deploy")).toBeNull();
  });

  it("closes each card back to the Page it opened over", () => {
    expect(pageOfCard("spec")).toBe("overview");
    expect(pageOfCard("design")).toBe("overview");
    expect(pageOfCard("builds")).toBe("overview");
    expect(pageOfCard("configure")).toBe("deploy");
  });
});

describe("chatTopic", () => {
  const product = { topic: "the whole product", note: null };

  it("talks about the design review on the design card", () => {
    expect(chatTopic("design", null)).toEqual({ topic: "the design review", note: null });
  });

  it("narrows to the feature open in the spec card, and says where other changes go", () => {
    expect(chatTopic("spec", "Approvals")).toEqual({
      topic: "Approvals",
      note: "A change that reaches other features is made there too.",
    });
  });

  it("talks about the whole product on the product page, product-wide, the overview and builds", () => {
    expect(chatTopic("spec", null)).toEqual(product);
    expect(chatTopic(null, null)).toEqual(product);
    expect(chatTopic("builds", null)).toEqual(product);
  });

  it("talks about the whole product on an environment's Configure card, which no agent can change yet", () => {
    expect(chatTopic("configure", null)).toEqual(product);
  });
});
