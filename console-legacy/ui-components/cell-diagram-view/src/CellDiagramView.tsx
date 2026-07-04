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

import { lazy, memo, Suspense, useMemo } from 'react';
import type { Project } from '@wso2/cell-diagram';
import { Box, CircularProgress, Typography } from '@wso2/oxygen-ui';
import { buildProjectModel, type CellDiagramComponent } from './buildProjectModel.js';

const CellDiagram = lazy(() =>
  import('@wso2/cell-diagram').then((m) => ({ default: m.CellDiagram })),
);

export interface CellDiagramViewProps {
  /** Components projected into a diagram via {@link buildProjectModel}. */
  components?: CellDiagramComponent[];
  /**
   * A pre-built cell-diagram project, rendered as-is (bypasses
   * `buildProjectModel`) and taking precedence over `components`. Use when the
   * caller already holds the projected model — e.g. the design page projects the
   * live draft/stream through the SAME `toCellDiagramProject` pipeline that
   * derives the committed `cell-diagram.gen.json`, so the diagram tracks the
   * files exactly while streaming and before publish.
   */
  project?: Project;
  /** Optional override for the empty-state copy. */
  emptyState?: React.ReactNode;
}

export const CellDiagramView = memo(function CellDiagramView({
  components,
  project,
  emptyState,
}: CellDiagramViewProps) {
  const model = useMemo(
    () => project ?? buildProjectModel(components ?? []),
    [project, components],
  );

  if (model.components.length === 0) {
    return (
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 3,
          textAlign: 'center',
          color: 'text.secondary',
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
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <Suspense
        fallback={
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress />
          </Box>
        }
      >
        <CellDiagram project={model} />
      </Suspense>
    </Box>
  );
});
