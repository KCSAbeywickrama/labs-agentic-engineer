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

import type React from "react";
import { lazy, memo, Suspense } from "react";
import type { Project } from "@wso2/cell-diagram";
import type { CellDiagramProject } from "@aep/design-projection";
import { Box, CircularProgress, Typography } from "@wso2/oxygen-ui";

const CellDiagram = lazy(() =>
  import("@wso2/cell-diagram").then((m) => ({ default: m.CellDiagram })),
);

export interface CellDiagramViewProps {
  /**
   * Whole-architecture projection from `@aep/design-projection`
   * (`toCellDiagramProject(buildProjectDesign(...))`). Structurally a
   * `@wso2/cell-diagram` `Project`; the only divergence is `type: string` vs
   * the lib's `ComponentType` enum, which the diagram accepts — hence the
   * single internal cast. `null`/absent renders the empty state.
   */
  project?: CellDiagramProject | null;
  /** Optional override for the empty-state copy. */
  emptyState?: React.ReactNode;
}

export const CellDiagramView = memo(function CellDiagramView({
  project,
  emptyState,
}: CellDiagramViewProps) {
  if (!project || project.components.length === 0) {
    return (
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 3,
          textAlign: "center",
          color: "text.secondary",
        }}
      >
        {emptyState ?? (
          <Typography variant="body2">
            Generate a design to see the cell diagram.
          </Typography>
        )}
      </Box>
    );
  }

  return (
    // position: 'relative' establishes a containing block for the library's
    // zoom/fit control panel: its `DiagramContainer` (the direct parent of
    // the absolutely-positioned control panel) sets no `position` of its
    // own, so without an ancestor here the controls escape to the nearest
    // positioned ancestor in the whole page (effectively the viewport),
    // landing wherever the page happens to end rather than inside this pane.
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", position: "relative" }}>
      <Suspense
        fallback={
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <CircularProgress />
          </Box>
        }
      >
        <CellDiagram project={project as unknown as Project} />
      </Suspense>
    </Box>
  );
});
