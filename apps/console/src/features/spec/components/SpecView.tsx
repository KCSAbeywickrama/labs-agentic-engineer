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

import { useEffect, useState } from "react";
import {
  Alert,
  Avatar,
  AvatarGroup,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  PageContent,
  TextField,
  Tooltip,
  Typography,
  useAppShell,
} from "@wso2/oxygen-ui";
import { ArrowLeft, Hammer } from "@wso2/oxygen-ui-icons-react";
import { useNavigate } from "@tanstack/react-router";
import type { components } from "../../../generated/aep-api";
import {
  useProject,
  useProjectStatus,
  useProjectTags,
} from "../../projects/api/queries";
import { useSpecFileContent, useSpecFiles } from "../api/queries";
import { useCollabSpec } from "../collab/useCollabSpec";
import { CollabTextArea } from "../collab/CollabTextArea";
import { SpecMdEditor } from "../collab/SpecMdEditor";
import { AddArtifactDialog } from "./AddArtifactDialog";
import { SpecFileList } from "./SpecFileList";
import { CellDiagramPanel } from "./CellDiagramPanel";
import { WireframePanel } from "./WireframePanel";
import { OpenApiView } from "@aep/ui-openapi-view";
import type { SpecSelection } from "../api/designTree";
import { useSession } from "../../../auth/SessionContext";

type ProjectStatus = components["schemas"]["ProjectStatus"];

// specStatus → header chip, same language as the overview's spec card.
function specChip(status: ProjectStatus): {
  label: string;
  color: "default" | "info" | "success" | "warning" | "error";
} | null {
  switch (status.specStatus) {
    case "draft":
    case "in_progress":
      return { label: "In collaboration", color: "info" };
    case "ready":
      return { label: "Awaiting your review", color: "warning" };
    case "approved":
      return { label: "Approved", color: "success" };
    case "failed":
      return { label: "Derivation failed", color: "error" };
    default:
      return null;
  }
}

// Full-screen spec workspace (#80), per the oxygen-ui sample's
// LoginEditorView pattern: fullWidth/noPadding page, own header bar,
// sidebar collapsed while the view is open.
export function SpecView({ projectName }: { projectName: string }) {
  const navigate = useNavigate();
  const { actions } = useAppShell();
  const project = useProject(projectName);
  const status = useProjectStatus(projectName);
  const tags = useProjectTags(projectName);
  const spec = useSpecFiles(projectName);
  const { user, orgHandle } = useSession();
  // Rooms are org-scoped (`spec-<org>-<project>`); without an org claim fall
  // back to the collab mock BFF's default org so mock mode keeps working.
  const collab = useCollabSpec(projectName, user, orgHandle ?? "acme");
  const [selection, setSelection] = useState<SpecSelection | null>(null);
  const [addArtifactOpen, setAddArtifactOpen] = useState(false);

  // Collapse the sidebar while focused on the spec, expand when leaving.
  useEffect(() => {
    actions.collapseSidebar();
    return () => {
      actions.expandSidebar();
    };
  }, [actions]);

  const files = spec.data ?? [];
  // Default selection: the first requirements file (the seeded PRD).
  const firstRequirements = files.find((f) => f.group === "requirements");
  const effectiveSelection: SpecSelection =
    selection ??
    (firstRequirements
      ? { kind: "file", path: firstRequirements.path }
      : files[0]
        ? { kind: "file", path: files[0].path }
        : { kind: "file", path: "" });

  // The concrete file entry when the selection is a file (else null: the
  // synthetic cell-diagram / wireframe views render their own panels).
  const selectedFile =
    effectiveSelection.kind === "file"
      ? (files.find((f) => f.path === effectiveSelection.path) ?? null)
      : null;

  // Collab supplies live content when connected; the REST read (lazy, per
  // selected file) is only the solo fallback, so it stays disabled while a
  // collab doc backs the selection. `openapi.yaml` is a fully rendered,
  // read-only API Spec view — like the wireframe .dsl, it never goes through
  // the collab text editor, so it's excluded from both branches below.
  const isOpenApiFile = selectedFile?.path.endsWith("/openapi.yaml") ?? false;
  // Canvas-based views (cell diagram, Excalidraw) need a flex-column,
  // overflow-hidden ancestor so their own `flex: 1` roots get a real
  // measured height to stretch into — a plain overflow:auto block (used for
  // text content below) leaves them at their library-default intrinsic size
  // instead of filling the pane.
  const isDiagramView =
    effectiveSelection.kind === "cell-diagram" ||
    effectiveSelection.kind === "wireframe";
  const selectedIsMd = selectedFile?.path.endsWith(".md") ?? false;
  const fragment =
    selectedFile && selectedIsMd && !isOpenApiFile
      ? collab.getFileFragment(selectedFile.path)
      : null;
  const ytext =
    selectedFile && !selectedIsMd && !isOpenApiFile
      ? collab.getFileText(selectedFile.path)
      : null;
  const usesCollab = Boolean((fragment && collab.provider) || ytext);
  const content = useSpecFileContent(
    projectName,
    selectedFile && (!usesCollab || isOpenApiFile) ? selectedFile : null,
  );

  const specStatus = status.data?.specStatus;
  const deriving =
    specStatus === "pending" ||
    specStatus === "draft" ||
    specStatus === "in_progress";
  const failed = specStatus === "failed";
  const chip = status.data ? specChip(status.data) : null;
  // The design gate: Build arms once design files are generated (#80).
  const hasDesignFiles = files.some((f) => f.group === "designs");

  const displayName = project.data?.displayName ?? projectName;

  return (
    // oxygen-ui's PageContentInner (the direct parent of these children) has
    // no height/flex of its own — it sizes to its content, breaking the
    // height:100% chain PageContentRoot otherwise correctly establishes
    // (PageContentRoot IS height:100%+flex-column, and correctly excludes
    // the AppShell footer's height via the shell's own flex distribution).
    // `sx` here isn't filtered by PageContent's prop allowlist, so it
    // forwards straight through to PageContentInner and closes that one
    // missing link — this is the supported override, not a guessed
    // viewport value like 100vh (which ignores the footer entirely and
    // overshoots the actual available space).
    <PageContent fullWidth noPadding sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box
        sx={{
          height: "100%",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <Box
          sx={{
            p: 2,
            borderBottom: 1,
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            gap: 2,
            bgcolor: "background.paper",
          }}
        >
          <IconButton
            aria-label="Back to project overview"
            onClick={() =>
              void navigate({
                to: "/projects/$projectName",
                params: { projectName },
              })
            }
          >
            <ArrowLeft size={20} />
          </IconButton>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h4" noWrap>
              Spec
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {displayName}
            </Typography>
          </Box>

          {collab.peers.length > 0 && (
            <AvatarGroup max={5}>
              {collab.peers.map((peer) => (
                <Tooltip
                  key={peer.clientId}
                  title={`${peer.name}${peer.kind === "agent" ? " (agent)" : ""}`}
                >
                  <Avatar
                    sx={{
                      width: 28,
                      height: 28,
                      fontSize: "0.8rem",
                      bgcolor: peer.color,
                      // Agents get a square-ish avatar so presence is honest
                      // about who is human (#86 decision 7).
                      borderRadius: peer.kind === "agent" ? 1 : "50%",
                    }}
                  >
                    {(peer.name.trim()[0] ?? "?").toUpperCase()}
                  </Avatar>
                </Tooltip>
              ))}
            </AvatarGroup>
          )}
          {collab.status === "offline" && (
            <Tooltip title="Collaboration server unreachable — editing solo; edits aren't shared or saved.">
              <Chip size="small" variant="outlined" label="solo" />
            </Tooltip>
          )}

          {/* Version chips from the tag resource (#117): latest user tag +
              whether specs/ moved on GitHub since. */}
          {tags.data?.latest && (
            <Chip
              size="small"
              variant="outlined"
              color="success"
              label={`${tags.data.latest} published`}
            />
          )}
          {tags.data?.specDirty && (
            <Chip size="small" color="warning" label="draft changes" />
          )}
          {chip && <Chip size="small" color={chip.color} label={chip.label} />}

          <Divider orientation="vertical" flexItem />

          <Tooltip
            title={
              hasDesignFiles
                ? "Start building from this spec"
                : "Available once design files are generated"
            }
          >
            {/* span so the tooltip works while the button is disabled */}
            <span>
              <Button
                variant="contained"
                startIcon={<Hammer size={18} />}
                disabled={!hasDesignFiles}
                onClick={() =>
                  void navigate({
                    to: "/projects/$projectName",
                    params: { projectName },
                  })
                }
              >
                Build
              </Button>
            </span>
          </Tooltip>
        </Box>

        {failed && (
          <Alert severity="error" sx={{ borderRadius: 0 }}>
            Spec derivation hit a problem. Existing files remain browsable;
            the agents' error details will surface here in a follow-up.
          </Alert>
        )}

        {/* Body: grouped file list + file content */}
        {spec.isPending ? (
          <Box
            sx={{
              flexGrow: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CircularProgress aria-label="Loading spec" />
          </Box>
        ) : spec.isError ? (
          <Box sx={{ p: 3 }}>
            <Alert
              severity="error"
              action={<Button onClick={() => void spec.refetch()}>Retry</Button>}
            >
              Failed to load the spec
              {spec.error instanceof Error && spec.error.message
                ? `: ${spec.error.message}`
                : ""}
            </Alert>
          </Box>
        ) : (
          <Box sx={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
            <Box
              sx={{
                width: 280,
                flexShrink: 0,
                borderRight: 1,
                borderColor: "divider",
                overflow: "auto",
              }}
            >
              <SpecFileList
                files={files}
                selection={effectiveSelection}
                onSelect={setSelection}
                onAddArtifact={() => setAddArtifactOpen(true)}
                deriving={deriving}
                failed={failed}
              />
            </Box>
            <Box
              sx={
                isDiagramView
                  ? {
                      flexGrow: 1,
                      minWidth: 0,
                      minHeight: 0,
                      display: "flex",
                      flexDirection: "column",
                      overflow: "hidden",
                    }
                  : { flexGrow: 1, minWidth: 0, overflow: "auto", p: 2 }
              }
            >
              {effectiveSelection.kind === "cell-diagram" ? (
                <CellDiagramPanel projectName={projectName} files={files} />
              ) : effectiveSelection.kind === "wireframe" ? (
                <WireframePanel
                  projectName={projectName}
                  dslPath={effectiveSelection.dslPath}
                  files={files}
                />
              ) : selectedFile ? (
                // Per-type renderers (WYSIWYG for markdown, dedicated components
                // for structured files). Collaborative when the collab service
                // is reachable (#86 phase 5); solo-and-unsaved otherwise
                // (#86 decision 10).
                isOpenApiFile ? (
                  content.data ? (
                    <OpenApiView key={content.data.sha} spec={content.data.content} />
                  ) : content.isError ? (
                    <Alert
                      severity="error"
                      action={
                        <Button onClick={() => void content.refetch()}>Retry</Button>
                      }
                    >
                      Failed to load {selectedFile.path}
                    </Alert>
                  ) : (
                    <Box
                      sx={{
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <CircularProgress aria-label={`Loading ${selectedFile.path}`} />
                    </Box>
                  )
                ) : fragment && collab.provider ? (
                  // Markdown gets the Tiptap editor on the file's
                  // Y.XmlFragment (#86 phase 6).
                  <SpecMdEditor
                    key={`${selectedFile.path}:md`}
                    fragment={fragment}
                    path={selectedFile.path}
                    provider={collab.provider}
                    self={collab.self}
                  />
                ) : ytext ? (
                  <CollabTextArea
                    key={`${selectedFile.path}:collab`}
                    ytext={ytext}
                    path={selectedFile.path}
                    isLocalTransaction={collab.isLocalTransaction}
                  />
                ) : content.data ? (
                  <TextField
                    key={`${selectedFile.path}:${content.data.sha}`}
                    fullWidth
                    multiline
                    minRows={20}
                    defaultValue={content.data.content}
                    aria-label={`Content of ${selectedFile.path}`}
                    helperText={`${selectedFile.path} — edits aren't saved yet; editing lands with the file editors.`}
                    slotProps={{
                      input: {
                        sx: { fontFamily: "monospace", fontSize: "0.875rem" },
                      },
                    }}
                  />
                ) : content.isError ? (
                  <Alert
                    severity="error"
                    action={
                      <Button onClick={() => void content.refetch()}>
                        Retry
                      </Button>
                    }
                  >
                    Failed to load {selectedFile.path}
                    {content.error instanceof Error && content.error.message
                      ? `: ${content.error.message}`
                      : ""}
                  </Alert>
                ) : (
                  <Box
                    sx={{
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <CircularProgress
                      aria-label={`Loading ${selectedFile.path}`}
                    />
                  </Box>
                )
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {deriving
                    ? "The agents are shaping the spec — files appear here as they land."
                    : "Select a file to view its content."}
                </Typography>
              )}
            </Box>
          </Box>
        )}
      </Box>

      <AddArtifactDialog
        open={addArtifactOpen}
        onClose={() => setAddArtifactOpen(false)}
      />
    </PageContent>
  );
}
