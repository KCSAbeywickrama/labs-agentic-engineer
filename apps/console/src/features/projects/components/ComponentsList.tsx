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

import { useState } from "react";
import {
  Avatar,
  Chip,
  Link as MuiLink,
  ListingTable,
  Typography,
} from "@wso2/oxygen-ui";
import { ExternalLink, FileCode } from "@wso2/oxygen-ui-icons-react";
import type { components } from "../../../generated/aep-api";
import { useComponentEndpointUrl } from "../api/queries";
import { ComponentOpenApiDialog } from "./ComponentOpenApiDialog";

type Component = components["schemas"]["Component"];

// The component type is OpenChoreo's own ComponentType name, end-to-end.
const isWebApp = (c: Component) => c.type === "web-application";

// A web app's "Open app" link (#196). The URL comes from the component's
// deployments read (dev binding's resolved endpointUrl) — list-components
// never fills Component.endpointUrl, though the field stays preferred here
// in case the backend ever closes that drift. Until a URL exists (not yet
// deployed, or fetch in flight/failed) the placeholder keeps its promise.
function WebAppLink({
  projectName,
  component,
}: {
  projectName: string;
  component: Component;
}) {
  const deployed = useComponentEndpointUrl(projectName, component.name);
  const href = component.endpointUrl ?? deployed.data;
  if (!href) {
    return (
      <Typography variant="caption" color="text.secondary">
        URL appears once deployed
      </Typography>
    );
  }
  return (
    <MuiLink
      href={href}
      target="_blank"
      rel="noreferrer"
      variant="body2"
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
    >
      Open app <ExternalLink size={14} />
    </MuiLink>
  );
}

// API/service rows open the component's OpenAPI contract in-app. It's a
// button, not an <a href>: the /openapi endpoint is JWT-guarded and a raw
// browser navigation carries no Bearer token (401). The dialog fetches
// through the authenticated client instead.
function ContractLink({
  name,
  onOpenContract,
}: {
  name: string;
  onOpenContract: (name: string) => void;
}) {
  return (
    <MuiLink
      component="button"
      type="button"
      onClick={() => onOpenContract(name)}
      variant="body2"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        verticalAlign: "baseline",
      }}
    >
      API contract <FileCode size={14} />
    </MuiLink>
  );
}

// Card-variant listing per the oxygen-ui sample's ProjectOverview page:
// header row floats above, each component renders as a full-width row card.
export function ComponentsList({
  projectName,
  items,
}: {
  projectName: string;
  items: Component[];
}) {
  const [contractComponent, setContractComponent] = useState<string | null>(
    null,
  );

  if (items.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
        No components yet — the published design produces them, and they show
        up here as agents build.
      </Typography>
    );
  }

  return (
    <ListingTable.Container sx={{ width: "100%" }} disablePaper>
      <ListingTable variant="card" density="standard">
        <ListingTable.Head>
          <ListingTable.Row>
            <ListingTable.Cell>Name</ListingTable.Cell>
            <ListingTable.Cell>Description</ListingTable.Cell>
            <ListingTable.Cell sx={{ maxWidth: 140 }}>Type</ListingTable.Cell>
            <ListingTable.Cell sx={{ maxWidth: 200 }}>Link</ListingTable.Cell>
          </ListingTable.Row>
        </ListingTable.Head>
        <ListingTable.Body>
          {items.map((c) => (
            <ListingTable.Row key={c.name} variant="card" hover>
              <ListingTable.Cell>
                <ListingTable.CellIcon
                  icon={
                    <Avatar
                      sx={{
                        width: 28,
                        height: 28,
                        bgcolor: "action.hover",
                        color: "text.primary",
                      }}
                    >
                      {((c.displayName ?? c.name).trim()[0] ?? "C").toUpperCase()}
                    </Avatar>
                  }
                  primary={c.displayName ?? c.name}
                />
              </ListingTable.Cell>
              <ListingTable.Cell>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.description ?? "—"}
                </Typography>
              </ListingTable.Cell>
              <ListingTable.Cell sx={{ maxWidth: 140 }}>
                <Chip
                  label={isWebApp(c) ? "Web app" : (c.type ?? "—")}
                  size="small"
                  variant="outlined"
                />
              </ListingTable.Cell>
              <ListingTable.Cell sx={{ maxWidth: 200 }}>
                {isWebApp(c) ? (
                  <WebAppLink projectName={projectName} component={c} />
                ) : (
                  <ContractLink
                    name={c.name}
                    onOpenContract={setContractComponent}
                  />
                )}
              </ListingTable.Cell>
            </ListingTable.Row>
          ))}
        </ListingTable.Body>
      </ListingTable>
      <ComponentOpenApiDialog
        projectName={projectName}
        componentName={contractComponent}
        onClose={() => setContractComponent(null)}
      />
    </ListingTable.Container>
  );
}
