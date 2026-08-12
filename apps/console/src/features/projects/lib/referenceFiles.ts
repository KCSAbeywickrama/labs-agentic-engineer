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

import type { components } from "../../../generated/aep-api";

type WriteOp = components["schemas"]["WriteOp"];

// Reference documents attached on the create view (#383). Grilling decisions:
// text + PDF only (agents read PDFs natively; DOCX would need conversion
// tooling), 5 MB per file — the server's own apply cap, checked there on
// decoded bytes — and at most 10 files so the single atomic apply stays sane.
export const REFERENCES_DIR = "specs/requirements/references";
export const MAX_REFERENCE_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_REFERENCE_FILES = 10;
export const REFERENCE_ACCEPT = ".md,.txt,.pdf,.png,.jpg,.jpeg";

const TEXT_EXTENSIONS = new Set(["md", "txt"]);
const ACCEPTED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, "pdf", "png", "jpg", "jpeg"]);

export interface RejectedFile {
  name: string;
  reason: string;
}

function extensionOf(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
}

// Screens a selection against what is already attached: per-file type and
// size, the total count cap, and duplicate names. Rejections carry the reason
// verbatim for the UI — one notice per file, never a silent drop.
export function screenReferenceFiles(
  attached: File[],
  incoming: File[],
): { accepted: File[]; rejected: RejectedFile[] } {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];
  const names = new Set(attached.map((f) => f.name));
  let count = attached.length;
  for (const file of incoming) {
    if (!ACCEPTED_EXTENSIONS.has(extensionOf(file.name))) {
      rejected.push({
        name: file.name,
        reason: "Only .md, .txt, .pdf, .png, .jpg, .jpeg files are accepted",
      });
    } else if (file.size > MAX_REFERENCE_FILE_BYTES) {
      rejected.push({ name: file.name, reason: "Larger than 5 MB" });
    } else if (count >= MAX_REFERENCE_FILES) {
      rejected.push({
        name: file.name,
        reason: `At most ${MAX_REFERENCE_FILES} documents per project`,
      });
    } else if (names.has(file.name)) {
      rejected.push({ name: file.name, reason: "Already attached" });
    } else {
      accepted.push(file);
      names.add(file.name);
      count++;
    }
  }
  return { accepted, rejected };
}

// Repo-safe file name: the stem loses anything outside [a-z0-9._-]; the
// accepted extension survives as-is. Mirrors the server's canonical-path
// validation, which would 400 on spaces or traversal.
function sanitizeName(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = name
    .slice(0, dot)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${stem || "document"}${name.slice(dot).toLowerCase()}`;
}

function base64Of(bytes: Uint8Array): string {
  // btoa takes a byte string; chunk to keep the argument list bounded.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// The apply batch for one create's attachments: text rides as utf8, PDF as
// base64 (the WriteOp.encoding contract of BE handshake #384).
export async function toReferenceWrites(files: File[]): Promise<WriteOp[]> {
  return Promise.all(
    files.map(async (file) => {
      const path = `${REFERENCES_DIR}/${sanitizeName(file.name)}`;
      if (TEXT_EXTENSIONS.has(extensionOf(file.name))) {
        return { path, content: await file.text(), encoding: "utf8" as const };
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { path, content: base64Of(bytes), encoding: "base64" as const };
    }),
  );
}
