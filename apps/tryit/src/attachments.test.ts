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
import { mediaTypeOf, screenFiles, toAttachment } from "./attachments";

const MB = 1024 * 1024;
const file = (name: string, bytes: number, type = "") => new File([new Uint8Array(bytes)], name, { type });
const spec = { types: ["image/jpeg", "image/png", "application/pdf"], maxFiles: 3, maxFileSizeMB: 5 };

describe("screenFiles", () => {
  it("accepts a file within the spec", () => {
    expect(screenFiles([], [file("a.jpg", 10, "image/jpeg")], spec).accepted.map((f) => f.name)).toEqual(["a.jpg"]);
  });

  it("types a file by extension when the browser gives none", () => {
    expect(mediaTypeOf(file("RECEIPT.JPG", 10))).toBe("image/jpeg");
    expect(screenFiles([], [file("RECEIPT.JPG", 10)], spec).accepted).toHaveLength(1);
  });

  it("rejects a type the agent does not take, with a reason", () => {
    const r = screenFiles([], [file("photo.heic", 10, "image/heic")], spec);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0]).toEqual({ name: "photo.heic", reason: "this agent does not accept this type of file" });
  });

  it("rejects a file over the per-file size", () => {
    expect(screenFiles([], [file("big.pdf", 6 * MB, "application/pdf")], spec).rejected[0]?.reason).toBe("larger than 5 MB");
  });

  it("rejects files past the count", () => {
    const current = [file("1.jpg", 1, "image/jpeg"), file("2.jpg", 1, "image/jpeg"), file("3.jpg", 1, "image/jpeg")];
    expect(screenFiles(current, [file("4.jpg", 1, "image/jpeg")], spec).rejected[0]?.reason).toBe("at most 3 files per message");
  });

  it("rejects the file that takes the total past 15 MB", () => {
    const wide = { ...spec, maxFiles: 10 };
    const current = [file("1.pdf", 5 * MB, "application/pdf"), file("2.pdf", 5 * MB, "application/pdf"), file("3.pdf", 4 * MB, "application/pdf")];
    const r = screenFiles(current, [file("4.pdf", 2 * MB, "application/pdf")], wide);
    expect(r.rejected[0]).toEqual({ name: "4.pdf", reason: "the files together are over 15 MB" });
  });

  it("rejects a duplicate name", () => {
    expect(screenFiles([file("a.jpg", 1, "image/jpeg")], [file("a.jpg", 1, "image/jpeg")], spec).rejected[0]?.reason).toBe("already attached");
  });
});

describe("toAttachment", () => {
  it("base64-encodes the file", async () => {
    const a = await toAttachment(new File(["hi"], "n.pdf", { type: "application/pdf" }));
    expect(a).toEqual({ name: "n.pdf", mediaType: "application/pdf", data: "aGk=" });
  });
});
