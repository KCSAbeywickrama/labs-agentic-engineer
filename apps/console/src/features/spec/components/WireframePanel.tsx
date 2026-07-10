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

import { Alert, Box, CircularProgress, Typography } from "@wso2/oxygen-ui";
import { ExcalidrawView } from "@aep/ui-excalidraw-view";
import { useDerivedWireframe } from "../api/useDerivedDesign";
import type { SpecFileEntry } from "../api/mapping";

export function WireframePanel({
  projectName,
  dslPath,
  files,
}: {
  projectName: string;
  dslPath: string;
  files: SpecFileEntry[];
}) {
  const sha = files.find((f) => f.path === dslPath)?.sha;
  const { scene, isPending, isError } = useDerivedWireframe(projectName, dslPath, sha);

  if (isPending) {
    return (
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress aria-label="Loading wireframe" />
      </Box>
    );
  }
  if (isError) return <Alert severity="error">Failed to load {dslPath}.</Alert>;
  if (!scene) {
    return (
      <Typography variant="body2" color="text.secondary">
        This wireframe source could not be rendered.
      </Typography>
    );
  }
  // ExcalidrawView(fillHeight) sets `flex: 1` on its own root — it fills its
  // flex-column parent directly; no extra wrapper needed (an extra
  // `height: '100%'` Box here would just re-introduce the sizing bug this
  // component was written to avoid).
  return <ExcalidrawView key={sha} scene={scene} fillHeight />;
}
