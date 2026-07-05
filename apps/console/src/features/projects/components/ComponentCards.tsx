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
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  Link as MuiLink,
  Stack,
  Typography,
} from "@wso2/oxygen-ui";
import { AppWindow, Boxes, ExternalLink, FileCode } from "@wso2/oxygen-ui-icons-react";
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
        variant="body2"
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
  // API/service cards link to the component's OpenAPI contract.
  return (
    <MuiLink
      href={`${env.apiBaseUrl}/api/v1/projects/${projectName}/components/${c.name}/openapi`}
      target="_blank"
      rel="noreferrer"
      variant="body2"
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
    >
      API contract <FileCode size={14} />
    </MuiLink>
  );
}

// Horizontal card layout (issue #77 feedback): one card per component,
// flowing left to right.
export function ComponentCards({
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
    <Grid container spacing={2}>
      {items.map((c) => (
        <Grid key={c.name} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
          <Card variant="outlined" sx={{ height: "100%" }}>
            <CardContent
              sx={{ display: "flex", flexDirection: "column", height: "100%" }}
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: "center", mb: 1 }}
              >
                {isWebApp(c) ? <AppWindow size={18} /> : <Boxes size={18} />}
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {c.displayName ?? c.name}
                </Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Chip
                  size="small"
                  label={isWebApp(c) ? "Web app" : (c.type ?? "—")}
                />
              </Stack>
              {c.description && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1.5 }}
                >
                  {c.description}
                </Typography>
              )}
              <Stack
                direction="row"
                sx={{
                  mt: "auto",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  {c.status ?? "—"}
                </Typography>
                {componentLink(projectName, c)}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}
