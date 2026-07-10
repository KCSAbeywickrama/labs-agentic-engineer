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

import { lazy, Suspense, useMemo } from "react";
import { Box, CircularProgress } from "@wso2/oxygen-ui";

// Large bundle + separate CSS export; load lazily only when a diagram opens.
const ExcalidrawComponent = lazy(async () => {
  const [mod] = await Promise.all([
    import("@excalidraw/excalidraw"),
    import("@excalidraw/excalidraw/index.css"),
  ]);
  return { default: mod.Excalidraw };
});

export interface ExcalidrawViewProps {
  /** Serialised Excalidraw scene JSON. */
  scene: string;
  /** Fill the parent's height (else fixed 600px). */
  fillHeight?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Scene = { elements?: any; appState?: any; files?: any };

// appState.collaborators is a Map at runtime; a JSON round-trip turns it into a
// plain object and crashes Excalidraw's iteration. Drop it — the lib rebuilds it.
function sanitizeAppState(appState: any): any {
  if (!appState || typeof appState !== "object") return appState;
  const { collaborators: _drop, ...rest } = appState;
  return rest;
}

function parseScene(value: string): Scene | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      elements: parsed.elements,
      appState: sanitizeAppState(parsed.appState),
      files: parsed.files,
    };
  } catch {
    return null;
  }
}

function fitContentToViewport(api: any, elements: any) {
  requestAnimationFrame(() => {
    try {
      api.scrollToContent(elements, { fitToContent: true, viewportZoomFactor: 0.9, animate: false });
    } catch {
      /* api torn down */
    }
  });
}

function ExcalidrawViewImpl({ scene, fillHeight }: ExcalidrawViewProps) {
  // Remount on scene change via `key` upstream keeps this uncontrolled + simple.
  const initialData = useMemo(() => parseScene(scene), [scene]);

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
            if (initialData?.elements?.length) fitContentToViewport(api, initialData.elements);
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
