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
 * The preview server: the host page, the theme's frame runtime and an event
 * stream of revisions and findings. Local only — it binds 127.0.0.1 and
 * answers only requests addressed to it by that name or `localhost` (no DNS
 * rebinding).
 */

import { readFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ThemeRuntimes } from "@wso2/prototype-kit/check";
import { HOST_SCRIPT_PATH } from "../assets.js";
import { renderHostPage } from "../host-page.js";
import { EventStream, type ServerEvent } from "./sse.js";
import { PrototypeWatcher, type PrototypeStatus } from "./watcher.js";

export interface PreviewServerOptions {
  dir: string;
  /** 0 picks a free port. */
  port: number;
  persist: boolean;
  theme: ThemeRuntimes;
}

export interface RunningPreview {
  url: string;
  close(): Promise<void>;
}

function statusEvents(status: PrototypeStatus): ServerEvent[] {
  return [...(status.lastGood ? [{ event: "update", data: status.lastGood }] : []), { event: "findings", data: { findings: status.findings } }];
}

/** Serve a file read per request; one that cannot be read answers 500 and never takes the server down. */
function sendFile(res: ServerResponse, path: string): void {
  let body: Buffer;
  try {
    body = readFileSync(path);
  } catch {
    return send(res, 500, "text/plain", "the preview could not read one of its own files");
  }
  send(res, 200, "text/javascript; charset=utf-8", body);
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}

export async function startPreviewServer(options: PreviewServerOptions): Promise<RunningPreview> {
  const events = new EventStream();
  const watcher = new PrototypeWatcher(options.dir, options.theme, (status) => statusEvents(status).forEach((e) => events.send(e)));
  watcher.refresh();

  let port = 0;
  const hosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const server = createServer((req, res) => {
    if (!hosts().has(req.headers.host ?? "")) return send(res, 403, "text/plain", "the preview answers only on 127.0.0.1 and localhost");
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && path === "/") {
      const title = watcher.status().lastGood?.manifest.name ?? "Prototype";
      return send(res, 200, "text/html; charset=utf-8", renderHostPage(`${title} — prototype preview`, { mode: "preview", persist: options.persist }));
    }
    if (req.method === "GET" && path === "/host.js") return sendFile(res, HOST_SCRIPT_PATH);
    if (req.method === "GET" && path === "/frame-runtime.js") return sendFile(res, options.theme.frameRuntimePath);
    if (req.method === "GET" && path === "/events") return events.attach(req, res, statusEvents(watcher.status()));
    send(res, 404, "text/plain", "not found");
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, "127.0.0.1", () => resolve());
    });
  } catch (e) {
    events.close();
    throw e;
  }
  port = (server.address() as AddressInfo).port;
  try {
    watcher.start();
  } catch (e) {
    events.close();
    server.close();
    throw e;
  }

  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        watcher.stop();
        events.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
