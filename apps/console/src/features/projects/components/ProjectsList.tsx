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
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  PageContent,
  PageTitle,
  Typography,
} from "@wso2/oxygen-ui";
import { Folder, Plus } from "@wso2/oxygen-ui-icons-react";
import { useProjectsList } from "../api/queries";

function ProjectsBody() {
  const { data, isPending, isError, error, refetch } = useProjectsList();

  if (isPending) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress aria-label="Loading projects" />
      </Box>
    );
  }

  if (isError) {
    return (
      <Alert
        severity="error"
        action={<Button onClick={() => void refetch()}>Retry</Button>}
      >
        Failed to load projects
        {error instanceof Error && error.message ? `: ${error.message}` : ""}
      </Alert>
    );
  }

  const items = data.items ?? [];

  if (items.length === 0) {
    // PRD: home = projects list; empty state prompts "start building".
    return (
      <Box sx={{ textAlign: "center", py: 8 }}>
        <Folder size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
        <Typography variant="h6" gutterBottom>
          No projects yet
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Start building — give a requirement and AEP turns it into a project.
        </Typography>
        <Button variant="contained" startIcon={<Plus size={20} />} disabled>
          Start building
        </Button>
      </Box>
    );
  }

  return (
    <List>
      {items.map((project) => (
        <ListItem key={project.name}>
          <ListItemText
            primary={project.displayName ?? project.name}
            secondary={project.description}
          />
        </ListItem>
      ))}
    </List>
  );
}

export function ProjectsList() {
  return (
    <PageContent>
      <PageTitle>
        <PageTitle.Header>Projects</PageTitle.Header>
        <PageTitle.SubHeader>
          Everything AEP is building for you, one project per app.
        </PageTitle.SubHeader>
        <PageTitle.Actions>
          <Button variant="contained" startIcon={<Plus size={20} />} disabled>
            Start building
          </Button>
        </PageTitle.Actions>
      </PageTitle>
      <ProjectsBody />
    </PageContent>
  );
}
