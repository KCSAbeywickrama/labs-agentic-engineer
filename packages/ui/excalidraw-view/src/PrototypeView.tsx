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
import type { PrototypeModel } from "@aep/excalidraw-dsl";
import { ExcalidrawComponent } from "./lazyExcalidraw.js";
import { parseScene, fitContentToViewport } from "./scene.js";
import { prototypeNavReducer } from "./prototypeState.js";
import { hotspotToViewport, type ViewportRect } from "./hotspotOverlay.js";

const FLASH_MS = 900;

/** Excalidraw's own scroll/zoom snapshot — the shape hotspotToViewport needs. */
type CameraState = { scrollX: number; scrollY: number; zoom: { value: number } };

export interface PrototypeViewProps {
  model: PrototypeModel;
  /** Start screen (deep link). Unknown/absent → first screen. */
  initialScreen?: string;
  /** Fires on every screen change — the full-screen route syncs the URL. */
  onScreenChange?: (screen: string) => void;
  /** Fill the parent's height (else fixed 600px), like ExcalidrawView. */
  fillHeight?: boolean;
  /** Left-aligned toolbar slot (e.g. the console's Canvas | Prototype switch,
   *  so the switch and this view's own chrome read as one toolbar row). */
  leadingSlot?: ReactNode;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Expects to be remounted (e.g. via a `key`) when `model` changes: `initialData`
// is captured once at mount, and the screen-swap effect only reacts to
// navigation, not to a new `model` identity.
export function PrototypeView({ model, initialScreen, onScreenChange, fillHeight, leadingSlot }: PrototypeViewProps) {
  const byName = useMemo(() => new Map(model.screens.map((s) => [s.name, s])), [model]);
  const first = model.screens[0]!.name;
  const start = initialScreen && byName.has(initialScreen) ? initialScreen : first;
  const [nav, dispatch] = useReducer(prototypeNavReducer, { current: start, stack: [] });
  const apiRef = useRef<any>(null);
  const [flash, setFlash] = useState(false);
  const flashTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  // Current screen's hotspots, transformed to container-viewport coordinates.
  // Recomputed on scroll/zoom, after a screen swap's fit-to-content settles,
  // and on initial mount — see the effects below.
  const [overlayRects, setOverlayRects] = useState<ViewportRect[]>([]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  const screen = byName.get(nav.current) ?? model.screens[0]!;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialData = useMemo(() => parseScene(model.screens.find((s) => s.name === start)!.sceneJson), []);

  const recomputeOverlay = (camera: CameraState) => {
    setOverlayRects(screen.hotspots.map((h) => hotspotToViewport(h, camera)));
  };

  // fitContentToViewport settles inside a requestAnimationFrame; chain one
  // more frame after it so the overlay is measured against the SETTLED
  // camera, not the pre-fit one.
  const recomputeOverlaySoon = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const api = apiRef.current;
        if (api) recomputeOverlay(api.getAppState());
      });
    });
  };

  // Screen swap: one mounted canvas, updateScene + refit — ExcalidrawView's
  // streaming pattern. Also notify the consumer (URL sync).
  const mounted = useRef(start);
  useEffect(() => {
    onScreenChange?.(nav.current);
    if (nav.current === mounted.current) return;
    mounted.current = nav.current;
    const api = apiRef.current;
    const next = parseScene(screen.sceneJson);
    setOverlayRects([]); // stale positions belong to the outgoing screen
    if (!api || !next?.elements) return;
    try {
      api.updateScene({ elements: next.elements });
      fitContentToViewport(api, next.elements);
      recomputeOverlaySoon();
    } catch {
      /* api torn down */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.current]);

  // Dead-area click (canvas background, not a hotspot overlay — those stop
  // propagation) → flash every hotspot on the current screen (Figma-style
  // discoverability).
  const onDeadAreaClick = () => {
    if (screen.hotspots.length === 0) return;
    setFlash(true);
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = null;
      setFlash(false);
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
      {/* Toolbar: leading slot (e.g. the console's view switch) · back ·
          screen picker · description — one coherent row. */}
      <Box sx={{ px: 1.5, py: 1, display: "flex", alignItems: "center", gap: 1, borderBottom: 1, borderColor: "divider" }}>
        {leadingSlot}
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
      </Box>
      <Box sx={{ position: "relative", flex: 1, minHeight: 0 }} onClick={onDeadAreaClick}>
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
              onScrollChange={(scrollX: number, scrollY: number, zoom: { value: number }) =>
                recomputeOverlay({ scrollX, scrollY, zoom })
              }
              excalidrawAPI={(api: any) => {
                apiRef.current = api;
                const els = initialData?.elements;
                if (els?.length) fitContentToViewport(api, els);
                recomputeOverlaySoon();
              }}
            />
          </Suspense>
        </Box>
        {screen.hotspots.map((h, i) => {
          const r = overlayRects[i];
          if (!r) return null;
          return (
            <Box
              key={`${h.target}:${i}`}
              role="button"
              aria-label={`Go to ${h.target}`}
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: "navigate", to: h.target });
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                e.stopPropagation();
                dispatch({ type: "navigate", to: h.target });
              }}
              sx={{
                position: "absolute",
                // Excalidraw's own interactive canvas layer sets z-index: 2
                // (its CSS, not ours); since neither ancestor Box here
                // establishes its own stacking context, that z-index escapes
                // to this box's context and would otherwise paint OVER a
                // later-in-DOM but z-index:auto sibling. Beat it explicitly.
                zIndex: 3,
                left: r.left,
                top: r.top,
                width: r.width,
                height: r.height,
                cursor: "pointer",
                borderRadius: 1,
                border: "2px solid transparent",
                ...(flash
                  ? { borderColor: "primary.main", bgcolor: "rgba(250,123,63,0.12)" }
                  : {
                      "&:hover": {
                        borderColor: "primary.main",
                        bgcolor: "rgba(250,123,63,0.12)",
                      },
                    }),
              }}
            />
          );
        })}
      </Box>
    </Box>
  );
}
