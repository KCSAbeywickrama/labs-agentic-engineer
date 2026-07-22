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

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// The reporter is a CommonJS Playwright reporter living beside the aep-validation
// skill (baked into the runner image next to generate-report.mjs). Require it to
// exercise the pure title/status helpers it exposes.
const require = createRequire(import.meta.url);
const reporter = require("../../../plugin/skills/aep-validation/references/criterion-reporter.cjs") as {
  acIdFromTitle: (t: unknown) => string;
  mapStatus: (s: unknown) => string;
};

test("criterion-reporter: acIdFromTitle extracts the AC id prefix", () => {
  assert.equal(reporter.acIdFromTitle("AC-001-a: text box is visible"), "AC-001-a");
  assert.equal(reporter.acIdFromTitle("AC-012-c: something"), "AC-012-c");
});

test("criterion-reporter: acIdFromTitle returns '' for a non-criterion title", () => {
  assert.equal(reporter.acIdFromTitle("smoke test"), "");
  assert.equal(reporter.acIdFromTitle(""), "");
  assert.equal(reporter.acIdFromTitle(undefined), "");
  // Must be a prefix, not anywhere in the string.
  assert.equal(reporter.acIdFromTitle("see AC-001-a: nested"), "");
});

test("criterion-reporter: mapStatus maps Playwright statuses to the criterion vocabulary", () => {
  assert.equal(reporter.mapStatus("passed"), "passed");
  assert.equal(reporter.mapStatus("skipped"), "skipped");
  assert.equal(reporter.mapStatus("failed"), "failed");
  assert.equal(reporter.mapStatus("timedOut"), "failed");
  assert.equal(reporter.mapStatus("interrupted"), "failed");
  assert.equal(reporter.mapStatus(undefined), "failed");
});
