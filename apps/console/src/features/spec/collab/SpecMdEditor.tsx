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
import { alpha, Box, Button, Paper, Stack, Typography } from "@wso2/oxygen-ui";
import { Check, Sparkles, X } from "@wso2/oxygen-ui-icons-react";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type * as Y from "yjs";
import { AgentInsertion } from "@aep/collab-doc";
import {
  acceptAll,
  acceptRange,
  agentRanges,
  rangeAt,
  rejectAll,
  rejectRange,
} from "./agentReview";
import { SpecMdToolbar } from "./SpecMdToolbar";

// Collaborative WYSIWYG editor for markdown spec files (#86 phase 6).
// The shared source of truth is the file's Y.XmlFragment (seeded server-side
// from the repo markdown; serialized back to markdown by the committer,
// phase 3). Yjs owns history, so StarterKit's undo/redo is disabled.
// Agent insertions arrive marked (agentInsertion) — highlighted for review;
// accept keeps the text, reject deletes it; the committer holds marked files
// out of interim flushes until reviewed.
export function SpecMdEditor({
  fragment,
  provider,
  self,
}: {
  fragment: Y.XmlFragment;
  provider: HocuspocusProvider;
  self: { name: string; color: string };
}) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Markdown,
        AgentInsertion,
        Collaboration.configure({ fragment }),
        CollaborationCaret.configure({ provider, user: self }),
      ],
    },
    [fragment, provider],
  );

  // Pending-review count, refreshed on every document change.
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const update = () => setPending(agentRanges(editor.state.doc).length);
    update();
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  return (
    <Box
      sx={{
        // The editor is a single framed card that fills the pane: toolbar
        // (and review bar) docked as header rows, only the document area
        // below them scrolls — text can never pass the toolbar (#206 rework).
        flexGrow: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        overflow: "hidden",
        // Plain paper token, same as AgentChatPanel — it re-resolves per
        // color scheme (a JS-resolved gradient froze the light paper into
        // dark mode and rendered gray; #206 D10 revision, 2026-07-12).
        bgcolor: "background.paper",
        "&:focus-within": { borderColor: "primary.main" },
      }}
    >
      {editor && (
        <>
          <SpecMdToolbar editor={editor} />
          {pending > 0 && (
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{
                flexShrink: 0,
                px: 1.5,
                py: 0.75,
                borderBottom: 1,
                borderColor: "divider",
                backgroundImage: (theme) =>
                  `linear-gradient(${alpha(theme.palette.primary.main, 0.08)}, ${alpha(
                    theme.palette.primary.main,
                    0.08,
                  )})`,
              }}
            >
              <Sparkles size={16} />
              <Typography variant="body2" sx={{ flexGrow: 1 }}>
                {pending} agent suggestion{pending === 1 ? "" : "s"} pending review
              </Typography>
              <Button
                size="small"
                color="inherit"
                startIcon={<X size={14} />}
                onClick={() => rejectAll(editor)}
              >
                Reject all
              </Button>
              <Button
                size="small"
                variant="contained"
                startIcon={<Check size={14} />}
                onClick={() => acceptAll(editor)}
              >
                Accept all
              </Button>
            </Stack>
          )}
        </>
      )}
      {editor && (
        <BubbleMenu
          editor={editor}
          shouldShow={({ state }) =>
            rangeAt(state.doc, state.selection.from) !== null
          }
        >
          <Paper elevation={3} sx={{ px: 1, py: 0.5 }}>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Typography variant="caption" color="text.secondary" sx={{ pr: 0.5 }}>
                {rangeAt(editor.state.doc, editor.state.selection.from)?.agent ||
                  "agent"}
              </Typography>
              <Button
                size="small"
                startIcon={<Check size={14} />}
                onClick={() => {
                  const r = rangeAt(editor.state.doc, editor.state.selection.from);
                  if (r) acceptRange(editor, r);
                }}
              >
                Accept
              </Button>
              <Button
                size="small"
                color="error"
                startIcon={<X size={14} />}
                onClick={() => {
                  const r = rangeAt(editor.state.doc, editor.state.selection.from);
                  if (r) rejectRange(editor, r);
                }}
              >
                Reject
              </Button>
            </Stack>
          </Paper>
        </BubbleMenu>
      )}
      <Box
        sx={{
          flexGrow: 1,
          minHeight: 0,
          overflow: "auto",
          px: 2,
          py: 1,
          cursor: "text",
          "& .tiptap": { outline: "none" },
          "& .tiptap p": { my: 1 },
          "& .tiptap h1, & .tiptap h2, & .tiptap h3": { mt: 2, mb: 1 },
          "& .tiptap ul, & .tiptap ol": { pl: 3 },
          "& .tiptap table": { borderCollapse: "collapse" },
          "& .tiptap th, & .tiptap td": {
            border: 1,
            borderColor: "divider",
            px: 1,
            py: 0.5,
          },
          // Unreviewed agent insertions (#86 ph6) — soft primary wash until
          // accepted (mark removed) or rejected (range deleted).
          "& .tiptap span.agent-insertion": {
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
            borderBottom: "2px solid",
            borderBottomColor: (theme) => alpha(theme.palette.primary.main, 0.4),
            borderRadius: "2px",
          },
          // Remote carets (CollaborationCaret): colored bar + name label.
          "& .collaboration-carets__caret": {
            borderLeft: "1px solid",
            borderRight: "1px solid",
            mx: "-1px",
            position: "relative",
            wordBreak: "normal",
          },
          "& .collaboration-carets__label": {
            borderRadius: "3px 3px 3px 0",
            color: "common.white",
            fontSize: "0.7rem",
            fontWeight: 600,
            left: "-1px",
            lineHeight: 1.2,
            px: 0.5,
            position: "absolute",
            top: "-1.3em",
            userSelect: "none",
            whiteSpace: "nowrap",
          },
        }}
        onClick={() => editor?.commands.focus()}
      >
        <EditorContent editor={editor} />
      </Box>
    </Box>
  );
}
