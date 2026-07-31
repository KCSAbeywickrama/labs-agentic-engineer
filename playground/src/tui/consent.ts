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
 * The coding-agent first-run consent (§12): the coding path runs
 * bypassPermissions ON THE HOST, so the very first run must be confirmed
 * interactively (a restorable undo snapshot is taken regardless). Shared by the
 * CLI driver and the chat loop so the prompt wording can't drift; refuses in
 * headless mode, where `--yes` is the only consent channel.
 */

import * as clack from "@clack/prompts";

/** A `confirmDir` callback for `codeCommand`. */
export function confirmCodingDir(projectDir: string): () => Promise<boolean> {
  return async () => {
    if (!process.stdin.isTTY) return false;
    const ok = await clack.confirm({
      message: `The coding agent runs with permissions BYPASSED and will write inside ${projectDir}. A restorable undo snapshot is taken first. Continue?`,
    });
    return !clack.isCancel(ok) && ok;
  };
}
