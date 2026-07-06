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

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  ListingTable,
  PageContent,
  PageTitle,
  Skeleton,
  Typography,
} from '@wso2/oxygen-ui';
import { ArrowLeft, Clock, PlugZap } from '@wso2/oxygen-ui-icons-react';
import { formatDistanceToNow } from 'date-fns';
import { api } from '../services/api';
import type { ComponentDefinition, TaskView, Project } from '../services/api';
import { componentDetailPath, organizationOverviewPath, projectArchitecturePath } from '../lib/paths';
import { displayStatus, IN_FLIGHT_TASK_STATUSES } from '../components/tasks/types';

// ---------------------------------------------------------------------------
// Last Updated cell
// ---------------------------------------------------------------------------

function LastUpdatedCell({ value }: { value?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Clock size={16} />
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {value ? formatDistanceToNow(new Date(value), { addSuffix: true }) : 'just now'}
      </Typography>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

interface ProjectComponentsPageProps {
  statusBanner?: ReactNode;
}

export default function ProjectComponentsPage({ statusBanner }: ProjectComponentsPageProps = {}) {
  const navigate = useNavigate();
  const { orgId, projectId } = useParams();
  const routeOrgId = orgId ?? 'demo-org';

  const [project, setProject] = useState<Project | undefined>();
  const [components, setComponents] = useState<ComponentDefinition[]>([]);
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    const [p, c, t] = await Promise.all([
      api.getProject(projectId),
      api.listComponents(projectId),
      api.listTasks(projectId),
    ]);
    setProject(p);
    setComponents(c);
    setTasks(t);
    setLoading(false);
  }, [projectId, routeOrgId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Poll while any task is active in the pipeline
  useEffect(() => {
    const hasActive = tasks.some((t) => IN_FLIGHT_TASK_STATUSES.has(t.derivedStatus));
    if (hasActive) {
      intervalRef.current = setInterval(async () => {
        if (!projectId) return;
        const t = await api.listTasks(projectId);
        setTasks(t);
      }, 5000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [tasks, projectId, routeOrgId]);

  // Build maps: componentName → task, componentName → OC component
  const taskMap = new Map<string, TaskView>();
  for (const t of tasks) {
    if (t.component) taskMap.set(t.component, t);
  }
  const componentMap = new Map<string, ComponentDefinition>();
  for (const c of components) {
    componentMap.set(c.name, c);
  }

  // Merge: rows for all unique component names from both tasks and OC components.
  const allNames = new Set<string>();
  for (const t of tasks) if (t.component) allNames.add(t.component);
  for (const c of components) allNames.add(c.name);
  const rows = Array.from(allNames).map((name) => ({
    name,
    task: taskMap.get(name),
    component: componentMap.get(name),
  }));

  if (loading) {
    return (
      <PageContent>
        <Skeleton variant="text" width="40%" height={40} />
        <Grid container spacing={2} sx={{ mt: 3 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Grid key={i} size={12}>
              <Skeleton variant="rounded" height={72} />
            </Grid>
          ))}
        </Grid>
      </PageContent>
    );
  }

  if (!project) {
    return (
      <PageContent>
        <Typography variant="h5" color="error">
          Project not found
        </Typography>
        <Button
          variant="text"
          startIcon={<ArrowLeft size={16} />}
          onClick={() => navigate(organizationOverviewPath(routeOrgId))}
          sx={{ mt: 2 }}
        >
          Back to Projects
        </Button>
      </PageContent>
    );
  }

  const projectLetter = (project.name?.trim()?.[0] ?? 'P').toUpperCase();

  return (
    <PageContent>
      <PageTitle>
        <PageTitle.Avatar sx={{ bgcolor: 'primary.main', color: 'primary.contrastText' }}>
          {projectLetter}
        </PageTitle.Avatar>
        <PageTitle.Header>{project.name}</PageTitle.Header>
        <PageTitle.SubHeader>
          {rows.length} component{rows.length !== 1 ? 's' : ''}
        </PageTitle.SubHeader>
      </PageTitle>

      <Divider sx={{ mt: 2, mb: 3 }} />

      {statusBanner && <Box sx={{ mb: 4 }}>{statusBanner}</Box>}

      <Typography variant="h6" sx={{ mb: 2 }}>
        Components
      </Typography>

      {rows.length === 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8 }}>
          <PlugZap size={48} opacity={0.3} />
          <Typography variant="h6" color="text.secondary" sx={{ mt: 2, mb: 1 }}>
            No components yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Approve the architecture to create components.
          </Typography>
          <Button
            variant="contained"
            onClick={() => navigate(projectArchitecturePath(routeOrgId, projectId!))}
          >
            Go to Architecture
          </Button>
        </Box>
      ) : (
        <ListingTable.Container sx={{ width: '100%' }} disablePaper>
          <ListingTable variant="card" density="standard">
            <ListingTable.Head>
              <ListingTable.Row>
                <ListingTable.Cell>Name</ListingTable.Cell>
                <ListingTable.Cell>Responsibilities</ListingTable.Cell>
                <ListingTable.Cell>Tech</ListingTable.Cell>
                <ListingTable.Cell>Status</ListingTable.Cell>
                <ListingTable.Cell align="right">Last Updated</ListingTable.Cell>
              </ListingTable.Row>
            </ListingTable.Head>

            <ListingTable.Body>
              {rows.map(({ name, task, component }) => {
                const statusChip = displayStatus(task?.derivedStatus ?? component?.status ?? 'created');
                const summary = component?.responsibilities ?? '';
                const techStack = component?.techStack ?? '';
                const updatedAt = component?.updatedAt;

                return (
                  <ListingTable.Row
                    key={name}
                    variant="card"
                    hover
                    clickable
                    onClick={() => navigate(componentDetailPath(routeOrgId, projectId!, name))}
                  >
                    <ListingTable.Cell>
                      <ListingTable.CellIcon
                        icon={
                          <Avatar
                            sx={{
                              width: 28,
                              height: 28,
                              bgcolor: 'action.hover',
                              color: 'text.primary',
                            }}
                          >
                            {(name?.trim()?.[0] ?? 'C').toUpperCase()}
                          </Avatar>
                        }
                        primary={name}
                      />
                    </ListingTable.Cell>

                    <ListingTable.Cell>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 420,
                          display: 'block',
                        }}
                      >
                        {summary}
                      </Typography>
                    </ListingTable.Cell>

                    <ListingTable.Cell>
                      {techStack && <Chip label={techStack} size="small" variant="outlined" />}
                    </ListingTable.Cell>

                    <ListingTable.Cell>
                      <Chip
                        label={statusChip.label}
                        color={statusChip.color}
                        size="small"
                        variant="outlined"
                      />
                    </ListingTable.Cell>

                    <ListingTable.Cell align="right">
                      <LastUpdatedCell value={updatedAt} />
                    </ListingTable.Cell>
                  </ListingTable.Row>
                );
              })}
            </ListingTable.Body>
          </ListingTable>
        </ListingTable.Container>
      )}
    </PageContent>
  );
}
