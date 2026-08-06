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

// The PRD's Open Questions gate (#365/#372): a question neither answered nor
// explicitly deferred blocks /design. This parse mirrors the contract's
// section shape — numbered entries under "## Open Questions", a deferral
// marked by the word "deferred" in the entry.

/** Count the PRD's open, undeferred questions. 0 for a missing section. */
export function countBlockingOpenQuestions(prd: string): number {
  const lines = prd.split(/\r?\n/);
  let inSection = false;
  let count = 0;
  let currentBlocking = false;
  const settle = () => {
    if (currentBlocking) count++;
    currentBlocking = false;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      settle();
      inSection = /^##\s+open questions/i.test(line);
      continue;
    }
    if (!inSection) continue;
    if (/^\d+\./.test(line)) {
      settle();
      currentBlocking = !/deferred/i.test(line);
    } else if (currentBlocking && /deferred/i.test(line)) {
      // A deferral marked on the entry's continuation lines still counts.
      currentBlocking = false;
    }
  }
  settle();
  return count;
}
