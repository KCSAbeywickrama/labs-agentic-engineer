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

/**
 * Deterministic full-route SSE integration test — boots the real Express app
 * with a MOCK model (no tokens) and drives it over `fetch` against an ephemeral
 * port. Exercises the always-on M2M gate (shared-secret path) and the per-turn
 * `X-Anthropic-Key`. This is the deterministic end-to-end gate (the real-model
 * eval is the report, Phase 8).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { LanguageModel } from "ai";
import { SignJWT } from "jose";
import { createApp } from "./server.js";
import { listen0 } from "./shared/listen.js";
import { InMemoryConversationStore } from "./store/memory-store.js";
import { SEED_FILES } from "./agents/main/prompt.js";
import { mockModel } from "./shared/mock-model.js";

const OPENAPI = "specs/design/components/hello-api/openapi.yaml";
const AUD = "agents-service";
const SECRET = "test-secret";
const KEY = "sk-ant-test"; // the mock buildModel ignores it; presence is what the route checks

async function boot(model: LanguageModel, bodyLimit?: string) {
  const store = new InMemoryConversationStore();
  const app = createApp({
    store,
    buildModel: () => model,
    auth: { audience: AUD, secret: SECRET },
    ...(bodyLimit ? { bodyLimit } : {}),
  });
  const { baseUrl, close } = await listen0(app.listen(0));
  return { store, baseUrl, close };
}

/** Mint a shared-secret HS256 M2M token (defaults valid; override to exercise 401s). */
async function mintToken(opts: { audience?: string; secret?: string; expired?: boolean } = {}): Promise<string> {
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(opts.audience ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.expired ? Math.floor(Date.now() / 1000) - 60 : "1h");
  return jwt.sign(new TextEncoder().encode(opts.secret ?? SECRET));
}

/** A turn POST carrying the M2M token and (unless omitted) the Anthropic key. */
function turnPost(body: unknown, opts: { token: string; key?: string | null }) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    Authorization: `Bearer ${opts.token}`,
  };
  if (opts.key !== null) headers["X-Anthropic-Key"] = opts.key ?? KEY;
  return { method: "POST", headers, body: JSON.stringify(body) };
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test("GET /healthz is 200 and unauthenticated", async () => {
  const { baseUrl, close } = await boot(mockModel([{ kind: "text", text: "ok" }]));
  try {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  } finally {
    await close();
  }
});

test("POST streams raw StreamPart frames + [DONE], runs execute, persists", async () => {
  const { store, baseUrl, close } = await boot(
    mockModel([
      {
        kind: "toolCall",
        toolCallId: "c1",
        toolName: "editFile",
        input: { path: OPENAPI, oldString: 'example: "Hello, World!"', newString: 'example: "Hi there!"' },
        text: "Updating.",
      },
      { kind: "text", text: "Done." },
    ]),
  );
  try {
    const token = await mintToken();
    const res = await fetch(`${baseUrl}/conversations/conv1/turns`, turnPost({ instruction: "rename", files: SEED_FILES }, { token }));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);

    const text = await res.text();
    assert.match(text, /"type":"tool-call"/);
    assert.match(text, /"type":"tool-result"/);
    assert.match(text, /data: \[DONE\]/);

    const stored = await store.get("conv1");
    assert.ok(stored);
    assert.equal(stored.status, "done");
    assert.ok(stored.messages.some((m) => m.role === "tool"));
  } finally {
    await close();
  }
});

test("GET rehydrates the aggregate; 404 for an unknown id", async () => {
  const { baseUrl, close } = await boot(mockModel([{ kind: "text", text: "ok" }]));
  try {
    const token = await mintToken();
    await (await fetch(`${baseUrl}/conversations/c/turns`, turnPost({ instruction: "x", files: SEED_FILES }, { token }))).text();

    const got = await fetch(`${baseUrl}/conversations/c`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(got.status, 200);
    const body = (await got.json()) as { status: string; messages: unknown[] };
    assert.equal(body.status, "done");
    assert.ok(Array.isArray(body.messages) && body.messages.length >= 2);

    const missing = await fetch(`${baseUrl}/conversations/does-not-exist`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(missing.status, 404);
  } finally {
    await close();
  }
});

test("401 when the M2M token is missing, malformed, wrong-secret, or wrong-aud", async () => {
  const { baseUrl, close } = await boot(mockModel([{ kind: "text", text: "ok" }]));
  try {
    const url = `${baseUrl}/conversations/c/turns`;
    const body = JSON.stringify({ instruction: "x", files: SEED_FILES });
    const post = (headers: Record<string, string>) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

    const noAuth = await post({ "X-Anthropic-Key": KEY });
    assert.equal(noAuth.status, 401);
    assert.match(noAuth.headers.get("www-authenticate") ?? "", /Bearer realm="agents-service"/);

    const malformed = await post({ Authorization: "NotBearer xyz", "X-Anthropic-Key": KEY });
    assert.equal(malformed.status, 401);

    const wrongSecret = await mintToken({ secret: "not-the-secret" });
    assert.equal((await post({ Authorization: `Bearer ${wrongSecret}`, "X-Anthropic-Key": KEY })).status, 401);

    const wrongAud = await mintToken({ audience: "some-other-service" });
    assert.equal((await post({ Authorization: `Bearer ${wrongAud}`, "X-Anthropic-Key": KEY })).status, 401);

    // GET is gated too.
    assert.equal((await fetch(`${baseUrl}/conversations/c`)).status, 401);
  } finally {
    await close();
  }
});

test("400 when X-Anthropic-Key is missing (authenticated but no key)", async () => {
  const { baseUrl, close } = await boot(mockModel([{ kind: "text", text: "ok" }]));
  try {
    const token = await mintToken();
    const res = await fetch(`${baseUrl}/conversations/c/turns`, turnPost({ instruction: "x", files: SEED_FILES }, { token, key: null }));
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /X-Anthropic-Key/);
  } finally {
    await close();
  }
});

test("400 when instruction or files is missing", async () => {
  const { baseUrl, close } = await boot(mockModel([{ kind: "text", text: "ok" }]));
  try {
    const token = await mintToken();
    const r1 = await fetch(`${baseUrl}/conversations/c/turns`, turnPost({ instruction: "", files: SEED_FILES }, { token }));
    assert.equal(r1.status, 400);
    const r2 = await fetch(`${baseUrl}/conversations/c/turns`, turnPost({ instruction: "x" }, { token }));
    assert.equal(r2.status, 400);
    // non-string file value → clean 400 (not an opaque 500 from FileBundle).
    const r3 = await fetch(`${baseUrl}/conversations/c/turns`, turnPost({ instruction: "x", files: { "a.md": 123 } }, { token }));
    assert.equal(r3.status, 400);
  } finally {
    await close();
  }
});

test("accepts a skills payload; the agent can loadSkill over the route", async () => {
  const { baseUrl, close } = await boot(
    mockModel([
      { kind: "toolCall", toolCallId: "s1", toolName: "loadSkill", input: { name: "component-architecture" } },
      { kind: "text", text: "loaded." },
    ]),
  );
  try {
    const token = await mintToken();
    const res = await fetch(
      `${baseUrl}/conversations/c/turns`,
      turnPost(
        {
          instruction: "use the skill",
          files: SEED_FILES,
          skills: [
            { name: "component-architecture", description: "deriving components", content: "Components live at specs/design/components/<name>/design.md." },
          ],
        },
        { token },
      ),
    );
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /"toolName":"loadSkill"/);
    assert.match(text, /specs\/design\/components/); // the loaded body streamed in the tool-result
  } finally {
    await close();
  }
});

test("400 when the skills payload is malformed", async () => {
  const { baseUrl, close } = await boot(mockModel([{ kind: "text", text: "ok" }]));
  try {
    const token = await mintToken();
    const notArray = await fetch(`${baseUrl}/conversations/c/turns`, turnPost({ instruction: "x", files: SEED_FILES, skills: "nope" }, { token }));
    assert.equal(notArray.status, 400);
    const badItem = await fetch(
      `${baseUrl}/conversations/c/turns`,
      turnPost({ instruction: "x", files: SEED_FILES, skills: [{ name: "a", description: "b" }] }, { token }), // missing content
    );
    assert.equal(badItem.status, 400);
  } finally {
    await close();
  }
});

test("413 when the files snapshot exceeds the body limit", async () => {
  const { baseUrl, close } = await boot(mockModel([{ kind: "text", text: "ok" }]), "1kb");
  try {
    const token = await mintToken();
    const big = "x".repeat(5000);
    const r = await fetch(`${baseUrl}/conversations/c/turns`, turnPost({ instruction: "x", files: { "a.md": big } }, { token }));
    assert.equal(r.status, 413);
  } finally {
    await close();
  }
});

test("409 when a turn is already in flight for the id", async () => {
  // delayMs keeps turn 1 in-flight so turn 2 hits the in-flight guard.
  const { baseUrl, close } = await boot(
    mockModel([{ kind: "text", text: "a" }, { kind: "text", text: "b" }], { delayMs: 80 }),
  );
  try {
    const token = await mintToken();
    const opts = turnPost({ instruction: "x", files: SEED_FILES }, { token });
    const p1 = fetch(`${baseUrl}/conversations/c/turns`, opts).then(async (r) => {
      await r.text();
      return r.status;
    });
    await delay(15); // ensure turn 1 acquires the lock first
    const p2 = fetch(`${baseUrl}/conversations/c/turns`, opts).then(async (r) => {
      await r.text();
      return r.status;
    });

    const [s1, s2] = await Promise.all([p1, p2]);
    assert.deepEqual([s1, s2].sort(), [200, 409]);
  } finally {
    await close();
  }
});
