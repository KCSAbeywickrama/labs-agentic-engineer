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
import { Box, Stack, Typography } from "@wso2/oxygen-ui";
import { useBuildProgress } from "../hooks/useBuildProgress";
import { runKindLabel } from "../lib/runView";
import { CycleSection } from "./RunFeed";

// The VERSION feed: ONE SSE stream over every run the version's milestone has
// seen, rendered as one continuous timeline with the run KIND as the section
// marker. A version is what people think in; runs are how the platform executes
// it, and since the delivery loop split into three workflows a version's story
// is spread across several of them — a spec build, then whatever repaired or
// re-judged it.
//
// CHRONOLOGICAL, unlike RunFeed's single-run stack, which reverses so the cycle
// a reader came to watch leads. This surface is a narrative: it reads forwards,
// and what is live is still open on arrival because the box that opens by
// default is the newest cycle of the newest run.

/** The run heading — the section marker, named in the vocabulary runView owns
 *  so a run is called the same thing here as on the run card and the history
 *  rows. The index disambiguates two runs of one kind, which is ordinary: a
 *  version can be repaired, or re-judged, more than once. */
function RunMarker({ kind, index }: { kind: string; index: number }) {
  return (
    <Typography
      variant="caption"
      sx={{
        display: "block",
        mb: 0.5,
        fontWeight: 700,
        letterSpacing: "0.08em",
        color: "text.secondary",
      }}
    >
      {`RUN ${String(index)} · ${runKindLabel(kind).toUpperCase()}`}
    </Typography>
  );
}

/**
 * The version's whole agent timeline. Mounted only where it should stream — the
 * hook opens the SSE connection on mount and closes it on unmount, so keeping
 * this behind a disclosure is what keeps a page that nobody is reading
 * connection-free.
 */
export function BuildFeed({
  projectName,
  tag,
  runIds,
}: {
  projectName: string;
  tag: string;
  /** The run ids the caller's run-list poll currently sees. The stream settles
   *  whenever no run is live, and a later run is admitted without warning — so
   *  this is what tells the feed to reattach. Order-sensitive by construction:
   *  the caller passes the list it has, and any change to it is a reason to ask
   *  the server again. */
  runIds: readonly string[];
}) {
  const feed = useBuildProgress(projectName, tag, runIds.join(","));

  // Which section is open, CONTROLLED — the same three meanings RunFeed's state
  // carries (undefined = follow the newest, null = the reader closed it, a
  // string = the reader's pick), and for the same reason: `defaultExpanded` is
  // read once at mount, so a cycle arriving mid-stream would open beside the one
  // already open.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const newest = feed.runs.at(-1)?.cycles.at(-1)?.cycle.id ?? null;
  const openId = chosen === undefined ? newest : chosen;

  let tail: string | undefined;
  if (feed.phase === "connecting") {
    tail = "attaching to the version feed…";
  } else if (feed.phase === "reconnecting") {
    tail = "connection lost — reconnecting…";
  } else if (feed.phase === "ended") {
    // Deliberately not "the version is finished". The stream ends when no run is
    // live, which is a resting state: a validation or task run may be admitted
    // on this milestone later, and the feed reattaches when the run list shows
    // one.
    tail = "nothing is running on this version right now";
  }

  return (
    <Box>
      {feed.runs.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          No agent output yet — no run of this version has written a line.
        </Typography>
      ) : (
        <Stack spacing={2}>
          {feed.runs.map((section) => (
            <Box key={section.run.id}>
              <RunMarker kind={section.run.kind} index={section.run.index} />
              {section.cycles.map((cycle, i) => (
                <CycleSection
                  key={cycle.cycle.id}
                  section={cycle}
                  // Run-relative, exactly as the wire carries it: the heading
                  // above already names the run, so repeating it inside every
                  // box would say it twice.
                  ordinal={i + 1}
                  expanded={openId === cycle.cycle.id}
                  onToggle={(open) => {
                    setChosen(open ? cycle.cycle.id : null);
                  }}
                />
              ))}
            </Box>
          ))}
        </Stack>
      )}
      {tail && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 1 }}
        >
          {tail}
        </Typography>
      )}
    </Box>
  );
}
