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
  Box,
  Button,
  Chip,
  CircularProgress,
  Link as MuiLink,
  PageContent,
  PageTitle,
  Stack,
  Tab,
  Tabs,
} from "@wso2/oxygen-ui";
import { GitHub } from "@wso2/oxygen-ui-icons-react";
import { createLink, Outlet, useRouterState } from "@tanstack/react-router";
import type { components } from "../../../generated/aep-api";
import { useProject, useProjectStatus } from "../api/queries";

type ProjectStatus = components["schemas"]["ProjectStatus"];

// Phase → header chip. Values from aep-api's project_service.go.
function phaseChip(status: ProjectStatus): {
  label: string;
  color: "default" | "info" | "success" | "warning" | "error";
} {
  switch (status.phase) {
    case "no-repo":
      return { label: "No repository", color: "warning" };
    case "repo-cloning":
      return { label: "Preparing repository", color: "info" };
    case "repo-error":
      return { label: "Repository error", color: "error" };
    case "prompt":
      return { label: "Starting", color: "info" };
    case "spec":
      return { label: "Spec in progress", color: "info" };
    case "tasks":
      return { label: "Building", color: "info" };
    case "components":
      return { label: "Active", color: "success" };
    default:
      return { label: status.phase, color: "default" };
  }
}

const TABS = [
  { path: "", label: "Overview", to: "/projects/$projectName" },
  { path: "spec", label: "Spec", to: "/projects/$projectName/spec" },
  { path: "builds", label: "Builds", to: "/projects/$projectName/builds" },
  {
    path: "deployments",
    label: "Deployments",
    to: "/projects/$projectName/deployments",
  },
] as const;

// Router-aware Tab: renders an anchor with proper href + SPA navigation.
const LinkTab = createLink(Tab);

export function ProjectLayout({ projectName }: { projectName: string }) {
  const project = useProject(projectName);
  const status = useProjectStatus(projectName);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeTab =
    TABS.find(
      (t) => t.path && pathname.startsWith(`/projects/${projectName}/${t.path}`),
    )?.path ?? "";

  if (project.isPending) {
    return (
      <PageContent>
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
          <CircularProgress aria-label="Loading project" />
        </Box>
      </PageContent>
    );
  }

  if (project.isError) {
    return (
      <PageContent>
        <Alert
          severity="error"
          action={<Button onClick={() => void project.refetch()}>Retry</Button>}
        >
          Failed to load project
          {project.error instanceof Error && project.error.message
            ? `: ${project.error.message}`
            : ""}
        </Alert>
      </PageContent>
    );
  }

  const chip = status.data ? phaseChip(status.data) : null;

  return (
    <PageContent>
      <PageTitle>
        <PageTitle.Header>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <span>{project.data.displayName ?? project.data.name}</span>
            {chip && <Chip size="small" label={chip.label} color={chip.color} />}
          </Stack>
        </PageTitle.Header>
        {project.data.description && (
          <PageTitle.SubHeader>{project.data.description}</PageTitle.SubHeader>
        )}
        {status.data?.repoUrl && (
          <PageTitle.Actions>
            <MuiLink
              href={status.data.repoUrl}
              target="_blank"
              rel="noreferrer"
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}
            >
              <GitHub size={18} /> Repository
            </MuiLink>
          </PageTitle.Actions>
        )}
      </PageTitle>

      {status.data?.phase === "repo-error" && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Repository problem
          {status.data.repoErrorMessage
            ? `: ${status.data.repoErrorMessage}`
            : ""}
        </Alert>
      )}

      <Tabs value={activeTab} sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}>
        {TABS.map((tab) => (
          <LinkTab
            key={tab.label}
            value={tab.path}
            label={tab.label}
            to={tab.to}
            params={{ projectName }}
          />
        ))}
      </Tabs>

      <Outlet />
    </PageContent>
  );
}
