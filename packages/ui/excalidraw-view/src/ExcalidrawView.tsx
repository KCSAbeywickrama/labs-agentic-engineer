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
import { ExcalidrawComponent } from "./lazyExcalidraw.js";
import { parseScene, fitContentToViewport, focusElements } from "./scene.js";
import { elementsOfScreens, openingFocusElements, changedScreenNames } from "./screenFocus.js";

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
function focusInitial(api: any, elements: any[] | undefined) {
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
  const apiRef = useRef<any>(null);
  const mountedScene = useRef(scene);
  // The elements currently on the canvas, kept so a streamed update can be
  // diffed against them and the viewport moved to what actually changed.
  const shownElements = useRef<any[] | null>(initialData?.elements ?? null);

  useEffect(() => {
    if (scene === mountedScene.current) return; // initial mount already has it
    mountedScene.current = scene;
    const api = apiRef.current;
    const next = parseScene(scene);
    if (!api || !next?.elements) return; // unparseable → keep the last frame
    try {
      api.updateScene({ elements: next.elements });
      // Follow the agent's work: pan to whichever screen(s) this update
      // touched. When nothing is detectable, leave the viewport where the
      // reader put it — never refit the whole board, which is what shrank
      // every screen to an illegible size on each keystroke.
      const changed = changedScreenNames(shownElements.current, next.elements);
      if (changed.length > 0) focusElements(api, elementsOfScreens(next.elements, changed), true);
      shownElements.current = next.elements;
    } catch {
      /* api torn down */
    }
  }, [scene]);

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
          initialData={initialData as any}
          viewModeEnabled
          excalidrawAPI={(api: any) => {
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
