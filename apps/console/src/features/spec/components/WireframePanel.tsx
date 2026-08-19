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

import { useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@wso2/oxygen-ui";
import { ExcalidrawView, PrototypeView } from "@aep/ui-excalidraw-view";
import { useDerivedPrototype, useDerivedWireframe } from "../api/useDerivedDesign";
import { deriveLiveWireframe, focusTargets, type LiveCompile } from "../derive/deriveWireframe";
import { derivePrototypeModel } from "../derive/derivePrototype";
import type { SpecFileEntry } from "../api/mapping";
import type { CollabSpec } from "../collab/useCollabSpec";
import { useYTextString } from "../collab/useYTextString";

type ViewMode = "canvas" | "prototype";

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
  const [mode, setMode] = useState<ViewMode>("canvas");

  // The collab doc is the SOURCE while collab is up — the design.md rule.
  // Rooms are seeded with every committed specs/ file (non-md as Y.Text), and
  // the agents service mirrors each applied write, so the doc is always the
  // freshest truth: the committed content between turns, the growing DSL
  // during a generation, the edited DSL during an edit turn. The committed
  // fetch below runs ONLY when the doc has nothing (collab offline / room not
  // yet synced). Both paths feed the SAME compiler, so the renders match.
  const liveSource = useYTextString(collab.getFileText(dslPath));
  // The writer flushes on line boundaries, so the live text is whole lines —
  // but a mid-stream compile can still fail (e.g. a screen header typed ahead
  // of its body). Hold the last GOOD scene so a bad intermediate never blanks
  // the already-drawn screens. The held scene is tagged with the file it came
  // from: SpecView renders this panel unkeyed, so the ref survives a move to
  // another component, and untagged it would let component A's last good render
  // stand in for component B's uncompilable source.
  //
  // The held compile is also the PREVIOUS compile the next one is measured
  // against: `deriveLiveWireframe` reports which screens changed since it, and
  // that report is what steers the canvas to the agent's edit (#552). A
  // failed mid-stream compile leaves the held one in place AND reports no
  // change, so a half-written frame never moves the viewport.
  const lastGoodLive = useRef<{ path: string; result: LiveCompile } | null>(null);
  const live = useMemo(() => {
    if (typeof liveSource !== "string" || liveSource.trim().length === 0) return null;
    const previous = lastGoodLive.current?.path === dslPath ? lastGoodLive.current.result : null;
    const compiled = deriveLiveWireframe(dslPath, liveSource, previous);
    if (compiled) {
      lastGoodLive.current = { path: dslPath, result: compiled };
      return { scene: compiled.json, focusScreens: focusTargets(compiled, previous) };
    }
    return lastGoodLive.current?.path === dslPath
      ? { scene: lastGoodLive.current.result.json, focusScreens: [] as string[] }
      : null;
  }, [dslPath, liveSource]);
  const liveScene = live?.scene ?? null;

  // Two independent facts, deliberately NOT one flag:
  //   hasLiveContent — the doc has something renderable, so the doc is the
  //     source (the design.md rule above) and the committed states are moot.
  //   agentBusy      — a turn is running.
  // Rooms are seeded with every committed spec file, so live content says
  // nothing about whether a turn is running; folding them together is what
  // used to keep the view switch permanently hidden (#348).
  const hasLiveContent = liveScene != null;
  const agentBusy = collab.peers.some((p) => p.kind === "agent");

  // Committed fetch: the collab-less base path only (mirrors `usesCollab`
  // disabling the content query for markdown) — passing "" disables it. An
  // agent in the room also suppresses it: the doc WILL deliver the file, and
  // probing git for a not-yet-committed path just sprays retrying 404s.
  // Canvas and prototype read the SAME path so the shared query key (see
  // useDerivedDesign) means switching modes never refetches.
  const committedPath = hasLiveContent || agentBusy ? "" : dslPath;
  const { scene, isPending, isError } = useDerivedWireframe(projectName, committedPath, sha);
  const { model: committedPrototype, isPending: committedPrototypePending } =
    useDerivedPrototype(projectName, committedPath, sha);

  // The prototype rides the same source as the canvas, or the two views would
  // disagree about one file: after a turn ends the doc holds the new DSL while
  // the committed read still answers with the pre-turn copy. derivePrototypeModel
  // is pure, so the live model is just a compile of the text we already have.
  const livePrototype = useMemo(
    () =>
      typeof liveSource === "string" && liveSource.trim().length > 0
        ? derivePrototypeModel(dslPath, liveSource)
        : null,
    [dslPath, liveSource],
  );
  const prototypeModel = hasLiveContent ? livePrototype : committedPrototype;
  // A disabled query reports `isPending`, so only the committed path can pend.
  const prototypePending = !hasLiveContent && committedPrototypePending;

  // These four states all belong to the committed read, so they only speak when
  // the doc has nothing to render.
  if (!hasLiveContent && agentBusy) {
    // The committed fetch is suppressed while an agent is in the room (the
    // doc will deliver the file) — "drawing about to start", not a failure.
    return (
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Typography variant="body2" color="text.secondary">
          Waiting for the agent to draw the wireframes…
        </Typography>
      </Box>
    );
  }
  if (!hasLiveContent && isPending) {
    return (
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress aria-label="Loading wireframe" />
      </Box>
    );
  }
  if (!hasLiveContent && isError) {
    return <Alert severity="error">Failed to load {dslPath}.</Alert>;
  }
  if (!hasLiveContent && !scene) {
    return (
      <Typography variant="body2" color="text.secondary">
        This wireframe source could not be rendered.
      </Typography>
    );
  }

  // Settled means no turn is running — a seeded room with no agent IS settled,
  // which is the state every user browsing between turns is actually in. By
  // here we know something is renderable: the live scene, or the committed one.
  const showToggle = !agentBusy;

  // A compact segmented control (Oxygen's ToggleButtonGroup, restyled as a
  // pill) rather than the default chunky outlined pair — reads as a native
  // small view switch instead of a stray widget. Colors come from theme
  // tokens so it follows the active Oxygen theme.
  const viewSwitch = showToggle && (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={mode}
      onChange={(_, next: ViewMode | null) => {
        if (next) setMode(next);
      }}
      sx={{
        bgcolor: "action.hover",
        borderRadius: 999,
        p: 0.25,
        "& .MuiToggleButtonGroup-grouped": {
          border: 0,
          borderRadius: 999,
          px: 1.5,
          minHeight: 28,
          textTransform: "none",
          fontSize: "0.8125rem",
          color: "text.secondary",
          "&.Mui-selected": {
            bgcolor: "background.paper",
            color: "text.primary",
            boxShadow: 1,
            "&:hover": { bgcolor: "background.paper" },
          },
        },
      }}
    >
      <ToggleButton value="canvas">Canvas</ToggleButton>
      <ToggleButton value="prototype">Prototype</ToggleButton>
    </ToggleButtonGroup>
  );

  // Prototype mode with a rendered model hands the switch to PrototypeView's
  // `trailingSlot`, so the switch joins PrototypeView's own toolbar row (back ·
  // picker · description) instead of stacking a second gray bar above it.
  // Every other state (canvas, loading, error) keeps its own minimal header —
  // just the switch — since there's no PrototypeView toolbar to join.
  const showOwnHeader = showToggle && !(mode === "prototype" && prototypeModel && !prototypePending);

  // On the live branch ONE mounted canvas takes successive scenes through
  // ExcalidrawView's updateScene path (no `key`, no remount per flushed line).
  // The committed render keeps the remount-by-sha behavior. ExcalidrawView
  // (fillHeight) sets `flex: 1` on its own root inside the flex column.
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {agentBusy && hasLiveContent && (
        // The chip means "actively being generated", not "rendered from the
        // live doc" — the doc is ALWAYS the source while collab is up (rooms
        // are seeded), so it MUST key on the peer, not on the live text.
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
      {showOwnHeader && (
        <Box
          sx={{
            px: 1.5,
            py: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          {viewSwitch}
        </Box>
      )}
      {mode === "prototype" && showToggle ? (
        prototypePending ? (
          <Box sx={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <CircularProgress aria-label="Loading prototype" />
          </Box>
        ) : prototypeModel ? (
          <PrototypeView key={sha} model={prototypeModel} fillHeight trailingSlot={viewSwitch} />
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            This wireframe could not be rendered as a prototype.
          </Typography>
        )
      ) : hasLiveContent ? (
        <ExcalidrawView scene={liveScene!} focusScreens={live!.focusScreens} fillHeight />
      ) : (
        <ExcalidrawView key={sha} scene={scene!} fillHeight />
      )}
    </Box>
  );
}
