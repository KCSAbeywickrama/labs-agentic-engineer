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

/**
 * The running prototype, as a host page embeds it: `prototype.tsx` executed
 * inside a sandboxed frame, never in the host's own page. The host tells the
 * frame what to run (`load`), what to draw (`view`) and when to start the
 * mock data over (`reset`); the frame answers with navigations, selection
 * toggles, the elements a screen draws, data snapshots, Escape and errors.
 * Every message's source and shape is checked. Plain React, no theme.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { DataSnapshot } from "../data.js";
import type { PrototypeManifest } from "../manifest/types.js";
import { parseFromFrameMessage, type FrameElement, type FrameView, type ToFrameMessage } from "./bridge.js";
import { prototypeFrameDocument } from "./frame-document.js";

export interface PrototypeFrameProps {
  /** The prototype's name, for the frame's accessible title (`<title> prototype app`). */
  title: string;
  /** The theme's `frame-runtime.js` text. */
  runtime: string;
  manifest: PrototypeManifest;
  source: string;
  /** Changes exactly when `manifest` or `source` does; a new version reloads the app. */
  version: string;
  view: FrameView;
  /** The snapshot a (re)load starts the mock data from; the seed when absent. */
  initialData?: DataSnapshot | undefined;
  /** Bump to start the mock data from the seed again. */
  resetToken?: number | undefined;
  onNavigate: (screenId: string) => void;
  onToggle: (elementKey: string) => void;
  onEscape: () => void;
  onElements: (screenId: string, elements: FrameElement[]) => void;
  onData?: ((data: DataSnapshot) => void) | undefined;
}

export function PrototypeFrame(props: PrototypeFrameProps) {
  const { title, runtime, version, view, resetToken } = props;
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const doc = useMemo(() => prototypeFrameDocument(runtime), [runtime]);

  // The latest props, for the one message listener and the effects below.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const message = parseFromFrameMessage(event.data);
      if (!message) return;
      const p = latest.current;
      switch (message.type) {
        case "proto:ready":
          setReady(true);
          break;
        case "proto:navigate":
          p.onNavigate(message.screenId);
          break;
        case "proto:toggle":
          p.onToggle(message.elementKey);
          break;
        case "proto:escape":
          p.onEscape();
          break;
        case "proto:rendered":
          p.onElements(message.screenId, message.elements);
          break;
        case "proto:data":
          p.onData?.(message.data);
          break;
        case "proto:error":
          setError(message.message);
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const post = (message: ToFrameMessage) => {
    // The frame's origin is opaque, so no target origin can be named; what is sent is the prototype and the view, no secret.
    frame.current?.contentWindow?.postMessage(message, "*");
  };

  // (Re)load the app when the frame is ready and whenever the prototype changes.
  const loadedVersion = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const p = latest.current;
    setError(null);
    loadedVersion.current = version;
    post({ type: "proto:load", source: p.source, manifest: p.manifest, view: p.view, data: p.initialData });
  }, [ready, version]);

  // Draw every later view of the loaded app.
  useEffect(() => {
    if (!ready || loadedVersion.current !== version) return;
    post({ type: "proto:view", view });
    // `version` is read, not a trigger: a new version's first view goes with its load.
  }, [ready, view]);

  // Start the data over when the token changes (not on the first render).
  const lastReset = useRef(resetToken);
  useEffect(() => {
    if (!ready || lastReset.current === resetToken) return;
    lastReset.current = resetToken;
    post({ type: "proto:reset" });
  }, [ready, resetToken]);

  return (
    <div className="proto-frame" style={{ position: "relative", flex: 1, display: "flex", minHeight: 0 }}>
      {error && (
        <div role="alert" className="proto-frame-error" style={{ position: "absolute", top: 8, left: 8, right: 8, zIndex: 1, padding: "8px 12px", borderRadius: 6, background: "#fdecea", color: "#611a15", font: "13px system-ui, sans-serif", display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      <iframe ref={frame} title={`${title} prototype app`} sandbox="allow-scripts" srcDoc={doc} style={{ flex: 1, border: 0, width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
