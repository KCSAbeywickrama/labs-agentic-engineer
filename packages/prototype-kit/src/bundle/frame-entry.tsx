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
 * The frame runtime's entry, bundled per theme by `buildThemeRuntimes`: the
 * script inside a host's sandboxed prototype frame. It waits for `load`, runs
 * the prototype, draws the view it is sent, and reports back what the screen
 * holds, what the reviewer pressed, the mock data and anything that failed.
 */

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PrototypeApp } from "../app.js";
import type { DataSnapshot } from "../data.js";
import { parseToFrameMessage, type FrameElement, type FrameView, type FromFrameMessage } from "../host/bridge.js";
import { parseManifest } from "../manifest/parse.js";
import type { PrototypeManifest } from "../manifest/types.js";
import { KitRoot } from "../runtime/KitRoot.js";
import { moduleFactorySource } from "../runtime/module-source.js";
import { runPrototypeModule, type ModuleFactory } from "../runtime/modules.js";
import { transpileSource } from "../source/transpile.js";
import type { PrototypeTheme } from "../theme/contract.js";

function post(message: FromFrameMessage) {
  // The parent is the host page; the frame's own origin is opaque, so no target origin can be named. Nothing sent is a secret.
  window.parent.postMessage(message, "*");
}

interface Loaded {
  app: PrototypeApp;
  manifest: PrototypeManifest;
  initialData: DataSnapshot | undefined;
  /** Bumped per load and reset, so the app remounts with a fresh store. */
  generation: number;
}

let generation = 0;

function load(source: string, manifestValue: unknown, data: DataSnapshot | undefined): Loaded {
  const manifest = parseManifest(manifestValue);
  if (!manifest.ok) throw new Error(`prototype.json is not valid: ${manifest.findings.map((f) => f.message).join("; ")}`);
  const transpiled = transpileSource(source);
  if (!transpiled.ok) throw new Error(transpiled.findings.map((f) => `${f.location}: ${f.message}`).join("; "));
  // The frame is the sandbox: evaluating the module here is what it is for.
  const factory = (0, eval)(moduleFactorySource(transpiled.code)) as ModuleFactory;
  return { app: runPrototypeModule(factory), manifest: manifest.manifest, initialData: data, generation: ++generation };
}

/** The elements the document draws now, in document order, each once. */
function drawnElements(): FrameElement[] {
  const seen = new Set<string>();
  const out: FrameElement[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("[data-proto-key]")) {
    const key = el.dataset["protoKey"];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: el.dataset["protoLabel"] ?? key });
  }
  return out;
}

/** Reports the drawn elements whenever they change, at most once a frame. */
function watchElements(screenId: () => string | undefined): { report: () => void; stop: () => void } {
  let last = "";
  let pending = false;
  const report = () => {
    pending = false;
    const screen = screenId();
    if (screen === undefined) return;
    const elements = drawnElements();
    const signature = `${screen}\n${elements.map((e) => `${e.key}\t${e.label}`).join("\n")}`;
    if (signature === last) return;
    last = signature;
    post({ type: "proto:rendered", screenId: screen, elements });
  };
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(report);
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-proto-key", "data-proto-label"] });
  return { report, stop: () => observer.disconnect() };
}

function Frame({ theme }: { theme: PrototypeTheme }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [view, setView] = useState<FrameView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const screen = useRef<string | undefined>(undefined);
  screen.current = view?.screenId;
  const watcher = useRef<ReturnType<typeof watchElements> | null>(null);

  useEffect(() => {
    watcher.current = watchElements(() => screen.current);
    return () => watcher.current?.stop();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const message = parseToFrameMessage(event.data);
      if (!message) return;
      if (message.type === "proto:reset") {
        setLoaded((l) => l && { ...l, initialData: undefined, generation: ++generation });
        return;
      }
      if (message.type === "proto:load") {
        try {
          setLoaded(load(message.source, message.manifest, message.data));
          setFailure(null);
        } catch (e) {
          const text = e instanceof Error ? e.message : String(e);
          setLoaded(null);
          setFailure(text);
          post({ type: "proto:error", message: text });
        }
      }
      setView(message.view);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") post({ type: "proto:escape" });
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKey);
    post({ type: "proto:ready" });
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // A screen change the DOM does not show (the same elements) still reports.
  useEffect(() => {
    requestAnimationFrame(() => watcher.current?.report());
  }, [view?.screenId, loaded]);

  if (failure) return <p role="alert">{failure}</p>;
  if (!loaded || !view) return null;
  return (
    <KitRoot
      key={loaded.generation}
      app={loaded.app}
      manifest={loaded.manifest}
      theme={theme}
      view={view}
      initialData={loaded.initialData}
      onNavigate={(screenId) => post({ type: "proto:navigate", screenId })}
      onToggle={(elementKey) => post({ type: "proto:toggle", elementKey })}
      onData={(data) => post({ type: "proto:data", data })}
      onError={(message) => post({ type: "proto:error", message })}
    />
  );
}

export function startFrame(theme: PrototypeTheme): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("the prototype frame document has no #root");
  createRoot(root).render(<Frame theme={theme} />);
}
