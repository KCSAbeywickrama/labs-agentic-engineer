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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "../../../api/client";
import { apiErrorMessage } from "../../../api/errors";
import { fetchSpecFileContent } from "../../spec/api/queries";
import { validationKeys } from "./keys";

// The two files the Validation page joins, read through the Files API
// (report.json is reachable through the read-only allow-list on read-file).
//
// The report's path is also carried on the RUN (RunValidation.reportPath), which
// is authoritative — the runner writes the path it actually committed. This
// constant is the fallback for a run that recorded no path.
export const REPORT_PATH = "tests/acceptance/report.json";

// Fetch one validation artifact's content. Reuses the spec Files reader
// (path-agnostic; `sha` only feeds its cache key, never the request — we key our
// own query instead). Retry is off: a 404 (no report for this run) is a
// deterministic answer the page renders, not a transient failure worth hammering.
//
// `ref` pins the read to a commit and joins the cache key. The report is the reason
// it exists: every run overwrites the same path, so reading the branch tip hands a
// historical run the newest run's results — and a run whose agent committed no
// report would silently inherit its predecessor's. Pinned to the run's own
// validation-cycle merge commit the content is immutable, which is also why it can
// be cached indefinitely.
function useValidationFile(
  projectName: string,
  path: string,
  version: string,
  enabled: boolean,
  ref?: string,
) {
  return useQuery({
    queryKey: validationKeys.file(projectName, path, ref || version),
    enabled,
    retry: false,
    // A pinned read can never change; an unpinned one follows the branch.
    staleTime: ref ? Infinity : 30_000,
    queryFn: () =>
      fetchSpecFileContent(projectName, { path, sha: "", ...(ref ? { ref } : {}) }),
  });
}

/**
 * The runner's run report, at the path the run recorded (or the default), read at
 * the validation cycle's merge commit.
 *
 * Pass `mergeSha` from the run's own validation cycle. Without it the read follows
 * the branch tip, which for a report every run overwrites means an older run shows
 * the newest run's results.
 */
export function useValidationReport(
  projectName: string,
  version: string,
  enabled: boolean,
  reportPath?: string,
  mergeSha?: string,
) {
  return useValidationFile(
    projectName,
    reportPath || REPORT_PATH,
    version,
    enabled,
    mergeSha,
  );
}

// ── The validation read model ────────────────────────────────────────────────
//
// Three reads that replaced the page's own derivation. The selections they
// encode — which run answers for a version, which cycles are attempts, which
// commit an attempt's evidence lives at — are the platform's, and the console
// used to restate them; the surface that did read a newer non-validating run as
// the version's answer and hid a real verdict (#423).

// Same price as the run story: DB-only rows on the server, so a 5s poll while
// something is moving is affordable.
const VALIDATION_POLL_MS = 5_000;

/** Is anything on this row still moving — the ledger's poll-stop. */
function ledgerIsLive(rows: readonly { state: string }[]): boolean {
  return rows.some((r) => r.state === "running" || r.state === "awaiting-fix" || r.state === "none");
}

/**
 * The validation ledger, newest version first — one row per version the
 * platform has worked, including ones never validated.
 */
export function useValidations(projectName: string) {
  return useQuery({
    queryKey: validationKeys.list(projectName),
    queryFn: async () => {
      const { data, error } = await client.GET("/projects/{projectName}/validations", {
        params: { path: { projectName } },
      });
      if (error || data === undefined) {
        throw new Error(apiErrorMessage(error, "Failed to load validations"));
      }
      return data.validations ?? [];
    },
    refetchInterval: (query) => {
      const rows = query.state.data;
      if (!rows) return VALIDATION_POLL_MS; // no data yet (or errored) — keep trying
      return ledgerIsLive(rows) ? VALIDATION_POLL_MS : false;
    },
  });
}

/**
 * One version's validation history: the runs that attempted it, newest first,
 * each carrying its validation cycles only.
 *
 * Polls while a run is live on the milestone. `live` is the server's answer
 * rather than something derived from the rows, and it is the same field the
 * trigger is gated on — so the page cannot offer an action its own copy has
 * just said is unnecessary.
 */
export function useValidation(projectName: string, tag: string | undefined) {
  return useQuery({
    queryKey: validationKeys.detail(projectName, tag ?? ""),
    enabled: Boolean(tag),
    queryFn: async () => {
      const { data, error } = await client.GET("/projects/{projectName}/validations/{tag}", {
        params: { path: { projectName, tag: tag ?? "" } },
      });
      if (error || data === undefined) {
        throw new Error(apiErrorMessage(error, "Failed to load this version's validation"));
      }
      return data;
    },
    refetchInterval: (query) => (query.state.data?.live ? VALIDATION_POLL_MS : false),
  });
}

/**
 * One attempt's report and the acceptance criteria it was judged against, both
 * at the same commit.
 *
 * `staleTime: Infinity` for a settled attempt: its evidence is pinned to a
 * merge commit and cannot change, which is what makes re-opening an older
 * attempt free. A running attempt is read at HEAD, so it follows the branch.
 *
 * `enabled` is the caller's: the newest attempt is fetched by the page because
 * the verdict card needs its counts, and older attempts only when their section
 * is opened.
 */
export function useValidationSnapshot(
  projectName: string,
  tag: string,
  cycleId: string,
  enabled: boolean,
  settled: boolean,
) {
  return useQuery({
    queryKey: validationKeys.snapshot(projectName, tag, cycleId),
    enabled: enabled && Boolean(tag) && Boolean(cycleId),
    // A missing snapshot is a deterministic answer the page renders in words,
    // not a transient failure worth hammering.
    retry: false,
    staleTime: settled ? Infinity : 30_000,
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/projects/{projectName}/validations/{tag}/cycles/{cycleId}/report",
        { params: { path: { projectName, tag, cycleId } } },
      );
      if (error || data === undefined) {
        throw new Error(apiErrorMessage(error, "Failed to load this attempt's report"));
      }
      return data;
    },
  });
}

/**
 * Ask a version's acceptance criteria again, against the system already
 * deployed.
 *
 * The console gates this on ONE condition — a run already live on the milestone
 * — and lets the server refuse the rest: open work on the version, and a
 * version with no criteria. Those are the platform's rules, and its messages
 * are better than a disabled menu item with no explanation.
 *
 * 202 means the run was started, not that it has a verdict, so success
 * invalidates and lets the poll take over.
 */
export function useStartValidation(projectName: string, tag: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await client.POST(
        "/projects/{projectName}/builds/{tag}/revalidate",
        { params: { path: { projectName, tag } }, body: {} },
      );
      if (error) {
        throw new Error(apiErrorMessage(error, "Failed to start validation"));
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: validationKeys.detail(projectName, tag) }),
        queryClient.invalidateQueries({ queryKey: validationKeys.list(projectName) }),
      ]);
    },
  });
}
