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
 * Attachments follow the model. The turn's file parts — reference documents
 * read from the snapshot and chat attachments sent inline — are fitted to what
 * the connection reads BEFORE the turn starts, so a part the model cannot take
 * is a pre-stream 400 naming the file instead of a provider error mid-turn:
 *
 * - PDF: a native document part only when `capabilities.nativePdf` (Anthropic's
 *   own API). Everywhere else its text is extracted and sent as a `text/plain`
 *   part under the SAME file name, so the history dedupe and the journal's
 *   attachment names read it as the file it is. A PDF with no extractable text
 *   (a scan) is refused.
 * - Image: refused when `capabilities.imageInput` is `no`; `unknown` is sent and
 *   the provider's own error names the problem.
 * - Everything else (text) passes unchanged.
 */

import type { FilePart } from "ai";
import { extractText, getDocumentProxy } from "unpdf";
import type { ModelCapabilities } from "../shared/model.js";

/** A part the connection cannot take, named by its file. Maps to a pre-stream 400. */
export class AttachmentRefusedError extends Error {
  constructor(
    readonly filename: string,
    reason: string,
  ) {
    super(`${filename}: ${reason}`);
    this.name = "AttachmentRefusedError";
  }
}

/**
 * `parts` as the connection can read them, in order. Throws
 * `AttachmentRefusedError` for the first part it cannot send.
 */
export async function fitAttachments(
  parts: FilePart[],
  caps: Pick<ModelCapabilities, "nativePdf" | "imageInput">,
): Promise<FilePart[]> {
  const out: FilePart[] = [];
  for (const part of parts) out.push(await fitOne(part, caps));
  return out;
}

async function fitOne(part: FilePart, caps: Pick<ModelCapabilities, "nativePdf" | "imageInput">): Promise<FilePart> {
  const name = part.filename ?? "attachment";
  if (part.mediaType.startsWith("image/")) {
    if (caps.imageInput === "no") {
      throw new AttachmentRefusedError(name, "the model on this connection does not read images");
    }
    return part;
  }
  if (part.mediaType !== "application/pdf" || caps.nativePdf) return part;
  const text = await pdfText(part, name);
  if (text.trim() === "") {
    throw new AttachmentRefusedError(name, "the PDF has no extractable text (a scanned document?), and the model on this connection reads PDFs only as text");
  }
  return { type: "file", mediaType: "text/plain", data: Buffer.from(text, "utf8").toString("base64"), filename: name };
}

/** The PDF's text, pages joined. An unreadable PDF is refused, not guessed at. */
async function pdfText(part: FilePart, name: string): Promise<string> {
  try {
    const pdf = await getDocumentProxy(bytesOf(part.data));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } catch {
    throw new AttachmentRefusedError(name, "the file could not be read as a PDF");
  }
}

/** The part's bytes: both readers (snapshot references, inline chat attachments) carry base64. */
function bytesOf(data: FilePart["data"]): Uint8Array {
  if (typeof data === "string") return new Uint8Array(Buffer.from(data, "base64"));
  if (data instanceof Uint8Array) return data;
  throw new TypeError("a PDF attachment must carry its bytes");
}
