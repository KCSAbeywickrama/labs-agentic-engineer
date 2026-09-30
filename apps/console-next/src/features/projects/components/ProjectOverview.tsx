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
import { Box, Button, Skeleton, Typography } from "@wso2/oxygen-ui";
import { EmptyState } from "../../../components/EmptyState";
import { BuildButton } from "../../builds/components/BuildButton";
import { ProjectFeatures } from "../../spec/components/ProjectFeatures";
import { projectLabel, useProject } from "../api/queries";
import { repoLabel } from "../repo";
import { Track } from "./Track";

const ButtonLink = createLink(Button);

/**
 * A project's base page: its name and repository (with Build v1 once
 * something is designed), the track, and the features (the spec workspace's
 * rows). Cards open over it.
 */
export function ProjectOverview({ projectName }: { projectName: string }) {
  const project = useProject(projectName);

  if (project.isError) {
    return (
      <EmptyState
        title="Couldn't open this project"
        description={project.error.message}
        action={
          <Box sx={{ display: "flex", gap: 1, justifyContent: "center" }}>
            <Button variant="outlined" onClick={() => void project.refetch()}>
              Try again
            </Button>
            <ButtonLink to="/" variant="text">
              All projects
            </ButtonLink>
          </Box>
        }
      />
    );
  }

  const repo = project.data ? repoLabel(project.data.repoUrl) : null;
  return (
    <>
      <Box sx={{ mb: 2.75, display: "flex", alignItems: "flex-start", gap: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h1" variant="h4" sx={{ fontWeight: 600 }}>
            {project.data ? projectLabel(project.data) : <Skeleton width={220} />}
          </Typography>
          {project.isPending ? (
            <Skeleton width={260} />
          ) : (
            repo && (
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
                {repo.full}
              </Typography>
            )
          )}
        </Box>
        <BuildButton projectName={projectName} />
      </Box>
      <Track projectName={projectName} />
      <Box component="section" aria-labelledby="features-heading">
        <Typography id="features-heading" component="h2" sx={{ fontSize: "0.8125rem", fontWeight: 600, mb: 1 }}>
          Features
        </Typography>
        <ProjectFeatures projectName={projectName} />
      </Box>
    </>
  );
}
