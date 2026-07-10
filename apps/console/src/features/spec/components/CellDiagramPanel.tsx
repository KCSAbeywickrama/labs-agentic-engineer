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

import { Alert, Box, CircularProgress } from "@wso2/oxygen-ui";
import { CellDiagramView } from "@aep/ui-cell-diagram-view";
import { useDerivedCellDiagram } from "../api/useDerivedDesign";
import type { SpecFileEntry } from "../api/mapping";

export function CellDiagramPanel({
  projectName,
  files,
}: {
  projectName: string;
  files: SpecFileEntry[];
}) {
  const { project, isPending, isError } = useDerivedCellDiagram(projectName, files);

  if (isPending) {
    return (
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress aria-label="Loading architecture diagram" />
      </Box>
    );
  }
  if (isError) {
    return <Alert severity="error">Failed to load the design sources for the diagram.</Alert>;
  }
  // CellDiagramView's own root is `flex: 1, minHeight: 0, display: 'flex'` —
  // it fills its flex-column parent directly; no extra wrapper needed (an
  // extra `height: '100%'` Box here would just re-introduce the sizing bug
  // this component was written to avoid).
  return <CellDiagramView project={project} />;
}
