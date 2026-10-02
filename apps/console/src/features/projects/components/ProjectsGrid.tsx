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
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CircularProgress,
  Typography,
} from "@wso2/oxygen-ui";
import { FolderOpen, Plus } from "@wso2/oxygen-ui-icons-react";
import { useSession } from "../../../auth/SessionContext";
import { EmptyState } from "../../../components/EmptyState";
import { BasePage } from "../../shell/components/BasePage";
import { projectLabel, useProjects, type Project } from "../api/queries";
import { repoLabel } from "../repo";

const CardLink = createLink(CardActionArea);
const ButtonLink = createLink(Button);

function NewProjectButton() {
  return (
    <ButtonLink to="/projects/new" variant="contained" startIcon={<Plus size={16} />}>
      New project
    </ButtonLink>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const repo = repoLabel(project.repoUrl);
  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 3,
        transition: (t) => t.transitions.create("border-color"),
        "&:hover": { borderColor: "primary.main" },
      }}
    >
      <CardLink
        to="/projects/$projectName"
        params={{ projectName: project.name }}
        sx={{ p: 2, minHeight: 140, display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "flex-start", gap: 1.25 }}
      >
        <Box>
          <Typography sx={{ fontWeight: 600, fontSize: "0.9375rem" }}>{projectLabel(project)}</Typography>
          {repo && (
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
              {repo.short}
            </Typography>
          )}
        </Box>
        {project.description && (
          <Typography variant="body2" color="text.secondary">
            {project.description}
          </Typography>
        )}
      </CardLink>
    </Card>
  );
}

function Grid() {
  const projects = useProjects();
  if (projects.isPending) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
        <CircularProgress size={24} aria-label="Loading projects" />
      </Box>
    );
  }
  if (projects.isError) {
    return (
      <EmptyState
        title="Couldn't load projects"
        description={projects.error.message}
        action={
          <Button variant="outlined" onClick={() => void projects.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }
  if (projects.data.length === 0) {
    return (
      <EmptyState
        icon={<FolderOpen size={48} />}
        title="No projects yet"
        description="Describe what you want to build, and the agent guides it from there."
        action={<NewProjectButton />}
      />
    );
  }
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 1.75,
      }}
    >
      {projects.data.map((p) => (
        <ProjectCard key={p.name} project={p} />
      ))}
    </Box>
  );
}

/** The org's base page: every project as a card; a card opens its overview. */
export function ProjectsGrid() {
  const { orgHandle } = useSession();
  const projects = useProjects();
  const count = projects.data?.length;
  return (
    <BasePage>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2, mb: 2.75 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h1" variant="h4" sx={{ fontWeight: 600 }}>
            Projects
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {orgHandle ?? "Your organization"}
            {count !== undefined && ` · ${count === 1 ? "1 project" : `${count} projects`}`}
          </Typography>
        </Box>
        {count !== 0 && <NewProjectButton />}
      </Box>
      <Grid />
    </BasePage>
  );
}
