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

// The store in `skills/agent-building/SKILL.md` is COPIED VERBATIM into every
// generated agent, so that markdown is production source that no compiler,
// linter, or type-checker ever sees. `agent-chat-contract.test.ts` does not
// cover it either: that file defines its own store, so the skill's SQL could
// lose its user scope entirely and every test would stay green.
//
// This gate is deliberately narrow. It does not check that the SQL is good;
// it checks that the specific lines the skill itself calls "the security
// boundary" are still present. A reviewer editing that section has to see
// this fail and decide, rather than delete a fence by accident.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const SKILL = readFileSync(
  fileURLToPath(new URL("../../../skills/agent-building/SKILL.md", import.meta.url)),
  "utf8",
);

describe("agent-building SKILL.md — prescribed store invariants", () => {
  it("scopes the conversation read by user, not by id alone", () => {
    assert.match(
      SKILL,
      /SELECT messages FROM conversations WHERE id = \$1 AND user_id = \$2/,
      "the SELECT lost its `AND user_id = $2` — any caller holding an id could read another user's conversation",
    );
  });

  it("scopes the conversation write by user, so an upsert cannot cross users", () => {
    assert.match(
      SKILL,
      /WHERE conversations\.user_id = \$2/,
      "the upsert lost its user fence — a caller could overwrite another user's conversation by supplying their id",
    );
  });

  it("guards the id before it reaches Postgres' uuid cast", () => {
    assert.match(
      SKILL,
      /UUID_RE/,
      "the malformed-id guard is gone — a non-uuid id would 500 with a Postgres cast error instead of reading as not-found",
    );
  });

  it("never tells the agent to adopt a caller-chosen conversation id", () => {
    assert.doesNotMatch(
      SKILL,
      /Absent or unknown on\s+the way in means "new conversation"/,
      'the prose that told the agent to treat an UNKNOWN id as a new conversation is back — it invites a caller to pick another user\'s id',
    );
  });

  it("prescribes node:http, not an Express response API", () => {
    assert.doesNotMatch(
      SKILL,
      /res\.status\(\d+\)\.end\(\)/,
      "an Express call is prescribed in a file that mandates node:http — generated agents would not compile",
    );
  });
});
