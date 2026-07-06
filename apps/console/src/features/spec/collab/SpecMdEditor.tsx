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

import { Box, Typography } from "@wso2/oxygen-ui";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type * as Y from "yjs";

// Collaborative WYSIWYG editor for markdown spec files (#86 phase 6).
// The shared source of truth is the file's Y.XmlFragment (seeded server-side
// from the repo markdown; serialized back to markdown by the committer,
// phase 3). Yjs owns history, so StarterKit's undo/redo is disabled.
export function SpecMdEditor({
  fragment,
  path,
  provider,
  self,
}: {
  fragment: Y.XmlFragment;
  path: string;
  provider: HocuspocusProvider;
  self: { name: string; color: string };
}) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Markdown,
        Collaboration.configure({ fragment }),
        CollaborationCaret.configure({ provider, user: self }),
      ],
    },
    [fragment, provider],
  );

  return (
    <Box>
      <Box
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          px: 2,
          py: 1,
          minHeight: 480,
          cursor: "text",
          "&:focus-within": { borderColor: "primary.main" },
          // Tiptap emits a plain contenteditable; give it breathing room.
          "& .tiptap": { outline: "none", minHeight: 460 },
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
      <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
        {path} — live collaborative document; commits to GitHub arrive with
        the committer (#86 phase 3).
      </Typography>
    </Box>
  );
}
