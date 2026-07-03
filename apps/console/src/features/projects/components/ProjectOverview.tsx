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
  PageContent,
  PageTitle,
  Typography,
} from "@wso2/oxygen-ui";
import { Link } from "@tanstack/react-router";
import { useProject } from "../api/queries";

// Stub navigation target for the projects listing (issue #71). The real
// overview — component map, deployment state, activity — is its own feature.
export function ProjectOverview({ projectName }: { projectName: string }) {
  const { data, isPending, isError, error, refetch } = useProject(projectName);

  if (isPending) {
    return (
      <PageContent>
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
          <CircularProgress aria-label="Loading project" />
        </Box>
      </PageContent>
    );
  }

  if (isError) {
    return (
      <PageContent>
        <Alert
          severity="error"
          action={<Button onClick={() => void refetch()}>Retry</Button>}
        >
          Failed to load project
          {error instanceof Error && error.message ? `: ${error.message}` : ""}
        </Alert>
      </PageContent>
    );
  }

  return (
    <PageContent>
      <PageTitle>
        <PageTitle.Header>{data.displayName ?? data.name}</PageTitle.Header>
        {data.description && (
          <PageTitle.SubHeader>{data.description}</PageTitle.SubHeader>
        )}
      </PageTitle>
      <Typography variant="body2" color="text.secondary">
        The project overview — component map, deployment state, and activity —
        is on its way. Meanwhile, head{" "}
        <Link to="/">back to your projects</Link>.
      </Typography>
    </PageContent>
  );
}
