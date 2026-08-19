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

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Box, CircularProgress } from "@wso2/oxygen-ui";
// Type-only: erased at compile time, so the lazy runtime import in
// lazyExcalidraw.ts is unaffected and the bundle still splits.
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@aep/excalidraw-dsl";
import { ExcalidrawComponent } from "./lazyExcalidraw.js";
import { parseScene, fitContentToViewport, focusElements } from "./scene.js";
import { elementsOfScreens, openingFocusElements, focusTargetScreens } from "./screenFocus.js";

// How long the scene must stop changing before the viewport commits to a
// focus. Long enough to sit out an agent's flush cadence, short enough that a
// finished edit does not feel ignored.
const SETTLE_MS = 600;

export interface ExcalidrawViewProps {
  /** Serialised Excalidraw scene JSON. */
  scene: string;
  /** Fill the parent's height (else fixed 600px). */
  fillHeight?: boolean;
}

// On open, land on the FIRST screen at a readable size, with the top of the
// second peeking below as the cue that there is more — the peek is part of
// the fitted box, not left to the panel's aspect ratio. A scene with no
// screen tags (older compiles, non-wireframe scenes) falls back to fitting
// everything.
function focusInitial(api: ExcalidrawImperativeAPI, elements: ExcalidrawElement[] | undefined) {
  if (!elements?.length) return;
  const target = openingFocusElements(elements);
  if (target.length) focusElements(api, target, false);
  else fitContentToViewport(api, elements);
}

function ExcalidrawViewImpl({ scene, fillHeight }: ExcalidrawViewProps) {
  // Committed scenes remount via `key` upstream (uncontrolled + simple). A
  // STREAMED scene instead keeps one mounted canvas and pushes each new
  // compile through `updateScene` — remounting this (lazy, canvas-heavy)
  // component per line-flush would flicker and drop the viewport. The DSL
  // compiler emits stable element ids/seeds, so successive scenes diff
  // cleanly: existing elements keep their identity, new ones appear.
  const initialData = useMemo(() => parseScene(scene), [scene]);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const mountedScene = useRef(scene);
  // The last SETTLED scene — the baseline a finished edit is diffed against.
  // Deliberately not updated per flush: comparing against the previous flush
  // would measure the churn, not the edit.
  const settledElements = useRef<ExcalidrawElement[] | null>(initialData?.elements ?? null);
  const focusTimer = useRef<number | null>(null);

  useEffect(() => {
    if (scene === mountedScene.current) return; // initial mount already has it
    mountedScene.current = scene;
    const api = apiRef.current;
    const next = parseScene(scene);
    if (!api || !next?.elements) return; // unparseable → keep the last frame
    try {
      api.updateScene({ elements: next.elements });
    } catch {
      return; // api torn down
    }
    const elements = next.elements;
    // Draw every flush, but decide where to LOOK only once the writing pauses.
    // A wireframe arrives in many flushes while an agent edits, and the
    // in-between states are half-written — chasing each one would pan on every
    // keystroke and, worse, mid-write frames read as "everything changed".
    // Comparing against the last SETTLED scene is what makes the target the
    // edit itself rather than the churn.
    if (focusTimer.current !== null) window.clearTimeout(focusTimer.current);
    focusTimer.current = window.setTimeout(() => {
      focusTimer.current = null;
      const live = apiRef.current;
      if (!live) return;
      const target = focusTargetScreens(settledElements.current, elements);
      if (target.length > 0) focusElements(live, elementsOfScreens(elements, target), true);
      settledElements.current = elements;
    }, SETTLE_MS);
  }, [scene]);

  useEffect(
    () => () => {
      if (focusTimer.current !== null) window.clearTimeout(focusTimer.current);
    },
    [],
  );

  return (
    <Box
      sx={{
        flex: fillHeight ? 1 : undefined,
        height: fillHeight ? undefined : "600px",
        minHeight: 0,
        minWidth: 0,
        position: "relative",
        width: "100%",
        overflow: "hidden",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        "& .help-icon": { display: "none !important" },
        "& .dropdown-menu-button": { display: "none !important" },
        "& .App-menu_top__left": { display: "none !important" },
      }}
    >
      <Box sx={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <ExcalidrawComponent
          // parseScene returns a loose shape (scene.ts); aligning it with
          // Excalidraw's ExcalidrawInitialDataState is its own change.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          initialData={initialData as any}
          viewModeEnabled
          excalidrawAPI={(api: ExcalidrawImperativeAPI) => {
            apiRef.current = api;
            focusInitial(api, initialData?.elements);
          }}
        />
      </Box>
    </Box>
  );
}

export function ExcalidrawView(props: ExcalidrawViewProps) {
  const fallback = (
    <Box
      sx={{
        flex: props.fillHeight ? 1 : undefined,
        height: props.fillHeight ? "100%" : "600px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <CircularProgress size={28} />
    </Box>
  );
  return (
    <Suspense fallback={fallback}>
      <ExcalidrawViewImpl {...props} />
    </Suspense>
  );
}
