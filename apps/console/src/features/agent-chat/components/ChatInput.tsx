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

import { useState, type DragEvent, type ReactNode } from "react";
import {
  Alert,
  Box,
  Chip,
  Divider,
  IconButton,
  InputBase,
  Stack,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import { FolderOpen, Paperclip, Send } from "@wso2/oxygen-ui-icons-react";
import { AttachmentPreviewStrip } from "../../../components/AttachmentPreview";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_FILES,
  screenChatAttachments,
  type RejectedFile,
} from "../lib/chatAttachments";

// The composer (task 3): context chip, textarea, send. Disabled while a turn
// runs; when the running turn is a TEAMMATE's, `hint` explains why so the input
// reads as intentionally locked, not broken.
//
// Attachments (#428) live INSIDE the composer. That is why this is a bordered
// Box around a bare `InputBase` rather than an outlined `TextField`: the
// attachments, the attach control and send all sit within one border, and MUI's
// adornment slots lay out horizontally BESIDE the textarea, so they cannot put a
// row of thumbnails above it. Same construction as the create view's
// PromptComposer, for the same reason.
//
// Attachments are conversation-scoped model content: nothing is stored
// server-side and nothing is committed (ADR-0019).

/**
 * The text's line box, in px, declared rather than inherited — it is the datum
 * the flanking controls align to, so it has to be a number this file owns.
 */
const LINE_HEIGHT = 20;

/**
 * A slot that centres its control on the text's line box.
 *
 * The controls flanking the text — the paperclip and send — must look optically
 * centred ON THE LINE, and bottom-aligning their boxes does not achieve that: a
 * control is taller than a line of text (it needs ~24px to stay a comfortable
 * target), so aligning box-bottoms leaves its centre sitting high, by half the
 * difference. Correcting that with a negative margin per control means a magic
 * number per icon size, and it silently goes wrong the moment an icon changes
 * size — which is exactly what happened here.
 *
 * So the slot is the line's height and the control centres INSIDE it,
 * overhanging symmetrically. The arithmetic then holds for any icon size and any
 * padding, and because the row is still `flex-end`, the controls stay level with
 * the LAST line as the field grows to its 5-row cap.
 */
const CONTROL_SLOT = {
  height: `${LINE_HEIGHT}px`,
  display: "flex",
  alignItems: "center",
  flexShrink: 0,
} as const;

export function ChatInput({
  value,
  onChange,
  onSubmit,
  disabled,
  contextLabel,
  hint,
  actions,
  files,
  onFilesChange,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  contextLabel: string;
  /** Why the input is locked (teammate turn), or null when free. */
  hint?: string | null;
  /** Launcher slot, rendered on the context row ahead of the session chip. */
  actions?: ReactNode;
  /** Files attached to the message being composed. */
  files: File[];
  onFilesChange: (files: File[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming || incoming.length === 0) return;
    const screening = screenChatAttachments(files, Array.from(incoming));
    setRejected(screening.rejected);
    if (screening.accepted.length > 0) {
      onFilesChange([...files, ...screening.accepted]);
    }
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    // A locked composer must not accept a drop it would discard: the turn is
    // running, so there is no message for these files to ride.
    if (disabled) return;
    addFiles(e.dataTransfer.files);
  };

  return (
    <Box>
      <Divider />
      <Box sx={{ p: 1.5 }}>
        <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center" }}>
          {actions}
          <Chip
            size="small"
            variant="outlined"
            icon={<FolderOpen size={14} />}
            label={contextLabel}
            sx={{
              maxWidth: "100%",
              // The lucide-style icon doesn't inherit the Chip's icon margins,
              // so it sits flush against the border — space it explicitly and
              // align it with the label.
              "& .MuiChip-icon": { ml: 0.75, mr: -0.25, flexShrink: 0 },
              "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" },
            }}
          />
        </Stack>
        {hint && (
          <Typography
            data-testid="input-hint"
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 1 }}
          >
            {hint}
          </Typography>
        )}
        {/* The composer IS the drop target — the whole box, so there is no second
            affordance to find. The context row above is deliberately outside it:
            its Actions menu and session chip have nothing to do with files. */}
        <Box
          data-testid="chat-composer-dropzone"
          onDragOver={(e: DragEvent) => {
            e.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={drop}
          sx={{
            px: 0.75,
            py: 0.5,
            borderRadius: 2,
            border: "1px solid",
            borderColor: dragOver ? "primary.main" : "divider",
            bgcolor: dragOver ? "action.hover" : "background.paper",
            transition: "border-color 120ms, background-color 120ms",
            "&:focus-within": { borderColor: "primary.main" },
          }}
        >
          <AttachmentPreviewStrip
            files={files}
            disabled={disabled}
            onRemove={(name) => onFilesChange(files.filter((f) => f.name !== name))}
          />
          <Stack direction="row" spacing={0.25} sx={{ alignItems: "flex-end" }}>
            <Box sx={CONTROL_SLOT}>
              <Tooltip
                title={
                  /* No extension list: it is 16 entries, which turns a hint into
                     a wall of text nobody reads. The picker already filters by
                     `accept`, and picking an unsupported file answers with a
                     rejection naming the accepted set — available exactly where
                     it matters, at the point of failure. */
                  `Attach files to this message — a screenshot, a PDF, a data sample. ` +
                  `They stay in this conversation and are never committed. ` +
                  `Up to ${MAX_ATTACHMENT_FILES} files, 5 MB each, 15 MB total.`
                }
              >
                <IconButton
                  component="label"
                  size="small"
                  aria-label="Attach files to this message"
                  disabled={disabled}
                  sx={{ p: 0.5 }}
                >
                  <Paperclip size={14} />
                  <input
                    type="file"
                    accept={ATTACHMENT_ACCEPT}
                    multiple
                    hidden
                    disabled={disabled}
                    onChange={(e) => {
                      addFiles(e.target.files);
                      // Same file re-selected after a remove must re-fire onChange.
                      e.target.value = "";
                    }}
                  />
                </IconButton>
              </Tooltip>
            </Box>
            <InputBase
              fullWidth
              multiline
              maxRows={5}
              placeholder={hint ? "Waiting for the current turn…" : "Ask the agent to edit the spec…"}
              value={value}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              sx={{
                fontSize: "0.875rem",
                px: 0.5,
                py: 0,
                // Vertical padding zeroed so the text's box bottom IS the last
                // line's bottom, and the line box pinned to the number the
                // control slots align to. The breathing room lives on the
                // composer box instead.
                "& textarea": { lineHeight: `${LINE_HEIGHT}px` },
              }}
            />
            <Box sx={CONTROL_SLOT}>
              <IconButton
                color="primary"
                aria-label="Send message"
                // Text is required even with files attached: the shared TurnSpec
                // validator rejects an empty chat turn, and a bare screenshot
                // with no question is a turn the agent has to guess at.
                disabled={disabled || !value.trim()}
                onClick={onSubmit}
                sx={{ p: 0.5 }}
              >
                <Send size={16} />
              </IconButton>
            </Box>
          </Stack>
        </Box>
        {/* Keyed and dismissed by position, not by name: one selection can
            reject two files under the same name, and name identity would
            collapse them into one notice and then close both at once. */}
        {rejected.map(({ name, reason }, index) => (
          <Alert
            key={`${index}-${name}`}
            severity="warning"
            sx={{ mt: 1 }}
            onClose={() => setRejected((prev) => prev.filter((_, i) => i !== index))}
          >
            {/* The reason renders verbatim: lower-casing it turned "Larger than
                5 MB" into "5 mb" and mangled the casing of the user's own file
                name in the collision reason. */}
            <strong>{name}</strong> was not attached — {reason}.
          </Alert>
        ))}
      </Box>
    </Box>
  );
}
