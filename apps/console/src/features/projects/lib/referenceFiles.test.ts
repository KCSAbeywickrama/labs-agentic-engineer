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
import {
  MAX_REFERENCE_FILES,
  MAX_REFERENCE_FILE_BYTES,
  REFERENCES_DIR,
  screenReferenceFiles,
  toReferenceWrites,
} from "./referenceFiles";

function file(name: string, content: string | Uint8Array<ArrayBuffer>, type = ""): File {
  return new File([content], name, { type });
}

describe("screenReferenceFiles", () => {
  it("accepts .md, .txt, and .pdf", () => {
    const { accepted, rejected } = screenReferenceFiles(
      [],
      [file("prd.md", "# PRD"), file("notes.txt", "notes"), file("spec.pdf", "x")],
    );
    expect(accepted.map((f) => f.name)).toEqual([
      "prd.md",
      "notes.txt",
      "spec.pdf",
    ]);
    expect(rejected).toEqual([]);
  });

  it("rejects other extensions with a reason naming the accepted set", () => {
    const { accepted, rejected } = screenReferenceFiles(
      [],
      [file("spec.docx", "x")],
    );
    expect(accepted).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.name).toBe("spec.docx");
    expect(rejected[0]?.reason).toMatch(/\.md, \.txt, \.pdf/);
  });

  it("rejects a file over the size cap", () => {
    const big = new Uint8Array(MAX_REFERENCE_FILE_BYTES + 1);
    const { accepted, rejected } = screenReferenceFiles(
      [],
      [file("big.pdf", big)],
    );
    expect(accepted).toEqual([]);
    expect(rejected[0]?.reason).toMatch(/5 MB/);
  });

  it("rejects files past the count cap, counting already-attached ones", () => {
    const existing = Array.from({ length: MAX_REFERENCE_FILES - 1 }, (_, i) =>
      file(`doc-${i}.md`, "x"),
    );
    const { accepted, rejected } = screenReferenceFiles(existing, [
      file("fits.md", "x"),
      file("overflow.md", "x"),
    ]);
    expect(accepted.map((f) => f.name)).toEqual(["fits.md"]);
    expect(rejected[0]?.name).toBe("overflow.md");
    expect(rejected[0]?.reason).toMatch(/10/);
  });

  it("rejects a duplicate of an already-attached file name", () => {
    const { accepted, rejected } = screenReferenceFiles(
      [file("prd.md", "old")],
      [file("prd.md", "new")],
    );
    expect(accepted).toEqual([]);
    expect(rejected[0]?.reason).toMatch(/[Aa]lready attached/);
  });

  it("accepts images (.png, .jpg, .jpeg) — mockups and screenshots are references too", () => {
    const { accepted, rejected } = screenReferenceFiles(
      [],
      [file("mockup.png", "x"), file("photo.jpg", "x"), file("scan.JPEG", "x")],
    );
    expect(accepted.map((f) => f.name)).toEqual(["mockup.png", "photo.jpg", "scan.JPEG"]);
    expect(rejected).toEqual([]);
  });

  // Two names, one repo path: the apply batch would write the path twice and
  // the second write would silently replace the first document.
  it("rejects a name that sanitizes onto an attached document's path", () => {
    const { accepted, rejected } = screenReferenceFiles(
      [file("prd.md", "old")],
      [file("PRD.md", "new")],
    );
    expect(accepted).toEqual([]);
    expect(rejected[0]?.name).toBe("PRD.md");
    expect(rejected[0]?.reason).toMatch(/prd\.md/);
  });

  it("rejects the second of two incoming names that sanitize to one path", async () => {
    const { accepted, rejected } = screenReferenceFiles(
      [],
      [file("my notes.md", "a"), file("my-notes.md", "b")],
    );
    expect(accepted.map((f) => f.name)).toEqual(["my notes.md"]);
    expect(rejected[0]?.name).toBe("my-notes.md");
    const writes = await toReferenceWrites(accepted);
    expect(new Set(writes.map((w) => w.path)).size).toBe(writes.length);
  });
});

describe("toReferenceWrites", () => {
  it("writes images as base64, byte-exact — same channel as PDF", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xd8]);
    const writes = await toReferenceWrites([file("mockup.png", bytes, "image/png")]);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe(`${REFERENCES_DIR}/mockup.png`);
    expect(writes[0]?.encoding).toBe("base64");
    const decoded = Uint8Array.from(atob(writes[0]!.content), (c) => c.charCodeAt(0));
    expect([...decoded]).toEqual([...bytes]);
  });

  it("writes text files as utf8 under the references dir", async () => {
    const writes = await toReferenceWrites([file("prd.md", "# The PRD")]);
    expect(writes).toEqual([
      {
        path: `${REFERENCES_DIR}/prd.md`,
        content: "# The PRD",
        encoding: "utf8",
      },
    ]);
  });

  it("writes PDFs as base64 of the raw bytes", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0x00, 0x7f]);
    const writes = await toReferenceWrites([file("spec.pdf", bytes)]);
    expect(writes[0]?.path).toBe(`${REFERENCES_DIR}/spec.pdf`);
    expect(writes[0]?.encoding).toBe("base64");
    const decoded = Uint8Array.from(atob(writes[0]!.content), (c) =>
      c.charCodeAt(0),
    );
    expect(decoded).toEqual(bytes);
  });

  it("sanitizes file names into safe repo paths", async () => {
    const writes = await toReferenceWrites([
      file("my draft (v2)!.md", "draft"),
    ]);
    expect(writes[0]?.path).toBe(`${REFERENCES_DIR}/my-draft-v2.md`);
  });
});
