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

// Returns the URL only when it is a safe, absolute http(s) link; otherwise
// undefined, so callers render plain text instead of a clickable link. Blocks
// javascript:/data:/vbscript: and other script-bearing URI schemes (XSS) that
// could arrive in an untrusted design.json.
export function safeHref(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined; // relative or malformed — not a safe absolute link
  }
  return url.protocol === "http:" || url.protocol === "https:" ? raw : undefined;
}
