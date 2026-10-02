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

/** What the host page is told when it loads, as JSON in `<script id="proto-config">`. Shared by the server and the host app. */

import type { PrototypeManifest } from "@wso2/prototype-kit/manifest";

/** One good revision of the prototype. */
export interface PrototypeRevision {
  manifest: PrototypeManifest;
  source: string;
  /** `prototypeHash` of the two files. */
  hash: string;
}

/** Live: the revision and findings arrive over `events`; the frame runtime from `frame-runtime.js`. */
export type HostConfig = { mode: "preview" };

export const HOST_CONFIG_ID = "proto-config";
