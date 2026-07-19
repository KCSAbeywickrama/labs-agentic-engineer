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
import { buildDependencyResolutionMessage } from "./dependencyResolutionMessage";
import type { components } from "../../../generated/aep-api";

type Dependency = components["schemas"]["Dependency"];

const ambiguousDep: Dependency = {
  kind: "external",
  name: "email-provider",
  description: "Transactional email for signup + reset flows.",
  status: "ambiguous",
  reason: "2 candidates available",
  candidates: [
    {
      name: "sendgrid-rest",
      style: "rest-api",
      description: "SendGrid v3 Web API",
      docsUrl: "https://docs.sendgrid.com/api-reference",
      specUrl: "https://example.com/sendgrid.openapi.json",
    },
    {
      name: "resend-sdk",
      style: "sdk",
      description: "Resend Node SDK",
      docsUrl: "https://resend.com/docs",
      package: "npm:resend@^4.0.0",
    },
  ],
};

describe("buildDependencyResolutionMessage", () => {
  it("embeds the dependency's current entry as JSON, byte-for-byte", () => {
    const msg = buildDependencyResolutionMessage("checkout-api", ambiguousDep);
    expect(msg).toContain(JSON.stringify(ambiguousDep, null, 2));
  });

  it("surfaces the computed status and reason", () => {
    const msg = buildDependencyResolutionMessage("checkout-api", ambiguousDep);
    expect(msg).toMatch(/ambiguous/);
    expect(msg).toContain("2 candidates available");
  });

  it("degrades gracefully when status/reason aren't present yet", () => {
    const rest: Dependency = { ...ambiguousDep };
    delete rest.status;
    delete rest.reason;
    const msg = buildDependencyResolutionMessage("checkout-api", rest);
    expect(msg).not.toContain("undefined");
  });

  it("includes the resolution playbook: skill, pin/pick, sources, edit-only-this, ask-when-unsure", () => {
    const msg = buildDependencyResolutionMessage("checkout-api", ambiguousDep);
    // the high-level-architecture skill is the resolution authority
    expect(msg).toContain("high-level-architecture");
    // pick/pin one option: style+package (sdk) OR fetch/validate + specPath (rest)
    expect(msg).toContain("style");
    expect(msg).toContain("package");
    expect(msg).toContain("specPath");
    // fold the chosen candidate's docsUrl into sources
    expect(msg).toContain("docsUrl");
    expect(msg).toContain("sources");
    // derive config keys
    expect(msg).toContain("config");
    // where a freshly-collected spec must be stored
    expect(msg).toContain(
      "specs/design/components/checkout-api/dependencies/email-provider.openapi.yaml",
    );
    // edit ONLY this dependency's entry
    expect(msg).toMatch(/only this dependency/i);
    // ask the user when unsure
    expect(msg).toMatch(/ask the user/i);
  });

  it("names the target dependency and component in the instruction", () => {
    const msg = buildDependencyResolutionMessage("checkout-api", ambiguousDep);
    expect(msg).toContain("email-provider");
    expect(msg).toContain("checkout-api");
  });

  it("derives the spec-storage path from the component + dependency names given", () => {
    const otherDep: Dependency = { kind: "external", name: "github" };
    const msg = buildDependencyResolutionMessage("issue-sync", otherDep);
    expect(msg).toContain(
      "specs/design/components/issue-sync/dependencies/github.openapi.yaml",
    );
  });
});
