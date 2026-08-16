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
import { tryDslToPrototype, validateWireframeSyntax } from "../src/index.js";

const TWO_FLOWS = `screen Login "Sign in"
  button "Sign in" primary -> AdminQueue
screen AdminQueue "Admin: approval queue"
  button "Open" -> AuditDetail
screen AuditDetail "Admin: audit detail"
screen Orders "Customer: my orders"

flow "Admin path"
  Login
  AdminQueue
  AuditDetail

flow "Customer path"
  Login
  Orders
`;

function model(dsl: string) {
  const res = tryDslToPrototype(dsl);
  assert.ok(res.ok, `expected ok, got ${!res.ok ? res.error : ""}`);
  return res.model;
}

test("a valid DSL with named flows passes the write gate", () => {
  assert.deepEqual(validateWireframeSyntax(TWO_FLOWS), []);
});

test("a flow naming a screen that does not exist is rejected with its line number", () => {
  const errs = validateWireframeSyntax(`screen Login "Sign in"

flow "Admin path"
  Login
  Typo
`);
  assert.equal(errs.length, 1);
  assert.match(errs[0]!, /^line 5: /);
  assert.match(errs[0]!, /unknown screen "Typo"/);
});

test("a flow may reference a screen declared later in the file", () => {
  assert.deepEqual(
    validateWireframeSyntax(`flow "Admin path"
  Login
screen Login "Sign in"
`),
    [],
  );
});

test("declaring the same flow name twice is rejected", () => {
  const errs = validateWireframeSyntax(`screen Login "Sign in"
screen Orders "Orders"

flow "Admin path"
  Login

flow "Admin path"
  Orders
`);
  assert.equal(errs.length, 1);
  assert.match(errs[0]!, /^line 7: /);
  assert.match(errs[0]!, /duplicate flow "Admin path"/);
});

test("a screen in no flow is not an error", () => {
  assert.deepEqual(
    validateWireframeSyntax(`screen Login "Sign in"
screen Stranded "Nobody lists me"

flow "Admin path"
  Login
`),
    [],
  );
});

test("the legacy unnamed flow block still parses and still reports nothing", () => {
  assert.deepEqual(
    validateWireframeSyntax(`screen Login "Sign in"
screen Dashboard "Home"

flow
  Login -> Dashboard
`),
    [],
  );
});
