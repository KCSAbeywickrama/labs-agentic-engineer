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
import {
  envHasGitHubToken,
  ghGitCredentialHelper,
  ghPassthroughScript,
} from "./gh_git_auth.js";

test("envHasGitHubToken: true when GITHUB_TOKEN or GH_TOKEN is non-empty", () => {
  assert.equal(envHasGitHubToken({}), false);
  assert.equal(envHasGitHubToken({ GITHUB_TOKEN: "" }), false);
  assert.equal(envHasGitHubToken({ GITHUB_TOKEN: "ghs_x" }), true);
  assert.equal(envHasGitHubToken({ GH_TOKEN: "ghs_x" }), true);
});

test("ghGitCredentialHelper: setup-git equivalent pinned to an absolute binary", () => {
  assert.equal(ghGitCredentialHelper("/usr/bin/gh"), "!/usr/bin/gh auth git-credential");
});

test("ghPassthroughScript: execs the real binary, no platform exchange", () => {
  const body = ghPassthroughScript("/usr/bin/gh");
  assert.match(body, /^#!/);
  assert.match(body, /exec "\/usr\/bin\/gh" "\$@"/);
  assert.match(body, /GITHUB_TOKEN/);
  assert.ok(!body.includes("credhelper.sh"), body);
  assert.ok(!body.includes("credentials/refresh"), body);
});
