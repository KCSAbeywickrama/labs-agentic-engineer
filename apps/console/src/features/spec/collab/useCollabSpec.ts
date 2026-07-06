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

import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";

// Console side of #86 phase 5: connect the spec view to the collab service.
// One room + one Y.Doc per project (`spec-<org>-<project>`), Y.Map('files')
// of path → Y.Text. If no collab server is reachable the view degrades to
// solo (#86 decision 10) — callers keep their non-collaborative fallback.
//
// Until auth lands the connection identifies as the AppLayout dev user via a
// JWT-shaped unsigned token (the collab mock BFF reads name/email claims;
// the real oracle will verify a real JWT here instead).

export interface CollabPeer {
  clientId: number;
  name: string;
  color: string;
  kind: "user" | "agent";
}

export type CollabStatus = "connecting" | "connected" | "offline";

export interface CollabSpec {
  status: CollabStatus;
  peers: CollabPeer[];
  /** Y.Text for a path, once synced; null → caller falls back to REST content. */
  getFileText: (path: string) => Y.Text | null;
  /** True while a transaction originates from this client (binding helper). */
  isLocalTransaction: (transaction: Y.Transaction) => boolean;
  /** Bumped on any files-map change so selections can re-resolve. */
  version: number;
}

const PEER_COLORS = [
  "#e57373", "#64b5f6", "#81c784", "#ffb74d",
  "#ba68c8", "#4dd0e1", "#f06292", "#aed581",
];

// TODO(auth): replace with the session token when platform auth lands.
function devToken(name: string, email: string): string {
  const b64 = (v: unknown) =>
    btoa(JSON.stringify(v))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
  return `${b64({ alg: "none" })}.${b64({ name, email })}.dev`;
}

function collabWsUrl(): string {
  const env = (window as { _env_?: { collabWsUrl?: string } })._env_;
  if (env?.collabWsUrl) return env.collabWsUrl;
  if (import.meta.env.DEV) return "ws://localhost:8091";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/collab`;
}

// TODO(auth): org comes from the session once auth lands; the collab mock
// BFF's default org is used until then.
const DEV_ORG = "acme";

export function useCollabSpec(
  projectName: string,
  user: { name: string; email: string },
): CollabSpec {
  const [status, setStatus] = useState<CollabStatus>("connecting");
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [version, setVersion] = useState(0);
  const docRef = useRef<Y.Doc | null>(null);

  useEffect(() => {
    const doc = new Y.Doc();
    docRef.current = doc;
    const provider = new HocuspocusProvider({
      url: collabWsUrl(),
      name: `spec-${DEV_ORG}-${projectName}`,
      document: doc,
      token: devToken(user.name, user.email),
      onSynced: () => setStatus("connected"),
      onStatus: ({ status: s }) => {
        if (s === "disconnected") setStatus("offline");
      },
      onAuthenticationFailed: () => setStatus("offline"),
    });

    provider.setAwarenessField("user", {
      name: user.name,
      color: PEER_COLORS[doc.clientID % PEER_COLORS.length],
      kind: "user",
    });
    const awareness = provider.awareness;
    const onAwareness = () => {
      if (!awareness) return;
      const list: CollabPeer[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === doc.clientID) return;
        const u = (state as { user?: Partial<CollabPeer> }).user;
        if (!u?.name) return;
        list.push({
          clientId,
          name: u.name,
          color: u.color ?? PEER_COLORS[clientId % PEER_COLORS.length] ?? "#888",
          kind: u.kind === "agent" ? "agent" : "user",
        });
      });
      setPeers(list);
    };
    awareness?.on("change", onAwareness);

    const files = doc.getMap<Y.Text>("files");
    const onFiles = () => setVersion((v) => v + 1);
    files.observeDeep(onFiles);

    provider.attach();
    return () => {
      files.unobserveDeep(onFiles);
      awareness?.off("change", onAwareness);
      provider.destroy();
      doc.destroy();
      docRef.current = null;
    };
  }, [projectName, user.name, user.email]);

  return useMemo(
    () => ({
      status,
      peers,
      version,
      getFileText: (path: string) =>
        status === "connected"
          ? (docRef.current?.getMap<Y.Text>("files").get(path) ?? null)
          : null,
      isLocalTransaction: (transaction: Y.Transaction) => transaction.local,
    }),
    [status, peers, version],
  );
}
