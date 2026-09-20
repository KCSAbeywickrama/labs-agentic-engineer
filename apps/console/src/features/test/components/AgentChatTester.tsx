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

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  alpha,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@wso2/oxygen-ui";
import { Bot, User, Wrench } from "@wso2/oxygen-ui-icons-react";
import { MarkdownView } from "../../../components/MarkdownView";
import { publishedTestUsers } from "../../projects/lib/publishedTestUsers";
import { useProjectRoles } from "../../spec/api/roles";
import { sendChat } from "../api/invoke";

/** No test user to act as: the relay goes out as the signed-in person. */
const AS_CALLER = "";

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
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Pin to the newest turn. A reply can be many lines long, so without this the
  // answer you just asked for lands below the fold and the thread looks stuck.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, sending]);
  const [notReachable, setNotReachable] = useState(false);
  const [invokeError, setInvokeError] = useState<string | null>(null);

  // WHO the turn is sent as. A protected agent accepts only a token from the
  // project's own identity provider, and the console's sign-in is not one — so
  // the tester acts as one of the project's test users, the same accounts
  // validation signs in with. The picker chooses WHICH one, never whether: a
  // project with no test users has nothing to act as, and the relay goes out
  // as the caller, which a protected agent will refuse — the notice below then
  // names the one thing that fixes it.
  const roles = useProjectRoles(projectName, true);
  const testUsers = publishedTestUsers(roles.data?.testUsers ?? []);
  const [actAs, setActAs] = useState<string | undefined>(undefined);
  const chosen = actAs ?? testUsers[0]?.username ?? AS_CALLER;

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
    // `notReachable` is a memory of one 409, not a live fact — a deploy that
    // has since finished does not retract it. Leaving it set kept the input
    // disabled forever, and this button, the one thing offering a way out,
    // was the only reset that did not clear it.
    setNotReachable(false);
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
        ...(chosen !== AS_CALLER ? { actAs: chosen } : {}),
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
            {
              kind: "notice",
              text:
                chosen === AS_CALLER
                  ? "This agent requires the project's sign-in, which the console's session is not. Declare a test user in specs/design/security.json and rebuild; Try it then signs in as it."
                  : `The agent refused ${chosen}'s token. Rotate that test user's password from the Security panel and try again.`,
            },
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
    } catch (err) {
      // The client rethrows a transport failure (dropped Wi-Fi, DNS, CORS)
      // rather than returning it, and `send` is invoked as `void send()`, so
      // without this the rejection escapes to the window: the user would see
      // no banner at all and the turn would still read as delivered.
      setInvokeError(err instanceof Error ? err.message : "Failed to reach the agent");
      setEntries(markLastUndelivered);
    } finally {
      setSending(false);
    }
  }, [chosen, componentName, conversationId, draft, projectName, sending]);

  const blocked = notReachable || deployKnowledge === "unreachable";

  return (
    <Stack sx={{ height: "100%", minHeight: 0 }}>
      {/* One surface holding who you are talking to and the only control that
          resets the thread, so the chrome reads as a header rather than three
          things floating above the transcript. */}
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{ px: 2, py: 1.5, flexShrink: 0 }}
      >
        <Avatar sx={{ width: 28, height: 28, bgcolor: "primary.main" }}>
          <Bot size={16} />
        </Avatar>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
            {componentName}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {chosen === AS_CALLER
              ? "Talks to the live agent, on the organisation's model key"
              : `Talks to the live agent as ${chosen}, on the organisation's model key`}
          </Typography>
        </Box>
        {testUsers.length > 0 && (
          <TextField
            select
            size="small"
            label="Test as"
            value={chosen}
            onChange={(e) => {
              setActAs(e.target.value);
              newConversation();
            }}
            sx={{ minWidth: 200 }}
            inputProps={{ "aria-label": "Test as" }}
          >
            {testUsers.map((u) => (
              <MenuItem key={u.username} value={u.username}>
                {u.username}
                {u.roles.length > 0 ? ` — ${u.roles.join(", ")}` : ""}
              </MenuItem>
            ))}
          </TextField>
        )}
        <Button size="small" onClick={newConversation}>
          New conversation
        </Button>
      </Stack>
      <Divider />

      <Box sx={{ px: 2, pt: blocked || invokeError ? 2 : 0 }}>
        {blocked && (
          <Alert severity="info">
            This agent is not reachable yet — it has no deployed gateway URL.
          </Alert>
        )}
        {invokeError && <Alert severity="error">{invokeError}</Alert>}
      </Box>

      {/* minHeight:0 is what actually makes this scroll: without it a flex
          child refuses to shrink below its content and the whole page scrolls
          instead, carrying the composer off-screen as the thread grows. */}
      <Stack
        spacing={2.5}
        ref={scrollRef}
        sx={{ flexGrow: 1, minHeight: 0, overflowY: "auto", px: 2, py: 2.5 }}
      >
        {entries.length === 0 && !blocked ? (
          <Stack spacing={1} alignItems="center" sx={{ my: "auto", textAlign: "center" }}>
            <Avatar sx={{ width: 40, height: 40, bgcolor: "action.hover", color: "text.secondary" }}>
              <Bot size={20} />
            </Avatar>
            <Typography variant="body2" color="text.secondary">
              Send a message to try this agent.
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Each turn runs the real agent and its tools.
            </Typography>
          </Stack>
        ) : (
          entries.map((entry, index) => <TranscriptEntry key={index} entry={entry} />)
        )}
      </Stack>

      <Divider />
      <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 2, flexShrink: 0 }}>
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
  const isUser = entry.kind === "user";
  const failed = isUser && !entry.delivered;

  // Matches the console's own chat (features/agent-chat/MessageList): a human
  // turn gets a tinted bubble on the right, the agent stays flat on the left as
  // an activity stream. Keeping the two consistent is the point — a second chat
  // that invents its own conventions reads as a different product.
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
      <Stack
        direction={isUser ? "row-reverse" : "row"}
        spacing={1}
        sx={{ alignItems: "center", mb: 0.5 }}
      >
        <Avatar
          sx={{
            width: 22,
            height: 22,
            bgcolor: isUser ? "primary.main" : "info.main",
          }}
        >
          {isUser ? <User size={12} /> : <Bot size={12} />}
        </Avatar>
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          {isUser ? "You" : "Agent"}
        </Typography>
        {failed && (
          <Typography variant="caption" color="error">
            not delivered
          </Typography>
        )}
      </Stack>

      {isUser ? (
        <Box
          sx={{
            maxWidth: "85%",
            px: 1.5,
            py: 1,
            borderRadius: 2,
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
            opacity: failed ? 0.6 : 1,
          }}
        >
          <Typography sx={{ whiteSpace: "pre-wrap", fontSize: "0.875rem" }}>
            {entry.text}
          </Typography>
        </Box>
      ) : (
        // Agents reply in markdown — bold, lists, numbered options. Rendering
        // it as plain text put literal ** around every emphasis on screen.
        <Box sx={{ maxWidth: "85%" }}>
          <MarkdownView>{entry.text}</MarkdownView>
        </Box>
      )}

      {entry.kind === "assistant" && entry.toolCalls.length > 0 && (
        <ToolCalls calls={entry.toolCalls} />
      )}
    </Box>
  );
}

/**
 * The tool trail, on an indented rail like the spec chat's activity steps.
 * This is what the tester exists to show: proof the agent actually reached for
 * its API instead of answering from the model's own memory. Each call names the
 * tool up front, with the raw arguments a click away — the name is the fact you
 * scan for, the payload is the evidence you check.
 */
function ToolCalls({ calls }: { calls: unknown[] }) {
  return (
    <Box sx={{ borderLeft: 2, borderColor: "divider", ml: 1, pl: 2, mt: 1, maxWidth: "85%" }}>
      <Stack spacing={0.5}>
        {calls.map((call, index) => {
          const name = toolNameOf(call);
          return (
            <Box key={index} component="details">
              <Stack
                component="summary"
                direction="row"
                spacing={0.75}
                sx={{ cursor: "pointer", alignItems: "center", color: "text.secondary" }}
              >
                <Wrench size={12} />
                <Typography variant="caption">
                  {name ? `called ${name}` : "tool call"}
                </Typography>
              </Stack>
              <Box
                component="pre"
                sx={{
                  whiteSpace: "pre-wrap",
                  fontSize: "0.75rem",
                  fontFamily: "monospace",
                  bgcolor: "action.hover",
                  borderRadius: 1,
                  p: 1,
                  m: 0,
                  mt: 0.5,
                  overflowX: "auto",
                }}
              >
                {JSON.stringify(call, null, 2)}
              </Box>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}

/** `toolName` if the call carries one — read defensively; it is the agent's shape, not ours. */
function toolNameOf(call: unknown): string | null {
  if (typeof call !== "object" || call === null) return null;
  const name = (call as { toolName?: unknown }).toolName;
  return typeof name === "string" && name !== "" ? name : null;
}

// The turn just attempted is the last user entry; nothing else can be the one
// that failed, because Send is serialised for the whole turn.
function markLastUndelivered(entries: Entry[]): Entry[] {
  const last = entries.length - 1;
  const entry = entries[last];
  if (!entry || entry.kind !== "user") return entries;
  return [...entries.slice(0, last), { ...entry, delivered: false }];
}
