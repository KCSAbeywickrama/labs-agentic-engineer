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

import type React from "react";
import { useState } from "react";
import {
  Box,
  Collapse,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileImage,
  FileText,
  FileType2,
  Plus,
  RefreshCw,
  Network,
  LayoutDashboard,
} from "@wso2/oxygen-ui-icons-react";
import type { SpecFileEntry } from "../api/mapping";
import {
  buildDesignSection,
  selectionKey,
  type SpecSelection,
} from "../api/designTree";
import { formatFileSize } from "../../projects/components/ReferenceFilePicker";
import { referenceFileKind, type ReferenceFileKind } from "../lib/referencePreview";

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

const OPENAPI_RE = /\/openapi\.ya?ml$/;
const COMPONENT_DESIGN_RE = /^specs\/design\/components\/[^/]+\/design\.json$/;
const VALIDATION_CRITERIA_RE = /^specs\/validation\/validation-criteria\.json$/;
function fileLabel(path: string): string {
  if (OPENAPI_RE.test(path)) return "API Spec";
  if (COMPONENT_DESIGN_RE.test(path)) return "Design Overview";
  if (VALIDATION_CRITERIA_RE.test(path)) return "Validation Criteria";
  return basename(path);
}

function fileSel(path: string): SpecSelection {
  return { kind: "file", path };
}

// Per-type iconography for the References section (#383 preview): PDF, MD
// source, and everything else (plain text) each get a distinct glyph so the
// list reads as three kinds of document, not one repeated icon.
const REFERENCE_ICON_BY_KIND: Record<ReferenceFileKind, React.ReactNode> = {
  pdf: <FileType2 size={16} />,
  markdown: <FileCode size={16} />,
  image: <FileImage size={16} />,
  text: <FileText size={16} />,
};

export function SpecFileList({
  files,
  selection,
  onSelect,
  onAddArtifact,
  onRegenerateDesign,
  onPreviewReference,
  regenerateDisabled,
  deriving,
  failed,
}: {
  files: SpecFileEntry[];
  selection: SpecSelection | null;
  onSelect: (sel: SpecSelection) => void;
  onAddArtifact: () => void;
  /** Re-generate the design (#159) — shown in the Designs header once a design
   *  exists; fires the same design-generation room turn as the header CTA. */
  onRegenerateDesign: () => void;
  /** A reference document row was clicked (#383 preview) — opens the preview
   *  dialog. Deliberately separate from onSelect: references never enter the
   *  main content pane's file-selection pipeline (collab editor, structured
   *  views) — they're static, user-uploaded source material. */
  onPreviewReference: (entry: SpecFileEntry) => void;
  /** Disabled while an agent turn runs — a re-generate would be dropped mid-turn. */
  regenerateDisabled?: boolean;
  /** Agents are still shaping the spec — empty groups say so. */
  deriving: boolean;
  /** Derivation failed — empty groups say that instead. */
  failed: boolean;
}) {
  const selKey = selection ? selectionKey(selection) : null;
  const isSel = (sel: SpecSelection) => selKey === selectionKey(sel);

  const requirements = files.filter((f) => f.group === "requirements");
  const validation = files.filter((f) => f.group === "validation");
  const references = files.filter((f) => f.group === "references");
  const design = buildDesignSection(files);

  // Per-component expand/collapse — default expanded, remembered by name so
  // toggling one component survives unrelated re-derivations of the list.
  const [collapsedComponents, setCollapsedComponents] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleComponent = (name: string) => {
    setCollapsedComponents((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const emptyNote = failed
    ? "Derivation failed"
    : deriving
      ? "Being derived…"
      : "No files yet";

  // `indent` bumps a row one level deeper than the top-level tree (matching
  // the old console's depth-based pl: files inside an expanded component sit
  // right of both the top-level entries and the component's own header row).
  const row = (
    sel: SpecSelection,
    label: string,
    icon: React.ReactNode,
    indent?: boolean,
  ) => (
    <ListItemButton
      key={selectionKey(sel)}
      selected={isSel(sel)}
      onClick={() => onSelect(sel)}
      sx={{ pl: indent ? 4 : 2, pr: 2 }}
    >
      <ListItemIcon sx={{ minWidth: 32 }}>{icon}</ListItemIcon>
      <ListItemText primary={label} slotProps={{ primary: { noWrap: true } }} />
    </ListItemButton>
  );

  const flatGroup = (
    title: string,
    groupFiles: SpecFileEntry[],
    addBtn?: boolean,
  ) => (
    <Box sx={{ mb: 1 }}>
      <Box
        sx={{
          px: 2,
          py: 0.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Typography variant="overline" color="text.secondary">
          {title}
        </Typography>
        {addBtn && (
          <Tooltip title="Add requirement artifact">
            <IconButton
              size="small"
              aria-label="Add requirement artifact"
              onClick={onAddArtifact}
            >
              <Plus size={16} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {groupFiles.length > 0 ? (
        <List dense disablePadding>
          {groupFiles.map((f) =>
            row(fileSel(f.path), fileLabel(f.path), <FileText size={16} />),
          )}
        </List>
      ) : (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ px: 2, py: 0.5, fontStyle: "italic" }}
        >
          {emptyNote}
        </Typography>
      )}
    </Box>
  );

  return (
    <Box component="nav" aria-label="Spec files" sx={{ py: 1 }}>
      {flatGroup("Requirements", requirements, true)}

      {/* Designs — grouped by component, with synthetic diagram entries. */}
      <Box sx={{ mb: 1 }}>
        <Box
          sx={{
            px: 2,
            py: 0.5,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography variant="overline" color="text.secondary">
            Designs
          </Typography>
          {(design.hasComponents || design.overview.length > 0) && (
            <Tooltip
              title={
                regenerateDisabled
                  ? "An agent is still working — re-generate is available once it finishes"
                  : "Re-generate design from the current requirements"
              }
            >
              {/* span so the tooltip works while the button is disabled */}
              <span>
                <IconButton
                  size="small"
                  aria-label="Re-generate design"
                  onClick={onRegenerateDesign}
                  disabled={regenerateDisabled ?? false}
                >
                  <RefreshCw size={16} />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>
        {design.hasComponents || design.hasCellDsl || design.overview.length > 0 ? (
          <List dense disablePadding>
            {design.hasCellDsl &&
              row({ kind: "cell-diagram" }, "Architecture", <Network size={16} />)}
            {design.overview.map((f) =>
              row(
                fileSel(f.path),
                basename(f.path),
                <LayoutDashboard size={16} />,
              ),
            )}
            {design.components.map((c) => {
              const collapsed = collapsedComponents.has(c.name);
              return (
                <Box key={c.name} sx={{ mt: 0.5 }}>
                  <ListItemButton
                    onClick={() => toggleComponent(c.name)}
                    sx={{ px: 2, py: 0.25, minHeight: 0 }}
                    aria-expanded={!collapsed}
                    aria-label={`${collapsed ? "Expand" : "Collapse"} ${c.name}`}
                  >
                    <ListItemIcon sx={{ minWidth: 20 }}>
                      {collapsed ? (
                        <ChevronRight size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={c.name}
                      slotProps={{
                        primary: {
                          variant: "body2",
                          fontWeight: 600,
                          color: "text.secondary",
                        },
                      }}
                    />
                  </ListItemButton>
                  <Collapse in={!collapsed} unmountOnExit>
                    {c.files.map((f) =>
                      row(fileSel(f.path), fileLabel(f.path), <FileText size={16} />, true),
                    )}
                    {c.wireframeDslPath &&
                      row(
                        {
                          kind: "wireframe",
                          component: c.name,
                          dslPath: c.wireframeDslPath,
                        },
                        "Wireframe",
                        <LayoutDashboard size={16} />,
                        true,
                      )}
                  </Collapse>
                </Box>
              );
            })}
          </List>
        ) : (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ px: 2, py: 0.5, fontStyle: "italic" }}
          >
            {emptyNote}
          </Typography>
        )}
      </Box>

      {flatGroup("Validation", validation)}

      {/* References — the documents the user attached at create (#383).
          Optional by nature, so the section only exists when files do:
          an empty "no files yet" row here would be noise on every project.
          Rendered separately from flatGroup: a click opens the preview
          dialog (onPreviewReference) rather than routing through onSelect —
          references never enter the main pane's collab/structured-view
          pipeline. Each row also carries per-type iconography and the
          file's human-readable size (#383 preview). */}
      {references.length > 0 && (
        <Box sx={{ mb: 1 }}>
          <Box sx={{ px: 2, py: 0.5 }}>
            <Typography variant="overline" color="text.secondary">
              References
            </Typography>
          </Box>
          <List dense disablePadding>
            {references.map((f) => (
              <ListItemButton
                key={f.path}
                onClick={() => onPreviewReference(f)}
                sx={{ pl: 2, pr: 2 }}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  {REFERENCE_ICON_BY_KIND[referenceFileKind(f.path)]}
                </ListItemIcon>
                <ListItemText
                  primary={basename(f.path)}
                  secondary={f.size !== undefined ? formatFileSize(f.size) : undefined}
                  slotProps={{ primary: { noWrap: true } }}
                />
              </ListItemButton>
            ))}
          </List>
        </Box>
      )}
    </Box>
  );
}
