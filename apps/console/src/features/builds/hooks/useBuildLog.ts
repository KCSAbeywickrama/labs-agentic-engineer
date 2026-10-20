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

import { useEffect, useRef, useState } from "react";
import { client } from "../../../api/client";
import { apiErrorCode, apiErrorMessage } from "../../../api/errors";
import type { components } from "../../../generated/aep-api";

// One component build's log, read live from OpenChoreo through the server's
// cursor. A finished build answers complete on the first read; a running one
// answers incomplete, and each later read starts from the cursor the last one
// returned. A build OpenChoreo no longer keeps answers `build_expired`. Read
// only while its row is open, so a page of closed logs costs nothing.

type BuildLogEntry = components["schemas"]["BuildLogEntry"];

const TAIL_POLL_MS = 2_000;

const initial: BuildLogState = { entries: [], complete: false, expired: false, loading: true, error: undefined };

export interface BuildLogState {
  entries: BuildLogEntry[];
  /** The build is over and the log will not grow. */
  complete: boolean;
  /** OpenChoreo no longer keeps the build, so there is no log to read. */
  expired: boolean;
  loading: boolean;
  error: string | undefined;
}

export function useBuildLog(projectName: string, componentName: string, buildName: string): BuildLogState {
  const [state, setState] = useState<BuildLogState>(initial);
  const cursor = useRef<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    cursor.current = undefined;
    setState(initial);

    const read = async () => {
      const { data, error } = await client.GET("/projects/{projectName}/components/{componentName}/builds/{buildName}/logs", {
        params: {
          path: { projectName, componentName, buildName },
          query: cursor.current ? { cursor: cursor.current } : {},
        },
      });
      if (cancelled) return;
      if (apiErrorCode(error) === "build_expired") {
        setState({ entries: [], complete: true, expired: true, loading: false, error: undefined });
        return;
      }
      if (error || data === undefined) {
        // A failing read keeps failing: stop rather than poll it.
        setState((prev) => ({ ...prev, loading: false, error: apiErrorMessage(error, "Failed to load the build log") }));
        return;
      }
      if (data.nextCursor) cursor.current = data.nextCursor;
      setState((prev) => ({
        entries: [...prev.entries, ...(data.logs ?? [])],
        complete: data.complete,
        expired: false,
        loading: false,
        error: undefined,
      }));
      if (!data.complete) timer = setTimeout(() => void read(), TAIL_POLL_MS);
    };

    void read();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectName, componentName, buildName]);

  return state;
}
