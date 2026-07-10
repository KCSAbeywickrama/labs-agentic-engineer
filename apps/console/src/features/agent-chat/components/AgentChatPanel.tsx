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

import { useEffect, useRef, useState } from "react";
import {
  alpha,
  Avatar,
  Box,
  Chip,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import { Check, Send, Sparkles, Wrench, X as XIcon } from "@wso2/oxygen-ui-icons-react";
import { useAgentChat } from "../useAgentChat";
import type { ChatMessage } from "../chatStore";
import {
  buildDesignGenerationInstruction,
  buildSpecGenerationInstruction,
  readCreatePrompt,
} from "../../projects/lib/promptStore";

export const AGENT_CHAT_PANEL_WIDTH = 380;

// The project AI panel (#130): legacy console's ChatPanel experience on the
// new stack — narration + tool cards; the agent's FILE edits arrive through
// the live spec room (collab turns), not through this panel.

function opLabel(op: string): string {
  switch (op) {
    case "add":
      return "Created";
    case "remove":
      return "Deleted";
    case "frontmatter":
      return "Updated field";
    default:
      return "Modified";
  }
}

function leafName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function MessageRow({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return (
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <Box
          sx={{
            maxWidth: "85%",
            px: 1.5,
            py: 1,
            borderRadius: 2,
            // Soft primary tint (chip-like), not the full brand color — a
            // solid primary bubble reads far too loud in a side panel.
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
            color: "text.primary",
            whiteSpace: "pre-wrap",
            fontSize: "0.875rem",
            opacity: msg.status === "failed" ? 0.6 : 1,
          }}
        >
          {msg.content}
        </Box>
      </Box>
    );
  }
  if (msg.role === "assistant") {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
        <Avatar sx={{ width: 24, height: 24, bgcolor: "primary.main" }}>
          <Sparkles size={14} />
        </Avatar>
        <Box
          sx={{
            maxWidth: "85%",
            px: 1.5,
            py: 1,
            borderRadius: 2,
            bgcolor: "action.hover",
            whiteSpace: "pre-wrap",
            fontSize: "0.875rem",
          }}
        >
          {msg.content}
        </Box>
      </Stack>
    );
  }
  if (msg.role === "tool") {
    return (
      <Stack
        data-testid="tool-card"
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
          ml: 4,
          px: 1.5,
          py: 0.75,
          borderRadius: 1.5,
          border: 1,
          borderColor: msg.ok ? "divider" : "error.main",
          bgcolor: "background.paper",
        }}
      >
        {msg.ok ? (
          <Check size={14} color="var(--oxygen-palette-success-main, green)" />
        ) : (
          <XIcon size={14} color="var(--oxygen-palette-error-main, red)" />
        )}
        <Wrench size={14} />
        <Typography variant="caption" color="text.secondary">
          {opLabel(msg.op)}
        </Typography>
        <Tooltip title={msg.path}>
          <Chip size="small" label={leafName(msg.path)} sx={{ maxWidth: 160 }} />
        </Tooltip>
        {!msg.ok && msg.errorText && (
          <Typography variant="caption" color="error" noWrap>
            {msg.errorText}
          </Typography>
        )}
      </Stack>
    );
  }
  return (
    <Box
      data-testid="chat-error"
      sx={{
        px: 1.5,
        py: 1,
        borderRadius: 2,
        border: 1,
        borderColor: "error.main",
        color: "error.main",
        fontSize: "0.8125rem",
        whiteSpace: "pre-wrap",
      }}
    >
      {msg.content}
    </Box>
  );
}

function ThinkingDots() {
  return (
    <Stack
      data-testid="thinking"
      direction="row"
      spacing={1}
      sx={{ alignItems: "center", ml: 4 }}
    >
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            bgcolor: "text.secondary",
            animation: "agentChatPulse 1.2s ease-in-out infinite",
            animationDelay: `${i * 0.2}s`,
            "@keyframes agentChatPulse": {
              "0%, 100%": { opacity: 0.25 },
              "50%": { opacity: 1 },
            },
          }}
        />
      ))}
    </Stack>
  );
}

export function AgentChatPanel({
  org,
  projectName,
  displayName,
  onClose,
  autoGenerate,
  onAutoGenerated,
}: {
  org: string;
  projectName: string;
  displayName?: string | undefined;
  onClose: () => void;
  /** Generation CTA (#150 spec / #159 design): auto-send the matching turn
   *  once — requirements seeded from the stored create prompt, design derived
   *  from the current requirements. */
  autoGenerate?: "requirements" | "design";
  /** Called after the auto-send fires, so the caller can clear the signal. */
  onAutoGenerated?: () => void;
}) {
  const { messages, isSending, send } = useAgentChat(org, projectName);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Follow the tail while streaming / on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isSending]);

  // One-shot generate (#150): fire exactly once per signal. `send` itself
  // no-ops if a turn is already running, so an in-flight generation isn't
  // duplicated by a stray re-open.
  const autoGenFiredRef = useRef(false);
  useEffect(() => {
    if (!autoGenerate || autoGenFiredRef.current) return;
    autoGenFiredRef.current = true;
    const instruction =
      autoGenerate === "design"
        ? buildDesignGenerationInstruction()
        : buildSpecGenerationInstruction(readCreatePrompt(org, projectName));
    send(instruction);
    onAutoGenerated?.();
  }, [autoGenerate, org, projectName, send, onAutoGenerated]);

  const submit = () => {
    if (!draft.trim() || isSending) return;
    send(draft);
    setDraft("");
  };

  return (
    <Box
      sx={{
        width: AGENT_CHAT_PANEL_WIDTH,
        flexShrink: 0,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderLeft: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      {/* Header */}
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", px: 2, py: 1.5 }}
      >
        <Sparkles size={18} />
        <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1 }}>
          Agent Chat
        </Typography>
        <IconButton size="small" aria-label="Close agent chat" onClick={onClose}>
          <XIcon size={16} />
        </IconButton>
      </Stack>
      <Divider />

      {/* Messages */}
      <Box ref={scrollRef} sx={{ flexGrow: 1, overflow: "auto", p: 2 }}>
        {messages.length === 0 ? (
          <Stack
            spacing={1.5}
            sx={{ alignItems: "center", textAlign: "center", mt: 6, px: 2 }}
          >
            <Avatar sx={{ width: 48, height: 48, bgcolor: "primary.main" }}>
              <Sparkles size={24} />
            </Avatar>
            <Typography variant="subtitle2">Hi! I&apos;m your Agent.</Typography>
            <Typography variant="body2" color="text.secondary">
              Ask me to edit this project&apos;s spec — I join the shared
              workspace and you can watch the files change live.
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            {messages.map((m) => (
              <MessageRow key={m.id} msg={m} />
            ))}
            {isSending && <ThinkingDots />}
          </Stack>
        )}
      </Box>

      {/* Context + input */}
      <Divider />
      <Box sx={{ p: 1.5 }}>
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <Chip size="small" variant="outlined" label={`project: ${displayName ?? projectName}`} />
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: "flex-end" }}>
          <TextField
            fullWidth
            multiline
            maxRows={5}
            size="small"
            placeholder="Ask the agent to edit the spec…"
            value={draft}
            disabled={isSending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <IconButton
            color="primary"
            aria-label="Send message"
            disabled={isSending || !draft.trim()}
            onClick={submit}
          >
            <Send size={18} />
          </IconButton>
        </Stack>
      </Box>
    </Box>
  );
}
