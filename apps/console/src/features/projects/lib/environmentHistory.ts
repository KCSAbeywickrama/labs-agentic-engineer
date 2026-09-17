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

// PAST DEPLOYMENTS for one environment (the design, §4.3 / §6 section 4).
//
// The platform records no deployment history. `Deployment` is the CURRENT
// binding and nothing else, so the only environment with a past the console
// can read is the pipeline's ENTRY environment: every completed build
// auto-deploys there, and the version ledger is the record of which ones
// there were. Every other environment gets what runs now and an admission —
// a build reaching the entry environment says nothing whatever about any
// other, and folding the ledger onto Staging would invent a past that never
// happened.

import type { components } from "../../../generated/aep-api";
import type { EnvironmentRow } from "./deploymentLedger";
import type { EnvironmentInfo } from "./environments";

type BuildSummary = components["schemas"]["BuildSummary"];

export interface HistoryRow {
  /** Stable key for the row — a version tag, or the binding when none. */
  key: string;
  /** The version that ran; absent when nothing names it. */
  version?: string;
  /** The milestone its work lived in — the version ledger's, so the entry
   *  environment's rows only. */
  milestoneNumber?: number;
  /** When it started running here. */
  deployedAt?: string;
  /** When it stopped — the moment its successor deployed. Absent on the
   *  running row, which is marked `current` instead. */
  until?: string;
  current: boolean;
}

export interface HistoryView {
  rows: HistoryRow[];
  /** The platform records nothing for this environment beyond what runs now. */
  unrecorded: boolean;
  /** The read the rows come from has not answered — so an empty `rows` here
   *  means "not known yet", never "nothing ran". */
  pending: boolean;
}

/** A build that produced a version the environment actually ran. A failed or
 *  cancelled build never reached it, and an unfinished one has not yet. */
function deployed(build: BuildSummary): boolean {
  return build.status === "completed";
}

/** Newest first — the order the version ledger is read in. */
function newestFirst(a: BuildSummary, b: BuildSummary): number {
  return (b.startedAt ?? "").localeCompare(a.startedAt ?? "");
}

function bound(row: EnvironmentRow | undefined): boolean {
  return row?.cards.some((c) => c.deployment) ?? false;
}

/**
 * What has run on this environment, newest first.
 *
 * `builds` is the version ledger; `undefined` means the read has not answered
 * yet, which is reported as `pending` rather than folded into an empty ledger.
 */
export function historyFor(
  env: EnvironmentInfo,
  row: EnvironmentRow | undefined,
  builds: BuildSummary[] | undefined,
): HistoryView {
  if (env.position !== 0) {
    // Nothing downstream of the entry environment has a recorded past. All it
    // can say is what is bound to it now — and only when something is.
    if (!bound(row) || !row) return { rows: [], unrecorded: true, pending: false };
    return {
      rows: [
        {
          key: row.version ?? `${row.environment}:current`,
          ...(row.version ? { version: row.version } : {}),
          ...(row.deployedAt ? { deployedAt: row.deployedAt } : {}),
          current: true,
        },
      ],
      unrecorded: true,
      pending: false,
    };
  }

  if (!builds) return { rows: [], unrecorded: false, pending: true };

  const rows: HistoryRow[] = [];
  const seen = new Set<string>();
  for (const build of [...builds].filter(deployed).sort(newestFirst)) {
    if (seen.has(build.tag)) continue;
    seen.add(build.tag);
    const current = Boolean(row?.version) && row?.version === build.tag;
    // The live row is dated by its BINDING — the one deploy stamp the
    // platform actually kept. A superseded row has none, so it is dated by
    // the build that produced it: every completed build auto-deploys here,
    // which is the whole reason this environment has a past to list at all.
    const deployedAt = (current ? row?.deployedAt : undefined) ?? build.completedAt ?? undefined;
    rows.push({
      key: build.tag,
      version: build.tag,
      milestoneNumber: build.milestoneNumber,
      ...(deployedAt ? { deployedAt } : {}),
      current,
    });
  }

  // A version the ledger no longer lists still IS what runs here.
  if (row?.version && !seen.has(row.version)) {
    rows.unshift({
      key: row.version,
      version: row.version,
      ...(row.deployedAt ? { deployedAt: row.deployedAt } : {}),
      current: true,
    });
  }

  // Each row ran until its successor — the row above it — deployed.
  for (let i = 1; i < rows.length; i += 1) {
    const closedBy = rows[i - 1]?.deployedAt;
    const self = rows[i];
    if (self && closedBy) self.until = closedBy;
  }

  return { rows, unrecorded: false, pending: false };
}
