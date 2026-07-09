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

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { CellDiagramProject } from "@aep/design-projection";
import { deriveCellDiagramProject } from "../derive/deriveCellDiagram";
import { deriveWireframeScene } from "../derive/deriveWireframe";
import { fetchSpecFileContent } from "./queries";
import { specKeys } from "./keys";
import { toRepoPath, type SpecFileEntry } from "./mapping";

/** The component design.json entries (drives both the fetch set and the memo key). */
function designJsonEntries(files: SpecFileEntry[]): SpecFileEntry[] {
  return files
    .filter((f) => f.group === "designs" && f.path.endsWith("/design.json"))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function useDerivedCellDiagram(
  projectName: string,
  files: SpecFileEntry[],
): { project: CellDiagramProject | null; isPending: boolean; isError: boolean } {
  const entries = useMemo(() => designJsonEntries(files), [files]);

  const results = useQueries({
    queries: entries.map((f) => ({
      queryKey: specKeys.file(projectName, f.path, f.sha),
      staleTime: Infinity,
      queryFn: () => fetchSpecFileContent(projectName, f),
    })),
  });

  const isPending = results.some((r) => r.isPending);
  const isError = results.some((r) => r.isError);
  const dataKey = results.map((r) => r.data?.sha).join(",");

  const project = useMemo(() => {
    if (isPending || isError) return null;
    const byRepoPath: Record<string, string> = {};
    entries.forEach((f, i) => {
      const content = results[i]?.data?.content;
      if (typeof content === "string") byRepoPath[toRepoPath(f.path)] = content;
    });
    return deriveCellDiagramProject(byRepoPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, isPending, isError, dataKey]);

  return { project, isPending, isError };
}

export function useDerivedWireframe(
  projectName: string,
  dslPath: string,
  sha: string | undefined,
): { scene: string | null; isPending: boolean; isError: boolean } {
  const q = useQuery({
    queryKey: specKeys.file(projectName, dslPath, sha ?? ""),
    enabled: Boolean(sha),
    staleTime: Infinity,
    queryFn: () => fetchSpecFileContent(projectName, { path: dslPath, sha: sha ?? "" }),
  });
  const scene =
    q.data?.content != null ? deriveWireframeScene(dslPath, q.data.content) : null;
  return { scene, isPending: q.isPending, isError: q.isError };
}
