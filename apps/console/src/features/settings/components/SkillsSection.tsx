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
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  SearchBar,
  Typography,
} from "@wso2/oxygen-ui";
import { FolderGit2, Upload } from "@wso2/oxygen-ui-icons-react";
import type { components } from "../../../generated/aep-api";
import {
  useConfig,
  useDeleteSkill,
  useSkillUpdates,
  useSkills,
} from "../api/queries";
import {
  SKILL_GROUPS,
  kindChipColor,
  kindLabel,
  normalizeKind,
} from "../skillKind";
import { EditSkillDialog } from "./EditSkillDialog";
import { ImportSkillDialog } from "./ImportSkillDialog";
import { SyncUpdatesPanel } from "./SyncUpdatesPanel";

type SkillSummary = components["schemas"]["SkillSummary"];

export function SkillsSection() {
  const { data: config, isLoading: configLoading } = useConfig();
  const { data, isLoading, isError, error } = useSkills();
  const { data: updates } = useSkillUpdates();

  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
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
        The skills catalogue lives in the org's GitHub repo — connect GitHub in
        the Credentials tab first.
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

  if (isError || !data) {
    return (
      <Alert severity="error">
        {error?.message ?? "Failed to load skills"}
      </Alert>
    );
  }

  const { skills, repoUrl } = data;
  const updatable = new Set((updates ?? []).map((u) => u.name));

  // Client-side filter (issue #96 re-grill): the catalogue is fully loaded and
  // tens of skills at most — name, description, and kind all match.
  const query = search.trim().toLowerCase();
  const matches = (skill: SkillSummary) =>
    !query ||
    [skill.name, skill.description, skill.kind].some((field) =>
      (field ?? "").toLowerCase().includes(query),
    );

  const visible = skills.filter(matches);
  const grouped = SKILL_GROUPS.map((group) => ({
    ...group,
    rows: visible.filter((s) => normalizeKind(s.kind) === group.kind),
  }));

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteSkill.mutate(deleteTarget, {
      onSuccess: () => setDeleteTarget(null),
    });
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Skills shape what the platform's agents emit — code patterns,
        conventions, and project layout. Org and platform skills ship with the
        platform and are read-only; import AgentSkills from the ecosystem to
        extend them.
      </Typography>

      <SyncUpdatesPanel updates={updates ?? []} />

      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 1,
          mb: 3,
        }}
      >
        <Box sx={{ width: { xs: "100%", sm: 320 } }}>
          <SearchBar
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skills..."
          />
        </Box>
        <Button
          variant="contained"
          startIcon={<Upload size={18} />}
          onClick={() => setImportOpen(true)}
        >
          Import
        </Button>
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {grouped.map(({ kind, heading, blurb, rows }) => (
          <Box key={kind}>
            <Box
              sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: 0.5 }}
            >
              <Typography variant="subtitle1" fontWeight={700}>
                {heading}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                — {rows.length}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              {blurb}
            </Typography>

            {rows.length === 0 ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 1, fontStyle: "italic" }}
              >
                {query ? "No matches." : "None yet."}
              </Typography>
            ) : (
              <Card variant="outlined" sx={{ mt: 1 }}>
                <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
                  {rows.map((skill, idx) => {
                    const skillKind = normalizeKind(skill.kind);
                    return (
                      <Box key={skill.name}>
                        {idx > 0 && <Divider />}
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1.5,
                            px: 2,
                            py: 1.5,
                            "&:hover": { bgcolor: "action.hover" },
                          }}
                        >
                          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                                flexWrap: "wrap",
                              }}
                            >
                              <Typography variant="body1" fontWeight={600}>
                                {skill.name}
                              </Typography>
                              {/* Outlined: a filled kind chip fights the
                                  filled "update available" chip, and Oxygen's
                                  filled `secondary` has too little contrast. */}
                              <Chip
                                size="small"
                                variant="outlined"
                                color={kindChipColor(skillKind)}
                                label={kindLabel(skillKind)}
                              />
                              {updatable.has(skill.name) && (
                                <Chip
                                  size="small"
                                  color="warning"
                                  label="update available"
                                />
                              )}
                              {!skill.editable && (
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label="read-only"
                                />
                              )}
                            </Box>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ mt: 0.5 }}
                            >
                              {skill.description}
                            </Typography>
                          </Box>
                          <Box
                            sx={{ display: "flex", gap: 0.5, flexShrink: 0 }}
                          >
                            {skill.editable && (
                              <>
                                <Button
                                  size="small"
                                  onClick={() => setEditTarget(skill.name)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="small"
                                  color="error"
                                  onClick={() => setDeleteTarget(skill.name)}
                                >
                                  Delete
                                </Button>
                              </>
                            )}
                          </Box>
                        </Box>
                      </Box>
                    );
                  })}
                </CardContent>
              </Card>
            )}
          </Box>
        ))}
      </Box>

      <ImportSkillDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        repoUrl={repoUrl}
      />
      <EditSkillDialog name={editTarget} onClose={() => setEditTarget(null)} />

      <Dialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete {deleteTarget}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This removes the skill from your organization's skills repo. Agents
            read skills at the repo's latest commit, so in-flight tasks simply
            stop seeing it.
          </DialogContentText>
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
