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

/** The preview host: the live prototype in a browser window, under the review's pickers. */

import { useCallback, useEffect, useRef, useState } from "react";
import { PrototypeFrame, frameViewOf, initialPrototypeView, reducePrototypeView, type PrototypeViewEvent } from "@wso2/prototype-kit/host";
import type { HostConfig, PrototypeRevision } from "../host-config.js";
import { BrowserWindow } from "./BrowserWindow.js";
import { useLivePrototype } from "./live.js";
import { HOST_CSS } from "./styles.js";
import { Toolbar } from "./Toolbar.js";

export function App({ config }: { config: HostConfig }) {
  const live = useLivePrototype(config);
  const waiting = live.error ?? (live.findings.length > 0 ? "The prototype has check findings; it shows once they are fixed." : "Loading the prototype…");
  return (
    <div className="ph-app">
      <style>{HOST_CSS}</style>
      {live.revision && live.runtime ? <Review runtime={live.runtime} revision={live.revision} /> : <p className="ph-waiting">{waiting}</p>}
    </div>
  );
}

function Review({ runtime, revision }: { runtime: string; revision: PrototypeRevision }) {
  const { manifest } = revision;
  const [view, setView] = useState(() => initialPrototypeView(manifest));
  const dispatch = useCallback((event: PrototypeViewEvent) => setView((v) => reducePrototypeView(manifest, v, event)), [manifest]);
  const shown = useRef(manifest);
  useEffect(() => {
    if (shown.current === manifest) return;
    shown.current = manifest;
    dispatch({ type: "MANIFEST_REPLACED", manifest });
  }, [manifest, dispatch]);

  return (
    <>
      <Toolbar manifest={manifest} view={view} dispatch={dispatch} />
      <div className="ph-body">
        <BrowserWindow title={manifest.name} address={`prototype://${view.screenId}`}>
          <PrototypeFrame
            title={manifest.name}
            runtime={runtime}
            manifest={manifest}
            source={revision.source}
            version={revision.hash}
            view={frameViewOf(view)}
            onNavigate={(screenId) => dispatch({ type: "NAVIGATE", screenId })}
            onToggle={(elementKey) => dispatch({ type: "TOGGLE_SELECTION", elementKey })}
            onEscape={() => dispatch({ type: "CLEAR_SELECTION" })}
            onElements={() => {}}
          />
        </BrowserWindow>
      </div>
    </>
  );
}
