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

import { describe, expect, it } from "vitest";
import { base64ToBlob, referenceFileKind, referenceMimeType } from "./referencePreview";

describe("referenceFileKind", () => {
  it("classifies by extension, case-insensitively", () => {
    expect(referenceFileKind("specs/requirements/references/spec.pdf")).toBe(
      "pdf",
    );
    expect(referenceFileKind("specs/requirements/references/SPEC.PDF")).toBe(
      "pdf",
    );
    expect(referenceFileKind("specs/requirements/references/notes.md")).toBe(
      "markdown",
    );
    expect(referenceFileKind("specs/requirements/references/notes.txt")).toBe(
      "text",
    );
  });

  it("falls back to text for an unrecognized extension", () => {
    expect(referenceFileKind("specs/requirements/references/data.csv")).toBe(
      "text",
    );
  });

  it("falls back to text for a path with no extension", () => {
    expect(referenceFileKind("specs/requirements/references/README")).toBe(
      "text",
    );
  });
});

describe("referenceMimeType", () => {
  it("maps each kind to the mime type its preview needs", () => {
    expect(referenceMimeType("pdf")).toBe("application/pdf");
    expect(referenceMimeType("markdown")).toBe("text/markdown");
    expect(referenceMimeType("text")).toBe("text/plain");
  });
});

describe("base64ToBlob", () => {
  it("decodes base64 into a Blob carrying the exact byte length and mime type", async () => {
    const raw = "%PDF-1.4\nhello";
    const blob = base64ToBlob(btoa(raw), "application/pdf");

    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBe(raw.length);
    expect(await blob.text()).toBe(raw);
  });

  it("round-trips binary (non-UTF8) bytes byte-for-byte — the PDF preview path", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe, 0x00, 0x7f]);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const blob = base64ToBlob(btoa(binary), "application/pdf");

    const roundTripped = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(roundTripped)).toEqual(Array.from(bytes));
  });
});
