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

// URL semantics only — the pages drag half the app behind them.
vi.mock("../features/validation/components/ValidationLedger", () => ({
  ValidationLedger: () => null,
}));
vi.mock("../features/validation/components/ValidationMilestonePage", () => ({
  ValidationMilestonePage: () => null,
}));

import { Route as validationIndexRoute } from "./projects.$projectName.validation.index";
import { Route as validationTagRoute } from "./projects.$projectName.validation.$tag";

/**
 * Validation gained a level: it was one page pinned to the newest milestone,
 * and it is now a ledger with a page per version.
 *
 * The contract worth pinning is what happens to the OLD links. Every
 * `/validation` and `/validation?view=logs` in a bookmark, a comment or a
 * notification still resolves — to the ledger, which answers "show me
 * validation" better than the newest version alone ever did.
 */
describe("/projects/$projectName/validation — the ledger", () => {
  // `?view=logs` toggled the old page between the report and the log. Both now
  // sit on the version page, so the param has nothing left to select and is
  // dropped rather than carried as dead state in every shared URL.
  it("drops the retired view param", () => {
    const parse = validationIndexRoute.options.validateSearch as
      | ((s: Record<string, unknown>) => unknown)
      | undefined;
    expect(parse?.({ view: "logs" })).toEqual({});
    expect(parse?.({ view: "report", other: 1 })).toEqual({});
  });

  // Old links land on the ledger rather than being redirected: a list of every
  // version answers "show me validation" better than the newest one did, so
  // there is nothing for a beforeLoad to do.
  it("redirects nothing", () => {
    expect(validationIndexRoute.options.beforeLoad).toBeUndefined();
  });
});

describe("/projects/$projectName/validation/$tag — one version", () => {
  // Unlike /builds/$tag — where a numeric segment is a legacy task link — this
  // segment has never been anything but a version tag.
  it("needs no legacy redirect", () => {
    expect(validationTagRoute.options.beforeLoad).toBeUndefined();
  });
});
