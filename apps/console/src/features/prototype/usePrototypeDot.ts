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

import { useEffect, useMemo, useReducer, useState } from "react";
import { prototypeHash } from "./model/feedback";
import { subscribeReviewed, unreviewed } from "./model/reviewed";
import { usePrototypes } from "./usePrototypes";

/**
 * Whether the Prototype tab has news: a prototype is written whose current
 * revision this browser has not opened in a review yet. A revision the agent
 * writes later shows it again.
 */
export function usePrototypeDot(projectName: string): boolean {
  const prototypes = usePrototypes(projectName);
  // The revisions on offer, keyed by their files so a hash is worked out once per revision.
  const revisions = useMemo(
    () =>
      (prototypes ?? []).flatMap((p) =>
        p.files ? [{ component: p.component, manifestText: p.files.manifestText, source: p.files.source }] : [],
      ),
    [prototypes],
  );
  const [hashes, setHashes] = useState<Record<string, string>>({});
  const [, recheck] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let live = true;
    void Promise.all(revisions.map(async (r) => [r.component, await prototypeHash(r.manifestText, r.source)] as const)).then(
      (pairs) => live && setHashes(Object.fromEntries(pairs)),
    );
    return () => {
      live = false;
    };
  }, [revisions]);
  useEffect(() => subscribeReviewed(recheck), []);

  return unreviewed(projectName, hashes).length > 0;
}
