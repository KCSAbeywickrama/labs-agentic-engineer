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
  Box,
  Card,
  CardContent,
  Link as MuiLink,
  Stack,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import { Boxes, ExternalLink } from "@wso2/oxygen-ui-icons-react";
import { EmptyState } from "../../../components/EmptyState";
import type { components } from "../../../generated/aep-api";
import { useComponentEndpointUrl } from "../api/queries";
import { ComponentOpenApiDialog } from "./ComponentOpenApiDialog";

type Component = components["schemas"]["Component"];

// The component type is OpenChoreo's own ComponentType name, end-to-end.
const isWebApp = (c: Component) => c.type === "web-application";
const isAiAgent = (c: Component) => c.type === "ai-agent";

// A web app's "Open app" link (#196) / an ai-agent's chat link. Both read the
// same dev-deployment `endpointUrl` (list-components never fills
// Component.endpointUrl — noted contract drift) via the shared
// useComponentEndpointUrl read; an agent's chat link is just that URL plus
// the AFM schema's default chat path. Until a URL exists the row keeps the
// "URL appears once deployed" placeholder.
function EndpointLink({
  projectName,
  component,
}: {
  projectName: string;
  component: Component;
}) {
  const deployed = useComponentEndpointUrl(projectName, component.name);
  const base = component.endpointUrl ?? deployed.data;
  if (!base) {
    return (
      <Typography variant="caption" color="text.secondary">
        URL appears once deployed
      </Typography>
    );
  }
  const href = isAiAgent(component) ? `${base}/chat` : base;
  const label = isAiAgent(component) ? "Chat" : "Open app";
  return (
    <MuiLink
      href={href}
      target="_blank"
      rel="noreferrer"
      variant="body2"
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
    >
      {label} <ExternalLink size={14} />
    </MuiLink>
  );
}

// Component cards: one compact single-row card per component — avatar, name and
// description. Services open their OpenAPI contract on click (JWT-guarded, so
// via the authenticated dialog, not a raw link). Web-app and ai-agent rows
// instead surface their dev endpoint (#196) — a plain "Open app"/"Chat" link.
//
// Deliberately state-free of build status. A component's build state used to
// be rolled up from its tasks, but an issue no longer names a component —
// issue bodies are prose the platform writes and never reads back — so the
// roll-up had no input left. What is running lives on the deployments board,
// which reads the cluster.
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
      <EmptyState
        bordered
        icon={<Boxes size={28} />}
        title="No components yet"
        description="The published plan produces them — they appear here as agents build."
      />
    );
  }

  return (
    <>
      <Stack spacing={1.5}>
        {items.map((c) => {
          const initial = ((c.displayName ?? c.name).trim()[0] ?? "C").toUpperCase();
          const hasEndpointLink = isWebApp(c) || isAiAgent(c);
          const openable = !hasEndpointLink;
          const card = (
            <Card
              key={c.name}
              variant="outlined"
              {...(openable
                ? {
                    onClick: () => setContractComponent(c.name),
                    sx: {
                      cursor: "pointer",
                      transition: "border-color 120ms, box-shadow 120ms",
                      "&:hover": { borderColor: "primary.main", boxShadow: 1 },
                    },
                  }
                : {})}
            >
              <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                  <Avatar
                    variant="rounded"
                    sx={{
                      width: 36,
                      height: 36,
                      bgcolor: "action.hover",
                      color: "text.primary",
                    }}
                  >
                    {initial}
                  </Avatar>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600 }} noWrap>
                      {c.displayName ?? c.name}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      noWrap
                      sx={{ display: "block" }}
                    >
                      {c.description ?? "—"}
                    </Typography>
                  </Box>
                  {hasEndpointLink && (
                    <EndpointLink projectName={projectName} component={c} />
                  )}
                </Stack>
              </CardContent>
            </Card>
          );
          return openable ? (
            <Tooltip key={c.name} title="View API contract" placement="left">
              {card}
            </Tooltip>
          ) : (
            card
          );
        })}
      </Stack>
      <ComponentOpenApiDialog
        projectName={projectName}
        componentName={contractComponent}
        onClose={() => setContractComponent(null)}
      />
    </>
  );
}
