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

import { createLink } from "@tanstack/react-router";
import { Box, Link, Typography } from "@wso2/oxygen-ui";
import { CellDiagramView } from "@aep/ui-cell-diagram-view";
import { DesignView } from "@aep/ui-design-view";
import { OpenApiView } from "@aep/ui-openapi-view";
import { ErrorBoundary } from "../../../../components/ErrorBoundary";
import { PHONE } from "../../../shell/layout";
import type { ArtifactSource } from "../../api/designModel";

// The design's artifacts drawn by the shared viewers (packages/ui), used as
// they are. What is here is the glue, after the old console's
// (CellDiagramPanel, SpecView): a box of the height a canvas needs, and an
// error boundary around the canvas, where render throws have been seen.

type Source<K extends ArtifactSource["kind"]> = Extract<ArtifactSource, { kind: K }>;

const ResourceLink = createLink(Link);

/** A canvas viewer fills a flex column; this gives it one of a fixed height. */
const canvasSx = {
  height: 560,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  border: 1,
  borderColor: "divider",
  borderRadius: 2.5,
  overflow: "hidden",
  [PHONE]: { height: 460 },
} as const;

/** The architecture: the cell diagram of the product's components and what they reach. */
export function ArchitectureArtifact({ source, layoutKey }: { source: Source<"architecture">; layoutKey: string }) {
  return (
    <Box sx={canvasSx}>
      <ErrorBoundary label="The architecture diagram" resetKey={source.cell} fill>
        <CellDiagramView source={source.cell} layoutKey={layoutKey} />
      </ErrorBoundary>
    </Box>
  );
}

/**
 * A component: the organization's resources it reuses, each opening its
 * Resource card; its design (DesignView); then its API contract with who may
 * call what (OpenApiView).
 */
export function ContractArtifact({ source }: { source: Source<"contract"> }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {(source.resources ?? []).length > 0 && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography variant="body2" color="text.secondary">
            Reuses the organization&apos;s
          </Typography>
          {(source.resources ?? []).map((name) => (
            <ResourceLink key={name} to="/resources/$name" params={{ name }} variant="body2">
              {name}
            </ResourceLink>
          ))}
        </Box>
      )}
      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2.5, overflow: "hidden" }}>
        <DesignView design={source.design} />
      </Box>
      {source.openapi && (
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2.5, overflow: "hidden" }}>
          <OpenApiView spec={source.openapi} roles={source.roles} />
        </Box>
      )}
    </Box>
  );
}
