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
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Link as MuiLink,
  ListingTable,
  Typography,
} from "@wso2/oxygen-ui";
import { ExternalLink } from "@wso2/oxygen-ui-icons-react";
import {
  useProjectComponents,
  useProjectDeployments,
} from "../api/queries";
import {
  joinDeploymentRows,
  type DeploymentRow,
} from "../lib/deploymentRows";

// Chip vocabulary for a row's state (#216): the label keeps the backend's
// raw condition reason (it's the vocabulary operators see in OpenChoreo),
// only the two join-derived states get console-authored labels.
function rowChip(row: DeploymentRow): {
  label: string;
  color: "success" | "error" | "info" | "default";
  outlined?: boolean;
} {
  switch (row.kind) {
    case "notDeployed":
      return { label: "Not deployed", color: "default", outlined: true };
    case "undeployed":
      return { label: "Undeployed", color: "default" };
    case "success":
      return { label: row.deployment?.status ?? "Ready", color: "success" };
    case "error":
      return { label: row.deployment?.status ?? "Failed", color: "error" };
    case "transitional":
      return { label: row.deployment?.status ?? "In progress", color: "info" };
    default:
      return { label: "Pending", color: "default", outlined: true };
  }
}

function deployedAt(createdAt: string | undefined): string {
  if (!createdAt) return "—";
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

// Deployments page (#216): what's running in dev and what isn't — a flat
// table over the project-level deployments read joined with the components
// list. The join is client-side, so a components fetch failure degrades to
// binding-only rows instead of blanking the page.
export function DeploymentsPage({ projectName }: { projectName: string }) {
  const deployments = useProjectDeployments(projectName);
  const components = useProjectComponents(projectName);

  if (deployments.isPending || components.isPending) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress aria-label="Loading deployments" />
      </Box>
    );
  }

  if (deployments.isError) {
    return (
      <Alert
        severity="error"
        action={
          <Button onClick={() => void deployments.refetch()}>Retry</Button>
        }
      >
        Failed to load deployments
        {deployments.error instanceof Error && deployments.error.message
          ? `: ${deployments.error.message}`
          : ""}
      </Alert>
    );
  }

  const rows = joinDeploymentRows(
    components.data?.items ?? [],
    deployments.data.items,
  );

  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
        Nothing to deploy yet — components appear here once the published
        design produces them, and agents deploy to dev on merge.
      </Typography>
    );
  }

  return (
    <ListingTable.Container sx={{ width: "100%" }} disablePaper>
      <ListingTable variant="card" density="standard">
        <ListingTable.Head>
          <ListingTable.Row>
            <ListingTable.Cell>Component</ListingTable.Cell>
            <ListingTable.Cell sx={{ maxWidth: 140 }}>
              Environment
            </ListingTable.Cell>
            <ListingTable.Cell sx={{ maxWidth: 160 }}>Status</ListingTable.Cell>
            <ListingTable.Cell>Release</ListingTable.Cell>
            <ListingTable.Cell sx={{ maxWidth: 200 }}>URL</ListingTable.Cell>
            <ListingTable.Cell sx={{ maxWidth: 180 }}>
              Deployed
            </ListingTable.Cell>
          </ListingTable.Row>
        </ListingTable.Head>
        <ListingTable.Body>
          {rows.map((row) => {
            const chip = rowChip(row);
            return (
              <ListingTable.Row
                key={`${row.componentName}/${row.deployment?.environment ?? ""}`}
                variant="card"
                hover
              >
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
                        {(row.displayName.trim()[0] ?? "C").toUpperCase()}
                      </Avatar>
                    }
                    primary={row.displayName}
                  />
                </ListingTable.Cell>
                <ListingTable.Cell sx={{ maxWidth: 140 }}>
                  {row.deployment?.environment ? (
                    <Chip
                      label={row.deployment.environment}
                      size="small"
                      variant="outlined"
                    />
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      —
                    </Typography>
                  )}
                </ListingTable.Cell>
                <ListingTable.Cell sx={{ maxWidth: 160 }}>
                  <Chip
                    label={chip.label}
                    size="small"
                    color={chip.color}
                    {...(chip.outlined && { variant: "outlined" as const })}
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
                    {row.deployment?.releaseName ?? "—"}
                  </Typography>
                </ListingTable.Cell>
                <ListingTable.Cell sx={{ maxWidth: 200 }}>
                  {row.deployment?.endpointUrl ? (
                    <MuiLink
                      href={row.deployment.endpointUrl}
                      target="_blank"
                      rel="noreferrer"
                      variant="body2"
                      sx={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 0.5,
                      }}
                    >
                      Open <ExternalLink size={14} />
                    </MuiLink>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      —
                    </Typography>
                  )}
                </ListingTable.Cell>
                <ListingTable.Cell sx={{ maxWidth: 180 }}>
                  <Typography variant="caption" color="text.secondary">
                    {deployedAt(row.deployment?.createdAt)}
                  </Typography>
                </ListingTable.Cell>
              </ListingTable.Row>
            );
          })}
        </ListingTable.Body>
      </ListingTable>
    </ListingTable.Container>
  );
}
