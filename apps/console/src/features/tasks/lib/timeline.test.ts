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
import { formatLine, formatOutcome, timelineEventKey } from "./timeline";

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
  it("a failed shell call names its exit code, the honest per-step signal", () => {
    const { text, tone } = formatLine(
      line({ kind: "tool_result", tool: "Bash", ok: false, durationMs: 1200, exitCode: 1, summary: "error: compilation contains errors", seq: 11 }),
    );
    // Under the slow threshold, so no duration — the failure is the point.
    expect(text).toBe("✗ Bash exit 1 · error: compilation contains errors");
    expect(tone).toBe("error.light");
  });

  it("a failed non-shell call says only what is known — never a fabricated code", () => {
    // Tools that are not a shell report a `<tool_use_error>` and no exit code.
    const { text } = formatLine(
      line({ kind: "tool_result", tool: "Read", ok: false, summary: "File does not exist", seq: 11 }),
    );
    expect(text).toBe("✗ Read failed · File does not exist");
  });

  it("a slow successful call reports how long it took", () => {
    expect(formatLine(line({ kind: "tool_result", tool: "Bash", ok: true, durationMs: 42_000, seq: 12 })).text)
      .toBe("↳ Bash 42.0s");
    expect(formatLine(line({ kind: "tool_result", tool: "Bash", ok: true, durationMs: 185_000, seq: 13 })).text)
      .toBe("↳ Bash 3m5s");
  });

  it("an outcome cell carries what the action row did not, and nothing when that is nothing", () => {
    // This is the form the console actually renders: the action keeps its row and
    // the outcome trails on it. A fast success adds nothing, by rule.
    expect(formatOutcome(line({ kind: "tool_result", tool: "Read", ok: true, durationMs: 120, seq: 16 })).text).toBe("");
    expect(formatOutcome(line({ kind: "tool_result", tool: "Bash", ok: true, durationMs: 10_600, seq: 17 })).text)
      .toBe("10.6s");
    const failed = formatOutcome(
      line({ kind: "tool_result", tool: "Bash", ok: false, exitCode: 2, summary: "ls: cannot access", durationMs: 25_100, seq: 18 }),
    );
    expect(failed.text).toBe("exit 2 · ls: cannot access · 25.1s");
    expect(failed.tone).toBe("error.light");
    // No outcome at all (the call is still in flight) is not a failure.
    expect(formatOutcome(undefined).text).toBe("");
  });

  it("a subagent's narration is header material, never a row", () => {
    expect(formatLine(line({ kind: "activity", summary: "Writing todo-api/service.bal", seq: 19 })).text).toBe("");
  });

  it("a fast successful call renders nothing — a tick per read would bury the failures", () => {
    expect(formatLine(line({ kind: "tool_result", tool: "Read", ok: true, durationMs: 120, seq: 14 })).text).toBe("");
    // Even a slow FAILURE always renders, whatever the duration.
    expect(formatLine(line({ kind: "tool_result", tool: "Read", ok: false, durationMs: 90, seq: 15 })).text)
      .toMatch(/failed/);
  });
});
