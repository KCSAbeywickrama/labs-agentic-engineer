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

import { useEffect, useRef, useState } from "react";

/**
 * Counts design.cell rewrite bursts. An architectural chat change rewrites the
 * file as `removeFile` + one streamed `addFile` (the only sequence that
 * re-streams the live diagram), and the removeFile deletes the doc's Y.Map
 * entry — so the live string transitions non-empty → null exactly once per
 * rewrite, while the re-streamed content never re-fires. The count lets the
 * spec view navigate to the Architecture tab once per rewrite without yanking
 * the user back on every streamed line.
 *
 * `active` gates the signal to a live agent turn (agent peer in a CONNECTED
 * room): a collab disconnect also nulls the text, but drops `active` in the
 * same render, so it never counts as a rewrite.
 */
export function useDesignCellRewriteCount(
  live: string | null,
  active: boolean,
): number {
  const prevRef = useRef(live);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = live;
    if (active && prev !== null && prev.trim() !== "" && live === null) {
      setCount((c) => c + 1);
    }
  }, [live, active]);
  return count;
}
