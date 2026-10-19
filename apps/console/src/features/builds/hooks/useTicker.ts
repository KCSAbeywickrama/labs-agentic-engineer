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

import { useEffect, useState } from "react";

/** One second — the resolution an age renders at ("12.0s", "3m4s"). */
const TICK_MS = 1000;

/**
 * Re-render once a second while `active`, so a duration measured against
 * `Date.now()` actually counts.
 *
 * The feed is NOT enough on its own, which is the bug this exists for: a run
 * that has gone quiet sends nothing, so nothing re-renders, and an agent's
 * "quiet for 3s" sits frozen at whatever it read on first paint — the precise
 * lie the crew view exists to stop telling. The clock has to come from a clock.
 *
 * Returns nothing on purpose: callers read `Date.now()` through their existing
 * formatter, and a returned timestamp would invite a second source of "now".
 */
export function useTicker(active: boolean): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => force((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [active]);
}
