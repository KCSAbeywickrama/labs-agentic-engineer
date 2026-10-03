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
 * The write gate for a web-application's prototype: its manifest
 * `specs/design/components/<component>/prototype.json` and its screens
 * `prototype.tsx` beside it, a React module over `@wso2/prototype-kit`.
 *
 * The rules are the kit's, the same ones `prototype check` and the Go save gate
 * apply: the manifest's JSON, version, shape and references (`/manifest`), then
 * the source's static rules and its literal references into the manifest
 * (`/source`). Drawing every screen executes the generated module, so this
 * package does not: the host passes a `PrototypeRenderCheck` (the agents service
 * passes the kit's isolated one) and, without one, the source gets its static
 * checks only.
 *
 * The manifest comes first: `prototype.tsx` is judged against the manifest the
 * bundle holds, so a screen is added or dropped in `prototype.json` and then
 * drawn in `prototype.tsx`.
 *
 * Every refusal is `INVALID_PROTOTYPE` with the kit's findings, each keeping its
 * own code and place (`UNKNOWN_REFERENCE at flows[0].screenIds[1]`,
 * `FORBIDDEN_API at line 12`), because the place is what the model fixes.
 */

import { parseManifestJson } from "@wso2/prototype-kit/manifest";
import { checkSource, sourceReferenceFindings } from "@wso2/prototype-kit/source";
import type { PrototypeFinding } from "./contracts/sse-events.js";

export interface PrototypeProblem {
  code: "INVALID_PROTOTYPE";
  message: string;
  findings: PrototypeFinding[];
}

/** The two files of a prototype that passed the static checks, as text. */
export interface PrototypeFileTexts {
  manifest: string;
  source: string;
}

/** Draws every screen for every role and display state; returns what failed to. */
export type PrototypeRenderCheck = (files: PrototypeFileTexts) => PrototypeFinding[];

/** Reads the bundle, for the source's manifest. */
export interface PrototypeReader {
  read(path: string): string | undefined;
}

const PROTOTYPE_PATH = /^specs\/design\/components\/[^/]+\/prototype\.(json|tsx)$/;

/** Same move as every other gate: a refused write created nothing to edit. */
const REMEDY =
  "The write was refused and the file is unchanged. Fix every finding and retry: an editFile for a local " +
  "fix, or ONE addFile of the whole corrected file (removeFile first only if the file already existed).";

/** How many findings a refusal lists in its message before summarizing the rest. */
const MAX_LISTED = 8;

/**
 * Validate a candidate body for `path`. Returns null when `path` is not a
 * prototype file or the content is valid; otherwise the problem, phrased for the
 * model's self-correction.
 */
export function checkPrototype(
  path: string,
  content: string,
  bundle: PrototypeReader,
  render?: PrototypeRenderCheck,
): PrototypeProblem | null {
  const kind = PROTOTYPE_PATH.exec(path)?.[1];
  if (kind === undefined) return null;
  if (kind === "json") {
    const manifest = parseManifestJson(content);
    return manifest.ok ? null : refuse(`${path} is not a valid prototype manifest`, manifest.findings);
  }

  const manifestPath = path.replace(/prototype\.tsx$/, "prototype.json");
  const manifestText = bundle.read(manifestPath);
  if (manifestText === undefined) {
    return refuse(`${path} is checked against its manifest`, [
      {
        code: "MISSING_FILE",
        file: "prototype.json",
        location: "(file)",
        message: `${manifestPath} does not exist yet; write it first (roles, states, screens, flows), then ${path}`,
      },
    ]);
  }
  const manifest = parseManifestJson(manifestText);
  if (!manifest.ok) {
    return refuse(`${path} is checked against ${manifestPath}, which is not valid; fix it first`, manifest.findings);
  }
  const staticFindings = checkSource(content);
  if (staticFindings.length > 0) return refuse(`${path} is not a valid prototype`, staticFindings);
  const references = sourceReferenceFindings(content, manifest.manifest);
  if (references.length > 0) return refuse(`${path} is not a valid prototype`, references);
  const rendered = render?.({ manifest: manifestText, source: content }) ?? [];
  return rendered.length > 0 ? refuse(`${path} is not a valid prototype`, rendered) : null;
}

function refuse(subject: string, findings: PrototypeFinding[]): PrototypeProblem {
  const listed = findings.slice(0, MAX_LISTED).map((f) => `${f.code} in ${f.file} at ${f.location}: ${f.message}`);
  const more = findings.length - listed.length;
  const detail = more > 0 ? `${listed.join("; ")}; and ${more} more` : listed.join("; ");
  return { code: "INVALID_PROTOTYPE", message: `${subject} - ${detail}. ${REMEDY}`, findings };
}
