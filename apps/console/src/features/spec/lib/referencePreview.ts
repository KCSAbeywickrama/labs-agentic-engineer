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

// Pure helpers behind the reference-document preview (#383 FE): what kind of
// viewer a reference file gets, and the base64 -> Blob decode PDF preview
// needs. Kept dependency-free (no React, no DOM beyond the Blob/atob globals
// every runtime — browser + Node >=18 — already provides) so both are unit
// tested directly, without mounting anything.

export type ReferenceFileKind = "pdf" | "markdown" | "text";

function extensionOf(path: string): string {
  const base = path.split("/").at(-1) ?? path;
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

// Classifies a reference document by its extension for the list icon and the
// preview dialog's renderer choice. Anything not recognized as markdown or
// PDF previews as plain text — the safe default for the .md/.txt/.pdf upload
// contract (referenceFiles.ts), and for any file the mock/fixture layer adds.
export function referenceFileKind(path: string): ReferenceFileKind {
  const ext = extensionOf(path);
  if (ext === "pdf") return "pdf";
  if (ext === "md") return "markdown";
  return "text";
}

const MIME_TYPE_BY_KIND: Record<ReferenceFileKind, string> = {
  pdf: "application/pdf",
  markdown: "text/markdown",
  text: "text/plain",
};

export function referenceMimeType(kind: ReferenceFileKind): string {
  return MIME_TYPE_BY_KIND[kind];
}

// Decodes a FileContent.content string that arrived as `encoding: "base64"`
// (the binary-read half of #384's WriteOp.encoding contract) into a Blob
// carrying the file's real bytes — what URL.createObjectURL needs for the
// PDF <object> preview. atob + a byte-by-byte Uint8Array walk (not
// TextEncoder, which would re-interpret the binary string as UTF-8 and
// corrupt it) keeps this byte-exact for arbitrary binary content.
export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}
