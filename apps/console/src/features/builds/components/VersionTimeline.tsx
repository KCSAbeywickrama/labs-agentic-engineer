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

import { useState } from "react";
import { Box, Button, Typography } from "@wso2/oxygen-ui";
import { BuildFeed } from "./BuildFeed";

/**
 * The version's whole agent timeline, BEHIND A DISCLOSURE.
 *
 * The run card above already streams what is happening now, and each SSE
 * connection costs the server a ticking derive plus a pod-log read per cycle —
 * so a page that held both open unasked would double that for every reader, to
 * show the same newest cycle twice. The disclosure is what keeps exactly one
 * stream per reader: BuildFeed is UNMOUNTED until it is opened, which is what
 * closes the connection, and closing it again releases it.
 *
 * What is behind it is the thing the run card cannot say: the version as ONE
 * narrative across every run its milestone has seen — the spec build, then
 * whatever repaired or re-judged it.
 */
export function VersionTimeline({
  projectName,
  tag,
  runIds,
}: {
  projectName: string;
  tag: string;
  /** Every run the version has, from the page's own run list. The feed reattaches
   *  when this changes, because the stream settles whenever no run is live and a
   *  later run is admitted without warning. */
  runIds: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  if (runIds.length === 0) return null;

  return (
    <Box>
      <Typography
        variant="caption"
        sx={{
          display: "block",
          mb: 1,
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: "text.secondary",
        }}
      >
        {`THIS VERSION'S WHOLE TIMELINE`}
      </Typography>
      {open ? (
        <>
          <BuildFeed projectName={projectName} tag={tag} runIds={runIds} />
          <Button
            size="small"
            color="inherit"
            onClick={() => setOpen(false)}
            sx={{ mt: 1 }}
          >
            Close the timeline
          </Button>
        </>
      ) : (
        <Button size="small" variant="outlined" onClick={() => setOpen(true)}>
          {runIds.length === 1
            ? "Show every build session of this version"
            : `Show all ${String(runIds.length)} runs of this version, in order`}
        </Button>
      )}
    </Box>
  );
}
