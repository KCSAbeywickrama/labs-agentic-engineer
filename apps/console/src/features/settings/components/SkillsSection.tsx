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
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  ListingTable,
  Typography,
} from "@wso2/oxygen-ui";
import { FolderGit2, Plus, Upload } from "@wso2/oxygen-ui-icons-react";
import { useConfig, useDeleteSkill, useSkillUpdates, useSkills } from "../api/queries";
import { CreateSkillDialog } from "./CreateSkillDialog";
import { EditSkillDialog } from "./EditSkillDialog";
import { ImportSkillDialog } from "./ImportSkillDialog";
import { SyncUpdatesPanel } from "./SyncUpdatesPanel";

export function SkillsSection() {
  const { data: config, isLoading: configLoading } = useConfig();
  const { data: skills, isLoading, isError, error } = useSkills();
  const { data: updates } = useSkillUpdates();

  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const deleteSkill = useDeleteSkill();

  if (configLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!config?.gitProvider) {
    return (
      <Alert severity="info" icon={<FolderGit2 size={20} />}>
        The skills catalogue lives in the org's GitHub repo — connect GitHub
        in the Credentials tab first.
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (isError || !skills) {
    return <Alert severity="error">{error?.message ?? "Failed to load skills"}</Alert>;
  }

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteSkill.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) });
  };

  return (
    <Box>
      <SyncUpdatesPanel updates={updates ?? []} />

      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mb: 2 }}>
        <Button variant="outlined" startIcon={<Upload size={18} />} onClick={() => setImportOpen(true)}>
          Import
        </Button>
        <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => setCreateOpen(true)}>
          Create skill
        </Button>
      </Box>

      <ListingTable.Container>
        <ListingTable>
          <ListingTable.Head>
            <ListingTable.Row>
              <ListingTable.Cell>Name</ListingTable.Cell>
              <ListingTable.Cell>Kind</ListingTable.Cell>
              <ListingTable.Cell>Version</ListingTable.Cell>
              <ListingTable.Cell>Description</ListingTable.Cell>
              <ListingTable.Cell align="right">Actions</ListingTable.Cell>
            </ListingTable.Row>
          </ListingTable.Head>
          <ListingTable.Body>
            {skills.length === 0 ? (
              <ListingTable.Row>
                <ListingTable.Cell colSpan={5}>
                  <ListingTable.EmptyState
                    title="No skills yet"
                    description="Create a skill, import one, or sync the platform's built-ins."
                  />
                </ListingTable.Cell>
              </ListingTable.Row>
            ) : (
              skills.map((skill) => (
                <ListingTable.Row key={skill.name}>
                  <ListingTable.Cell>
                    <Typography variant="body2">{skill.name}</Typography>
                  </ListingTable.Cell>
                  <ListingTable.Cell>
                    <Chip label={skill.kind} size="small" variant="outlined" />
                  </ListingTable.Cell>
                  <ListingTable.Cell>v{skill.version}</ListingTable.Cell>
                  <ListingTable.Cell>
                    <Typography variant="body2" color="text.secondary">
                      {skill.description}
                    </Typography>
                  </ListingTable.Cell>
                  <ListingTable.Cell align="right">
                    {skill.editable ? (
                      <ListingTable.RowActions>
                        <Button size="small" onClick={() => setEditTarget(skill.name)}>
                          Edit
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => setDeleteTarget(skill.name)}
                        >
                          Delete
                        </Button>
                      </ListingTable.RowActions>
                    ) : (
                      <Chip label="read-only" size="small" />
                    )}
                  </ListingTable.Cell>
                </ListingTable.Row>
              ))
            )}
          </ListingTable.Body>
        </ListingTable>
      </ListingTable.Container>

      <CreateSkillDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <ImportSkillDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <EditSkillDialog name={editTarget} onClose={() => setEditTarget(null)} />

      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete {deleteTarget}?</DialogTitle>
        <DialogContent>
          <DialogContentText>This can't be undone.</DialogContentText>
          {deleteSkill.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {deleteSkill.error.message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={confirmDelete}
            disabled={deleteSkill.isPending}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
