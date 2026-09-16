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

import { describe, expect, it, vi } from "vitest";

// URL semantics only — the pages are stubbed out (see builds-routes.test.ts).
vi.mock("../features/projects/components/DeploymentTryOutPage", () => ({
  DeploymentTryOutPage: () => null,
}));
vi.mock("../features/projects/components/DeploymentVersionPage", () => ({
  DeploymentVersionPage: () => null,
}));

import { Route as environmentIndexRoute } from "./projects.$projectName.deployments.$environment.index";
import { Route as tryOutRoute } from "./projects.$projectName.deployments.$environment.try-out";
import { Route as versionRoute } from "./projects.$projectName.deployments.$environment.$version";

function redirectFrom(
  fn: ((ctx: never) => unknown) | undefined,
  ctx: unknown,
): Record<string, unknown> | null {
  try {
    (fn as (c: unknown) => unknown)?.(ctx);
    return null;
  } catch (thrown) {
    const options = (thrown as { options?: Record<string, unknown> }).options;
    if (!options) throw thrown;
    return options;
  }
}

/**
 * The routing half of #779: `/deployments/$environment` was the environment's
 * page and is now the way into its Try Out page, and a version has its own
 * page under it. The bare URL is in links, bookmarks and the flow's "Try it
 * now" of every build before this, so it must keep resolving.
 */
describe("deployment routes (#779)", () => {
  it("sends the bare environment URL to Try Out, replacing the history entry", () => {
    const options = redirectFrom(environmentIndexRoute.options.beforeLoad, {
      params: { projectName: "acme", environment: "development" },
    });
    expect(options).toMatchObject({
      to: "/projects/$projectName/deployments/$environment/try-out",
      params: { projectName: "acme", environment: "development" },
      replace: true,
    });
  });

  it("mounts Try Out and the version page as their own routes, with no redirect of their own", () => {
    expect(tryOutRoute.options.component).toBeDefined();
    expect(tryOutRoute.options.beforeLoad).toBeUndefined();
    expect(versionRoute.options.component).toBeDefined();
    expect(versionRoute.options.beforeLoad).toBeUndefined();
  });
});
