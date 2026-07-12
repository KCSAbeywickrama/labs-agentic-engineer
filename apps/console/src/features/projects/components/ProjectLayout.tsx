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
  Divider,
  PageContent,
  PageTitle,
  Stack,
} from "@wso2/oxygen-ui";
import { Link as LinkIcon } from "@wso2/oxygen-ui-icons-react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
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

export function ProjectLayout({ projectName }: { projectName: string }) {
  const project = useProject(projectName);
  const status = useProjectStatus(projectName);
  // The builds section inverts the title (#185 decision): "Builds" as the
  // header, the project name as the subheader. Every other section keeps
  // the shared project-name-first header.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isBuilds = pathname.split("/")[3] === "builds";

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
  const displayName = project.data.displayName ?? project.data.name;
  const initial = (displayName.trim()[0] ?? "P").toUpperCase();

  return (
    <PageContent>
      {/* Header per the oxygen-ui sample's ProjectOverview page: back
          button, avatar with initial, name, description, repo link. */}
      <Box sx={{ mb: 3 }}>
        <PageTitle>
          <PageTitle.BackButton component={<Link to="/" />} />
          <PageTitle.Avatar
            sx={{ bgcolor: "primary.main", color: "primary.contrastText" }}
          >
            {initial}
          </PageTitle.Avatar>
          <PageTitle.Header>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <span>{isBuilds ? "Builds" : displayName}</span>
              {chip && (
                <Chip size="small" label={chip.label} color={chip.color} />
              )}
            </Stack>
          </PageTitle.Header>
          {isBuilds ? (
            <PageTitle.SubHeader>{displayName}</PageTitle.SubHeader>
          ) : (
            project.data.description && (
              <PageTitle.SubHeader>
                {project.data.description}
              </PageTitle.SubHeader>
            )
          )}
          {status.data?.repoUrl && (
            <PageTitle.Link
              href={status.data.repoUrl}
              target="_blank"
              rel="noreferrer"
              icon={<LinkIcon size={14} />}
            >
              {status.data.repoUrl.replace(/^https?:\/\/(www\.)?/, "")}
            </PageTitle.Link>
          )}
        </PageTitle>
        <Divider sx={{ mt: 2 }} />
      </Box>

      {status.data?.phase === "repo-error" && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Repository problem
          {status.data.repoErrorMessage
            ? `: ${status.data.repoErrorMessage}`
            : ""}
        </Alert>
      )}

      <Outlet />
    </PageContent>
  );
}
