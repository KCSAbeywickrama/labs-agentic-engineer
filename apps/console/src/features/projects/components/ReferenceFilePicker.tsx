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

import { useState, type DragEvent } from "react";
import { Alert, Box, Button, Chip, Stack, Typography } from "@wso2/oxygen-ui";
import { FileText, Upload } from "@wso2/oxygen-ui-icons-react";
import {
  MAX_REFERENCE_FILES,
  REFERENCE_ACCEPT,
  screenReferenceFiles,
  type RejectedFile,
} from "../lib/referenceFiles";

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The create view's reference-document intake (#383): drag-and-drop zone +
// browse button, one removable chip per attached file. Screening (type, size,
// count, duplicates) happens on selection; each rejection surfaces as its own
// notice and clears on the next selection — never a silent drop.
export function ReferenceFilePicker({
  files,
  onFilesChange,
}: {
  files: File[];
  onFilesChange: (files: File[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming || incoming.length === 0) return;
    const screening = screenReferenceFiles(files, Array.from(incoming));
    setRejected(screening.rejected);
    if (screening.accepted.length > 0) {
      onFilesChange([...files, ...screening.accepted]);
    }
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  return (
    <Stack spacing={1}>
      <Box
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={drop}
        sx={{
          p: 2,
          textAlign: "center",
          borderRadius: 1,
          border: "1px dashed",
          borderColor: dragOver ? "primary.main" : "divider",
          bgcolor: dragOver ? "action.hover" : "transparent",
        }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Have reference documents — a PRD, notes, an API spec? Drop them here
          and the agents read them when deriving your requirements.
        </Typography>
        <Button
          component="label"
          variant="outlined"
          size="small"
          startIcon={<Upload size={16} />}
        >
          Attach documents
          <input
            type="file"
            accept={REFERENCE_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              // Same file re-selected after a remove must re-fire onChange.
              e.target.value = "";
            }}
          />
        </Button>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 1 }}
        >
          {/* Read off the input's own accept list, so the hint cannot drift from
              what the picker actually takes (it had already lost .jpeg). */}
          {REFERENCE_ACCEPT.split(",").join(", ")} — up to {MAX_REFERENCE_FILES}{" "}
          files, 5 MB each
        </Typography>
      </Box>
      {files.length > 0 && (
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          {files.map((file) => (
            <Chip
              key={file.name}
              icon={<FileText size={14} />}
              label={`${file.name} (${formatFileSize(file.size)})`}
              variant="outlined"
              onDelete={() =>
                onFilesChange(files.filter((f) => f.name !== file.name))
              }
            />
          ))}
        </Box>
      )}
      {/* Keyed and dismissed by position, not by name: one selection can reject
          two files under the same name (a duplicate, or two oversized copies),
          and name identity would collapse them into one notice and then close
          both at once. */}
      {rejected.map(({ name, reason }, index) => (
        <Alert
          key={`${index}-${name}`}
          severity="warning"
          onClose={() =>
            setRejected((prev) => prev.filter((_, i) => i !== index))
          }
        >
          <strong>{name}</strong> was not attached: {reason.toLowerCase()}.
        </Alert>
      ))}
    </Stack>
  );
}
