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

import { useMemo, useRef } from "react";
import { Alert, Box, Chip, CircularProgress, Typography } from "@wso2/oxygen-ui";
import { ExcalidrawView } from "@aep/ui-excalidraw-view";
import { useDerivedWireframe } from "../api/useDerivedDesign";
import { deriveWireframeScene } from "../derive/deriveWireframe";
import type { SpecFileEntry } from "../api/mapping";
import type { CollabSpec } from "../collab/useCollabSpec";
import { useYTextString } from "../collab/useYTextString";

export function WireframePanel({
  projectName,
  dslPath,
  files,
  collab,
}: {
  projectName: string;
  dslPath: string;
  files: SpecFileEntry[];
  collab: CollabSpec;
}) {
  const sha = files.find((f) => f.path === dslPath)?.sha;
  const { scene, isPending, isError } = useDerivedWireframe(projectName, dslPath, sha);

  // The committed file is authoritative. While it is not yet resolved (the
  // agent is still writing wireframes.dsl, or the fetch is pending/failing
  // mid-turn), fall back to the live DSL streaming into the collab doc so the
  // screens draw piece-by-piece as the agent writes them — same pattern as
  // CellDiagramPanel. Both paths feed the SAME compiler, so the streamed and
  // committed renders match.
  const liveSource = useYTextString(collab.getFileText(dslPath));
  // The writer flushes on line boundaries, so the live text is whole lines —
  // but a mid-stream compile can still fail (e.g. a screen header typed ahead
  // of its body). Hold the last GOOD scene so a bad intermediate never blanks
  // the already-drawn screens.
  const lastGoodLive = useRef<string | null>(null);
  const liveScene = useMemo(() => {
    if (typeof liveSource !== "string" || liveSource.trim().length === 0) return null;
    const compiled = deriveWireframeScene(dslPath, liveSource);
    if (compiled) lastGoodLive.current = compiled;
    return lastGoodLive.current;
  }, [dslPath, liveSource]);

  const derivedReady = !isPending && !isError && scene != null;
  const streaming = !derivedReady && liveScene != null;
  const agentBusy = collab.peers.some((p) => p.kind === "agent");

  if (!streaming && isPending) {
    return (
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress aria-label="Loading wireframe" />
      </Box>
    );
  }
  if (!streaming && isError) {
    // Mid-generation the committed file may not exist yet; with an agent in
    // the room that is "drawing about to start", not a failure.
    if (agentBusy) {
      return (
        <Box sx={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Typography variant="body2" color="text.secondary">
            Waiting for the agent to draw the wireframes…
          </Typography>
        </Box>
      );
    }
    return <Alert severity="error">Failed to load {dslPath}.</Alert>;
  }
  if (!streaming && !scene) {
    return (
      <Typography variant="body2" color="text.secondary">
        This wireframe source could not be rendered.
      </Typography>
    );
  }

  // While streaming, ONE mounted canvas takes successive scenes through
  // ExcalidrawView's updateScene path (no `key`, no remount per line). The
  // committed render keeps the remount-by-sha behavior. ExcalidrawView
  // (fillHeight) sets `flex: 1` on its own root inside the flex column.
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {streaming && (
        <Box
          sx={{
            px: 1.5,
            py: 1,
            display: "flex",
            alignItems: "center",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Chip size="small" color="primary" variant="outlined" label="Drawing…" />
        </Box>
      )}
      {streaming ? (
        <ExcalidrawView scene={liveScene!} fillHeight />
      ) : (
        <ExcalidrawView key={sha} scene={scene!} fillHeight />
      )}
    </Box>
  );
}
