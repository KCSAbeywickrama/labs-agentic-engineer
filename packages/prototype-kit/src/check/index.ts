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
 * `@wso2/prototype-kit/check`: the whole prototype check, in the order an
 * author fixes things. Each stage runs only when the earlier ones pass.
 */

import type { Finding } from "../findings.js";
import { missingFileFindings, readPrototypeFiles, type PrototypeFiles } from "./files.js";

export { FINDING_CODES, MANIFEST_FILE, SOURCE_FILE, type Finding, type FindingCode, type FindingFile } from "../findings.js";
export { readPrototypeFiles, type PrototypeFiles } from "./files.js";

export function checkPrototypeFiles(files: PrototypeFiles): Finding[] {
  if (files.manifest === null || files.source === null) return missingFileFindings(files);
  return [];
}

/** Every finding for the prototype folder `dir`; empty when it is ready to preview. */
export function checkPrototype(dir: string): Finding[] {
  return checkPrototypeFiles(readPrototypeFiles(dir));
}
