/**
 * `@wso2/prototype-kit/check`: the whole prototype check, in the order an
 * author fixes things — the files, the manifest's shape and references, the
 * source's static rules, then the source's literal references into the
 * manifest. Each stage runs only when the earlier ones pass.
 */

import type { Finding } from "../findings.js";
import { parseManifestJson } from "../manifest/parse.js";
import { sourceReferenceFindings } from "../source/references.js";
import { checkSource } from "../source/static-check.js";
import { missingFileFindings, readPrototypeFiles, type PrototypeFiles } from "./files.js";

export { FINDING_CODES, MANIFEST_FILE, SOURCE_FILE, type Finding, type FindingCode, type FindingFile } from "../findings.js";
export { readPrototypeFiles, type PrototypeFiles } from "./files.js";

export function checkPrototypeFiles(files: PrototypeFiles): Finding[] {
  if (files.manifest === null || files.source === null) return missingFileFindings(files);
  const manifest = parseManifestJson(files.manifest);
  if (!manifest.ok) return manifest.findings;
  const staticFindings = checkSource(files.source);
  if (staticFindings.length > 0) return staticFindings;
  return sourceReferenceFindings(files.source, manifest.manifest);
}

/** Every finding for the prototype folder `dir`; empty when it is ready to preview. */
export function checkPrototype(dir: string): Finding[] {
  return checkPrototypeFiles(readPrototypeFiles(dir));
}
