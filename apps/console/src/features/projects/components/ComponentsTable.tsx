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

import {
  Chip,
  Link as MuiLink,
  ListingTable,
  Typography,
} from "@wso2/oxygen-ui";
import { ExternalLink, FileCode } from "@wso2/oxygen-ui-icons-react";
import type { components } from "../../../generated/aep-api";
import { env } from "../../../config/env";

type Component = components["schemas"]["Component"];

const isWebApp = (c: Component) => c.type === "webapp" || c.type === "web-app";

function componentLink(projectName: string, c: Component) {
  if (isWebApp(c)) {
    return c.endpointUrl ? (
      <MuiLink
        href={c.endpointUrl}
        target="_blank"
        rel="noreferrer"
        sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
      >
        Open app <ExternalLink size={14} />
      </MuiLink>
    ) : (
      <Typography variant="body2" color="text.secondary">
        URL appears once deployed
      </Typography>
    );
  }
  // API/service rows link to the component's OpenAPI contract.
  return (
    <MuiLink
      href={`${env.apiBaseUrl}/api/v1/projects/${projectName}/components/${c.name}/openapi`}
      target="_blank"
      rel="noreferrer"
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
    >
      API contract <FileCode size={14} />
    </MuiLink>
  );
}

export function ComponentsTable({
  projectName,
  items,
}: {
  projectName: string;
  items: Component[];
}) {
  if (items.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
        No components yet — the published design produces them, and they show
        up here as agents build.
      </Typography>
    );
  }

  return (
    <ListingTable.Container>
      <ListingTable density="compact">
        <ListingTable.Head>
          <ListingTable.Row>
            <ListingTable.Cell>Name</ListingTable.Cell>
            <ListingTable.Cell>Type</ListingTable.Cell>
            <ListingTable.Cell>Status</ListingTable.Cell>
            <ListingTable.Cell>Link</ListingTable.Cell>
          </ListingTable.Row>
        </ListingTable.Head>
        <ListingTable.Body>
          {items.map((c) => (
            <ListingTable.Row key={c.name}>
              <ListingTable.Cell>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {c.displayName ?? c.name}
                </Typography>
                {c.description && (
                  <Typography variant="caption" color="text.secondary">
                    {c.description}
                  </Typography>
                )}
              </ListingTable.Cell>
              <ListingTable.Cell>
                <Chip size="small" label={isWebApp(c) ? "Web app" : (c.type ?? "—")} />
              </ListingTable.Cell>
              <ListingTable.Cell>{c.status ?? "—"}</ListingTable.Cell>
              <ListingTable.Cell>{componentLink(projectName, c)}</ListingTable.Cell>
            </ListingTable.Row>
          ))}
        </ListingTable.Body>
      </ListingTable>
    </ListingTable.Container>
  );
}
