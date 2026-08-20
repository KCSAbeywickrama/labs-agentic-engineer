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

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@wso2/oxygen-ui";
import { sendChat } from "../api/invoke";

// What the tester holds, and all it holds (ADR-0020 / the Test tab spec): the
// rendered transcript and the agent-issued conversationId. No message array is
// assembled here, and nothing is persisted — the console's tester is
// deliberately ephemeral; persistence guidance belongs to the generated web app.
type Entry =
  // `delivered: false` marks a turn that produced no answer at all (the relay
  // refused, or the network died). The message is left in the transcript
  // rather than removed — the user typed it and may retype it — but it must
  // not read as a completed turn, or a retry looks like two delivered sends.
  | { kind: "user"; text: string; delivered: boolean }
  | { kind: "assistant"; text: string; toolCalls: unknown[] }
  | { kind: "notice"; text: string }
  | { kind: "upstream"; status: number; body: string; truncated: boolean };

/**
 * What the deployments read knows about this agent. "unknown" is the read
 * still in flight — it must not be collapsed into "unreachable", or every
 * deployed agent is libelled (and its input disabled) until the first poll
 * returns.
 */
export type DeployKnowledge = "unknown" | "ready" | "unreachable";

export function AgentChatTester({
  projectName,
  componentName,
  deployKnowledge,
}: {
  projectName: string;
  componentName: string;
  deployKnowledge: DeployKnowledge;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notReachable, setNotReachable] = useState(false);
  const [invokeError, setInvokeError] = useState<string | null>(null);

  // Switching agents is a new conversation with a new correspondent: the old
  // id belongs to the old agent's store and would 404 against this one.
  useEffect(() => {
    setEntries([]);
    setConversationId(undefined);
    setNotReachable(false);
    setInvokeError(null);
  }, [componentName]);

  const newConversation = useCallback(() => {
    setEntries([]);
    setConversationId(undefined);
    setInvokeError(null);
  }, []);

  const send = useCallback(async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setDraft("");
    setInvokeError(null);
    setEntries((prev) => [...prev, { kind: "user", text: message, delivered: true }]);
    setSending(true);
    try {
      const result = await sendChat(projectName, componentName, {
        ...(conversationId ? { conversationId } : {}),
        message,
      });
      switch (result.kind) {
        case "reply":
          setConversationId(result.conversationId);
          setEntries((prev) => [
            ...prev,
            { kind: "assistant", text: result.text, toolCalls: result.toolCalls },
          ]);
          break;
        case "conversation-expired":
          // The id is gone or was never this user's; retrying it would only
          // 404 again, so drop it and let the next turn start a conversation.
          setConversationId(undefined);
          setEntries((prev) => [
            ...prev,
            { kind: "notice", text: "That conversation expired. Starting a fresh one." },
          ]);
          break;
        case "session-expired":
          setEntries((prev) => [
            ...prev,
            { kind: "notice", text: "This session can't reach the agent — sign in again?" },
          ]);
          break;
        case "upstream-error":
          setEntries((prev) => [
            ...prev,
            {
              kind: "upstream",
              status: result.status,
              body: result.body,
              truncated: result.truncated,
            },
          ]);
          break;
        case "not-reachable":
          setNotReachable(true);
          setEntries(markLastUndelivered);
          break;
        case "invoke-error":
          setInvokeError(result.message);
          setEntries(markLastUndelivered);
          break;
      }
    } finally {
      setSending(false);
    }
  }, [componentName, conversationId, draft, projectName, sending]);

  const blocked = notReachable || deployKnowledge === "unreachable";

  return (
    <Stack spacing={2} sx={{ height: "100%" }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
          {componentName}
        </Typography>
        <Button size="small" onClick={newConversation}>
          New conversation
        </Button>
      </Stack>

      <Typography variant="body2" color="text.secondary">
        This talks to the live agent on the organisation&apos;s model key.
      </Typography>

      {blocked && (
        <Alert severity="info">
          This agent is not reachable yet — it has no deployed gateway URL.
        </Alert>
      )}
      {invokeError && <Alert severity="error">{invokeError}</Alert>}

      <Stack spacing={1.5} sx={{ flexGrow: 1, overflowY: "auto" }}>
        {entries.map((entry, index) => (
          <TranscriptEntry key={index} entry={entry} />
        ))}
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          label="Message"
          size="small"
          fullWidth
          value={draft}
          disabled={blocked}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        {sending && <CircularProgress size={20} aria-label="Sending" />}
        {/* Send is disabled for the whole turn: the tester holds ONE
            conversationId, and a second turn started before the first returns
            would race to overwrite it — the later reply's id could be lost to
            the earlier one. Serialising turns is the mitigation the spec asks
            for; the alternative (queueing) buys nothing a tester needs. */}
        <Button
          variant="contained"
          disabled={blocked || sending || draft.trim().length === 0}
          onClick={() => void send()}
        >
          Send
        </Button>
      </Stack>
    </Stack>
  );
}

function TranscriptEntry({ entry }: { entry: Entry }) {
  if (entry.kind === "notice") {
    return <Alert severity="warning">{entry.text}</Alert>;
  }
  if (entry.kind === "upstream") {
    // Not swallowed: the status and the raw body are the evidence a tester
    // came for, collapsed so a long body doesn't bury the transcript.
    return (
      <Alert severity="error">
        <Box component="details">
          <Box component="summary">The agent answered {entry.status}.</Box>
          {entry.truncated && (
            <Typography variant="caption" display="block" sx={{ mt: 1 }}>
              The relay cut this body short at its 1 MiB cap.
            </Typography>
          )}
          <Box component="pre" sx={{ whiteSpace: "pre-wrap", m: 0, mt: 1 }}>
            {entry.body}
          </Box>
        </Box>
      </Alert>
    );
  }
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {entry.kind === "user"
          ? entry.delivered
            ? "You"
            : "You · not delivered"
          : "Agent"}
      </Typography>
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
        {entry.text}
      </Typography>
      {entry.kind === "assistant" && entry.toolCalls.length > 0 && (
        <Box component="details" sx={{ mt: 0.5 }}>
          <Box component="summary" sx={{ cursor: "pointer", fontSize: "0.75rem" }}>
            {entry.toolCalls.length === 1 ? "1 tool call" : `${entry.toolCalls.length} tool calls`}
          </Box>
          <Box
            component="pre"
            sx={{ whiteSpace: "pre-wrap", fontSize: "0.75rem", m: 0, mt: 0.5 }}
          >
            {JSON.stringify(entry.toolCalls, null, 2)}
          </Box>
        </Box>
      )}
    </Box>
  );
}

// The turn just attempted is the last user entry; nothing else can be the one
// that failed, because Send is serialised for the whole turn.
function markLastUndelivered(entries: Entry[]): Entry[] {
  const last = entries.length - 1;
  const entry = entries[last];
  if (!entry || entry.kind !== "user") return entries;
  return [...entries.slice(0, last), { ...entry, delivered: false }];
}
