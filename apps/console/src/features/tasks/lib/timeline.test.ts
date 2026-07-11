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
import type { components } from "../../../generated/aep-api";
import { formatLine, timelineEventKey } from "./timeline";

type TimelineEvent = components["schemas"]["TimelineEvent"];

function line(over: Partial<TimelineEvent>): TimelineEvent {
  return {
    schemaVersion: 1,
    ts: "2026-07-11T07:11:34.763983714Z",
    seq: 0,
    kind: "log",
    executionId: "exec-1",
    executionKind: "coding",
    ...over,
  };
}

describe("timelineEventKey", () => {
  it("uses executionId+seq for structured runner events", () => {
    expect(timelineEventKey(line({ seq: 7, kind: "phase" }))).toBe("exec-1:7");
  });

  it("seq-0 wrapped stdout lines get distinct keys (ts+text fallback)", () => {
    // The BFF wraps plain runner stdout as log events without stamping seq
    // (agent_progress.go), so every wrapped line arrives with seq 0 — a
    // shared executionId:0 key would swallow all but the first.
    const a = line({ summary: "[skills-resolve] nothing to materialise" });
    const b = line({
      summary: "[oneshot] no per-task skills",
      ts: "2026-07-11T07:11:34.764081694Z",
    });
    expect(timelineEventKey(a)).not.toBe(timelineEventKey(b));
    // …and the key is stable across reconnect replays of the same line.
    expect(timelineEventKey(a)).toBe(timelineEventKey(line({ ...a })));
  });
});

describe("formatLine", () => {
  it("Bash tool_use renders the bare command — `$` already says shell", () => {
    const { text } = formatLine(
      line({ kind: "tool_use", tool: "Bash", summary: "npm run build", seq: 3 }),
    );
    expect(text).toBe("$ npm run build");
  });

  it("file-tool tool_use keeps the tool as the verb", () => {
    const { text } = formatLine(
      line({ kind: "tool_use", tool: "Write", summary: "src/App.tsx", seq: 5 }),
    );
    expect(text).toBe("$ Write src/App.tsx");
  });

  it("tool_use without a summary still names the tool", () => {
    const { text } = formatLine(line({ kind: "tool_use", tool: "Read", seq: 4 }));
    expect(text).toBe("$ Read");
  });

  it("log lines render message or summary", () => {
    expect(formatLine(line({ summary: "[oneshot] hello" })).text).toBe(
      "[oneshot] hello",
    );
  });

  it("gh_action renders its command payload", () => {
    const { text } = formatLine(
      line({ kind: "gh_action", command: "gh pr create --fill", seq: 9 }),
    );
    expect(text).toBe("⚙ gh pr create --fill");
  });
});
