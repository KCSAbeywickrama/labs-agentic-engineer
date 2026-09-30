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
 * Files a tester attaches to a message. The agent enforces its own limits;
 * these checks only spare the tester a round trip, and say why a file was
 * turned away. The 15 MB total is the platform ceiling every agent shares.
 */
export interface AttachmentSpec {
  types: string[];
  maxFiles: number;
  maxFileSizeMB: number;
}

export interface Attachment {
  name: string;
  mediaType: string;
  data: string;
}

const MB = 1024 * 1024;
const TOTAL_CEILING_MB = 15;

const BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** The browser's type, or one read off the extension when the browser gives none. */
export function mediaTypeOf(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[extension] ?? "";
}

export function screenFiles(
  current: File[],
  added: File[],
  spec: AttachmentSpec,
): { accepted: File[]; rejected: { name: string; reason: string }[] } {
  const accepted: File[] = [];
  const rejected: { name: string; reason: string }[] = [];
  let count = current.length;
  let total = current.reduce((sum, f) => sum + f.size, 0);
  const names = new Set(current.map((f) => f.name));
  for (const file of added) {
    const reason = !spec.types.includes(mediaTypeOf(file))
      ? "this agent does not accept this type of file"
      : file.size > spec.maxFileSizeMB * MB
        ? `larger than ${spec.maxFileSizeMB} MB`
        : count >= spec.maxFiles
          ? `at most ${spec.maxFiles} files per message`
          : names.has(file.name)
            ? "already attached"
            : total + file.size > TOTAL_CEILING_MB * MB
              ? `the files together are over ${TOTAL_CEILING_MB} MB`
              : null;
    if (reason) {
      rejected.push({ name: file.name, reason });
      continue;
    }
    accepted.push(file);
    count += 1;
    total += file.size;
    names.add(file.name);
  }
  return { accepted, rejected };
}

/** The file as the base64 the agent expects, read the same way in every browser. */
export function toAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`could not read ${file.name}`));
    // A data URL is `data:<type>;base64,<data>` — keep only the data.
    reader.onload = () => {
      const url = String(reader.result);
      resolve({ name: file.name, mediaType: mediaTypeOf(file), data: url.slice(url.indexOf(",") + 1) });
    };
    reader.readAsDataURL(file);
  });
}
