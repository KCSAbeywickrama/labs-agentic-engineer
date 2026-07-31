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

import { useMemo, useReducer, useRef, useState, useEffect, Suspense, type ReactNode } from "react";
import { Box, CircularProgress, IconButton, MenuItem, Select, Typography } from "@wso2/oxygen-ui";
import { ArrowLeft } from "@wso2/oxygen-ui-icons-react";
import { PROTOTYPE_LINK_PREFIX, type PrototypeModel } from "@aep/excalidraw-dsl";
import { ExcalidrawComponent } from "./lazyExcalidraw.js";
import { parseScene, fitContentToViewport } from "./scene.js";
import { prototypeNavReducer } from "./prototypeState.js";
import { hotspotToViewport, type ViewportRect } from "./hotspotOverlay.js";

const FLASH_MS = 900;

export interface PrototypeViewProps {
  model: PrototypeModel;
  /** Start screen (deep link). Unknown/absent → first screen. */
  initialScreen?: string;
  /** Fires on every screen change — the full-screen route syncs the URL. */
  onScreenChange?: (screen: string) => void;
  /** Fill the parent's height (else fixed 600px), like ExcalidrawView. */
  fillHeight?: boolean;
  /** Right-aligned toolbar slot (e.g. "open full screen" in the inline embed). */
  headerAction?: ReactNode;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Expects to be remounted (e.g. via a `key`) when `model` changes: `initialData`
// is captured once at mount, and the screen-swap effect only reacts to
// navigation, not to a new `model` identity.
export function PrototypeView({ model, initialScreen, onScreenChange, fillHeight, headerAction }: PrototypeViewProps) {
  const byName = useMemo(() => new Map(model.screens.map((s) => [s.name, s])), [model]);
  const first = model.screens[0]!.name;
  const start = initialScreen && byName.has(initialScreen) ? initialScreen : first;
  const [nav, dispatch] = useReducer(prototypeNavReducer, { current: start, stack: [] });
  const apiRef = useRef<any>(null);
  const navigatedRef = useRef(false);
  const [flash, setFlash] = useState<ViewportRect[] | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  const screen = byName.get(nav.current) ?? model.screens[0]!;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialData = useMemo(() => parseScene(model.screens.find((s) => s.name === start)!.sceneJson), []);

  // Screen swap: one mounted canvas, updateScene + refit — ExcalidrawView's
  // streaming pattern. Also notify the consumer (URL sync).
  const mounted = useRef(start);
  useEffect(() => {
    onScreenChange?.(nav.current);
    if (nav.current === mounted.current) return;
    mounted.current = nav.current;
    const api = apiRef.current;
    const next = parseScene(screen.sceneJson);
    if (!api || !next?.elements) return;
    try {
      api.updateScene({ elements: next.elements });
      fitContentToViewport(api, next.elements);
    } catch {
      /* api torn down */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.current]);

  const onLinkOpen = (element: any, event: CustomEvent<{ nativeEvent: MouseEvent }>) => {
    const link: string | null = element?.link ?? null;
    if (!link?.startsWith(PROTOTYPE_LINK_PREFIX)) return; // real URLs keep default behavior
    event.preventDefault();
    navigatedRef.current = true;
    const target = link.slice(PROTOTYPE_LINK_PREFIX.length);
    if (byName.has(target)) dispatch({ type: "navigate", to: target });
  };

  // Dead-area click → flash all hotspots (Figma-style discoverability).
  // onLinkOpen fires during pointerup, before the click event bubbles here,
  // so the ref cleanly separates "navigated" from "dead click".
  const onCanvasClick = () => {
    if (navigatedRef.current) {
      navigatedRef.current = false;
      return;
    }
    const api = apiRef.current;
    if (!api || screen.hotspots.length === 0) return;
    const appState = api.getAppState();
    setFlash(screen.hotspots.map((h) => hotspotToViewport(h, appState)));
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = null;
      setFlash(null);
    }, FLASH_MS);
  };

  return (
    <Box
      sx={{
        flex: fillHeight ? 1 : undefined,
        height: fillHeight ? undefined : "600px",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        "& .help-icon": { display: "none !important" },
        "& .dropdown-menu-button": { display: "none !important" },
        "& .App-menu_top__left": { display: "none !important" },
      }}
    >
      {/* Toolbar: back · screen picker · description · action slot */}
      <Box sx={{ px: 1.5, py: 1, display: "flex", alignItems: "center", gap: 1, borderBottom: 1, borderColor: "divider" }}>
        <IconButton size="small" aria-label="Back" disabled={nav.stack.length === 0} onClick={() => dispatch({ type: "back" })}>
          <ArrowLeft size={16} />
        </IconButton>
        <Select
          size="small"
          value={nav.current}
          onChange={(e) => dispatch({ type: "navigate", to: String(e.target.value) })}
          aria-label="Screen"
        >
          {model.screens.map((s) => (
            <MenuItem key={s.name} value={s.name}>
              {s.name}
            </MenuItem>
          ))}
        </Select>
        {screen.description && (
          <Typography variant="body2" color="text.secondary" noWrap>
            {screen.description}
          </Typography>
        )}
        <Box sx={{ ml: "auto" }}>{headerAction}</Box>
      </Box>
      <Box sx={{ position: "relative", flex: 1, minHeight: 0 }} onClick={onCanvasClick}>
        <Box sx={{ position: "absolute", inset: 0 }}>
          <Suspense
            fallback={
              <Box sx={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <CircularProgress size={28} />
              </Box>
            }
          >
            <ExcalidrawComponent
              initialData={initialData as any}
              viewModeEnabled
              onLinkOpen={onLinkOpen as any}
              excalidrawAPI={(api: any) => {
                apiRef.current = api;
                const els = initialData?.elements;
                if (els?.length) fitContentToViewport(api, els);
              }}
            />
          </Suspense>
        </Box>
        {flash?.map((r, i) => (
          <Box
            key={i}
            sx={{
              position: "absolute",
              left: r.left,
              top: r.top,
              width: r.width,
              height: r.height,
              border: "2px solid",
              borderColor: "primary.main",
              borderRadius: 1,
              bgcolor: "rgba(250,123,63,0.12)",
              pointerEvents: "none",
            }}
          />
        ))}
      </Box>
    </Box>
  );
}
