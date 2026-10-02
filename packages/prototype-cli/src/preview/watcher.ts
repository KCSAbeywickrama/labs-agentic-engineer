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
 * The prototype the preview serves: its two files, checked on every change.
 * The last revision that passed the check is kept, so a half-written
 * revision shows its findings without taking the good render away.
 */

import { watch, type FSWatcher } from "node:fs";
import { parseManifestJson } from "@wso2/prototype-kit/manifest";
import { MANIFEST_FILE, SOURCE_FILE, checkPrototypeFiles, readPrototypeFiles, type Finding, type ThemeRuntimes } from "@wso2/prototype-kit/check";
import { prototypeHash } from "../hash.js";
import type { PrototypeRevision } from "../host-config.js";

/** How long the files must be quiet before a change is checked (an editor may write in several steps). */
const SETTLE_MS = 120;

export interface PrototypeStatus {
  /** The latest revision that passed the check; null until one does. */
  lastGood: PrototypeRevision | null;
  /** The current files' findings; empty when they are `lastGood`. */
  findings: Finding[];
}

export class PrototypeWatcher {
  private current: PrototypeStatus = { lastGood: null, findings: [] };
  private signature = "";
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dir: string,
    private readonly theme: ThemeRuntimes,
    private readonly onChange: (status: PrototypeStatus) => void,
  ) {}

  status(): PrototypeStatus {
    return this.current;
  }

  /** Read and check the files now; reports a change when the files or their findings differ. */
  refresh(): void {
    const files = readPrototypeFiles(this.dir);
    const signature = `${files.manifest ?? "\u0000missing"}\u0001${files.source ?? "\u0000missing"}`;
    if (signature === this.signature) return;
    this.signature = signature;
    const findings = checkPrototypeFiles(files, { theme: this.theme });
    let lastGood = this.current.lastGood;
    if (findings.length === 0 && files.manifest !== null && files.source !== null) {
      const parsed = parseManifestJson(files.manifest);
      if (parsed.ok) lastGood = { manifest: parsed.manifest, source: files.source, hash: prototypeHash(files.manifest, files.source) };
    }
    this.current = { lastGood, findings };
    this.onChange(this.current);
  }

  /** Watch the folder; a change to either file is checked once the files settle. */
  start(): void {
    this.watcher = watch(this.dir, (_event, name) => {
      if (name !== null && name !== MANIFEST_FILE && name !== SOURCE_FILE) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.refresh();
      }, SETTLE_MS);
    });
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.watcher?.close();
  }
}
