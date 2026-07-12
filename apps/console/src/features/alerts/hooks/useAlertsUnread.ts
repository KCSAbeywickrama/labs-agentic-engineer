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

import { useCallback, useMemo, useState } from "react";
import type { components } from "../../../generated/aep-api";

type RcaAgentReport = components["schemas"]["RcaAgentReport"];

// Client-side only — no server read-state, per #154's grilling decision
// (no triage actions / mutations). Opening the bell dropdown clears the
// whole badge by moving this watermark to the newest report seen.
const SEEN_UNTIL_KEY = "aep:alerts:seenUntil";

function readSeenUntil(): string {
  try {
    return localStorage.getItem(SEEN_UNTIL_KEY) ?? "";
  } catch {
    return "";
  }
}

// Compare timestamps by parsed epoch millis, not lexicographically: RFC3339
// strings with differing offsets ("Z" vs "+00:00") or fractional precision
// don't sort correctly as plain strings. NaN (absent/unparseable createdAt)
// is treated as "no timestamp" — never unread, never advances the watermark.
function toMillis(ts: string | undefined | null): number {
  if (!ts) return NaN;
  return Date.parse(ts);
}

// Pure logic, exported for unit testing (see useAlertsUnread.test.ts) —
// reports without a createdAt are treated as already-seen (never counted
// unread, never advance the watermark), since there's no timestamp to
// compare against seenUntil.

export function countUnread(reports: RcaAgentReport[], seenUntil: string): number {
  const seen = toMillis(seenUntil);
  return reports.filter((r) => {
    const t = toMillis(r.createdAt);
    if (Number.isNaN(t)) return false;
    return Number.isNaN(seen) ? true : t > seen;
  }).length;
}

export function nextSeenUntil(reports: RcaAgentReport[], seenUntil: string): string {
  let maxStr = seenUntil;
  let maxMs = toMillis(seenUntil);
  for (const r of reports) {
    const t = toMillis(r.createdAt);
    if (!Number.isNaN(t) && (Number.isNaN(maxMs) || t > maxMs)) {
      maxMs = t;
      maxStr = r.createdAt ?? maxStr;
    }
  }
  return maxStr;
}

export function useAlertsUnread(reports: RcaAgentReport[]) {
  const [seenUntil, setSeenUntil] = useState<string>(readSeenUntil);

  const unreadCount = useMemo(() => countUnread(reports, seenUntil), [reports, seenUntil]);

  const markAllSeen = useCallback(() => {
    const newest = nextSeenUntil(reports, seenUntil);
    if (newest && newest !== seenUntil) {
      try {
        localStorage.setItem(SEEN_UNTIL_KEY, newest);
      } catch {
        // Storage unavailable (e.g. private browsing) — badge just won't persist across reloads.
      }
      setSeenUntil(newest);
    }
  }, [reports, seenUntil]);

  return { unreadCount, markAllSeen };
}
