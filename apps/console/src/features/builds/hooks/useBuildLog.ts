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

import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../../../api/client";
import { apiErrorCode } from "../../../api/errors";
import type { components } from "../../../generated/aep-api";

// One component build's log, read live through the server's cursor. A finished
// build answers complete on the first read; a running one answers incomplete,
// and each later read starts from the cursor the last one returned. A build the
// platform no longer keeps answers `build_expired`, and says so for good; any
// other failure stops the tail and can be retried from where it stopped. Read
// only while its row is open, so a page of closed logs costs nothing.

type BuildLogEntry = components["schemas"]["BuildLogEntry"];

const TAIL_POLL_MS = 2_000;

export type BuildLogState =
  | { phase: "loading" }
  /** The build is no longer kept, so there is no log to read. */
  | { phase: "expired" }
  /** A read failed; `entries` are the lines read before it. */
  | { phase: "failed"; entries: BuildLogEntry[] }
  /** `complete`: the build is over and the log will not grow. */
  | { phase: "read"; entries: BuildLogEntry[]; complete: boolean };

export function useBuildLog(projectName: string, componentName: string, buildName: string): { log: BuildLogState; retry: () => void } {
  const [log, setLog] = useState<BuildLogState>({ phase: "loading" });
  const resume = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cursor: string | undefined;
    let entries: BuildLogEntry[] = [];
    setLog({ phase: "loading" });

    const read = async () => {
      const { data, error } = await client.GET("/projects/{projectName}/components/{componentName}/builds/{buildName}/logs", {
        params: {
          path: { projectName, componentName, buildName },
          query: cursor ? { cursor } : {},
        },
      });
      if (cancelled) return;
      if (apiErrorCode(error) === "build_expired") {
        setLog({ phase: "expired" });
        return;
      }
      if (error || data === undefined) {
        setLog({ phase: "failed", entries });
        return;
      }
      if (data.nextCursor) cursor = data.nextCursor;
      entries = [...entries, ...(data.logs ?? [])];
      setLog({ phase: "read", entries, complete: data.complete });
      if (!data.complete) timer = setTimeout(() => void read(), TAIL_POLL_MS);
    };

    resume.current = () => {
      if (!cancelled) void read();
    };
    void read();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectName, componentName, buildName]);

  const retry = useCallback(() => resume.current(), []);
  return { log, retry };
}
