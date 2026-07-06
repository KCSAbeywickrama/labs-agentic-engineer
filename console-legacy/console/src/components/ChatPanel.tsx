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

/**
 * Requirements-chat panel — committed-truth model (shared-volume-clone D13/D16).
 *
 * A multi-turn conversation against the resumable turn endpoints. Each send is
 * `startTurn` (instruction only — no file payload; the backend snapshots HEAD)
 * followed by `attachTurnStream`, whose display-only fold streams assistant
 * text and tool cards into this panel and live file snapshots onto the
 * turn-activity bus (the requirements page mirrors them). When the terminal
 * `turn-committed` event lands, the page refetches the server tree — the
 * commit is the backend's, the fold here is cosmetic. Undo is gone: every
 * turn commits to `main`; reverting is the Discard (revert) endpoint's job.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
  Box,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@wso2/oxygen-ui';
import { ArrowUp, Check, Sparkles, Wrench, X } from '@wso2/oxygen-ui-icons-react';
import {
  type ChatMessage,
  type ProjectKey,
  type ToolMessage,
  type UserMessage,
  appendAssistantText,
  appendErrorMessage,
  appendUserMessage,
  dropTurnMessages,
  getChatConversationId,
  getChatMessages,
  nextId,
  opDisplayLabel,
  publishTurnActivity,
  setChatConversationId,
  setChatMessages,
  setChatPanelOpen,
  setTurnStatus,
  subscribeChatStore,
  upsertToolMessage,
} from '../services/chatStore';
import {
  attachTurnStream,
  getActiveTurn,
  getConversation,
  newConversationId,
  startTurn,
  turnErrorMessage,
  type ConversationMessage,
  type TurnResult,
} from '../services/api/turns';
import { readTree } from '../services/api/files';

// ---------------------------------------------------------------------------
// Tab routing — chat is wired for the requirements tab only in v1.
// ---------------------------------------------------------------------------

function resolveTabLabel(pathname: string): string {
  if (pathname.includes('/requirements')) return 'Requirements';
  if (pathname.includes('/architecture')) return 'Architecture';
  if (pathname.includes('/implementation-plan')) return 'Implementation Plan';
  if (pathname.includes('/components/')) return 'Component';
  if (pathname.includes('/components')) return 'Components';
  return 'Overview';
}

function resolveTabKey(pathname: string): string {
  if (pathname.includes('/requirements')) return 'requirements';
  if (pathname.includes('/architecture')) return 'architecture';
  if (pathname.includes('/implementation-plan')) return 'implementation-plan';
  if (pathname.includes('/components')) return 'components';
  return 'overview';
}

/** Map a rehydrated `ModelMessage[]` to the display log (user/assistant text only). */
function toDisplayMessages(messages: ConversationMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text =
      typeof m.content === 'string'
        ? m.content
        : m.content
            .map((p) => (p.type === 'text' ? (p.text ?? '') : ''))
            .join('')
            .trim();
    if (!text) continue;
    if (m.role === 'user') {
      out.push({ id: nextId('u'), role: 'user', content: text, timestamp: Date.now(), turnStatus: 'completed' });
    } else {
      out.push({ id: nextId('a'), role: 'assistant', content: text, timestamp: Date.now() });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Message bubbles
// ---------------------------------------------------------------------------

function UserBubble({ message }: { message: UserMessage }) {
  const theme = useTheme();
  return (
    <Stack alignItems="flex-end" sx={{ mb: 1.5 }} gap={0.5}>
      <Box
        sx={{
          maxWidth: '85%',
          px: 2,
          py: 1.25,
          borderRadius: '16px 16px 4px 16px',
          bgcolor: theme.vars?.palette.primary.main ?? 'primary.main',
          color: theme.vars?.palette.primary.contrastText ?? '#fff',
        }}
      >
        <Typography variant="body2" sx={{ lineHeight: 1.6, fontSize: '0.8125rem' }}>
          {message.content}
        </Typography>
      </Box>
    </Stack>
  );
}

function renderMarkdownLite(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

function AssistantBubble({ content }: { content: string }) {
  const theme = useTheme();
  return (
    <Stack direction="row" alignItems="flex-start" gap={1} sx={{ mb: 1.5 }}>
      <Box
        sx={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          bgcolor: theme.vars?.palette.action?.selected ?? 'action.selected',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          mt: 0.25,
        }}
      >
        <Sparkles size={14} />
      </Box>
      <Box
        sx={{
          maxWidth: '85%',
          px: 2,
          py: 1.25,
          borderRadius: '16px 16px 16px 4px',
          bgcolor: theme.vars?.palette.action?.hover ?? 'action.hover',
        }}
      >
        <Typography variant="body2" sx={{ lineHeight: 1.6, fontSize: '0.8125rem', whiteSpace: 'pre-wrap' }}>
          {renderMarkdownLite(content)}
        </Typography>
      </Box>
    </Stack>
  );
}

/** A folded file mutation, projected from one `tool-result` frame. */
function ToolCard({ msg }: { msg: ToolMessage }) {
  const theme = useTheme();
  const isError = msg.toolStatus === 'error';
  const borderColor = isError
    ? theme.vars?.palette.error?.main ?? 'error.main'
    : theme.vars?.palette.success?.main ?? 'success.main';
  const bg = isError ? 'rgba(244, 67, 54, 0.06)' : 'rgba(76, 175, 80, 0.06)';
  // Show the leaf filename; the full spec path is the tooltip.
  const leaf = msg.path.split('/').pop() || msg.path;

  return (
    <Stack
      direction="row"
      alignItems="flex-start"
      gap={1}
      sx={{ mb: 1.5 }}
      data-testid="tool-card"
      data-tool-name={msg.toolName}
      data-tool-path={msg.path}
      data-tool-status={msg.toolStatus}
    >
      <Box sx={{ width: 28, flexShrink: 0 }} />
      <Box sx={{ width: '100%', border: '1px solid', borderColor, borderRadius: 2, overflow: 'hidden' }}>
        <Stack direction="row" alignItems="center" gap={1} sx={{ px: 1.5, py: 1, bgcolor: bg }}>
          {isError ? (
            <X size={14} color={(theme.vars?.palette.error?.main as string) ?? '#e53935'} />
          ) : (
            <Check size={14} color={(theme.vars?.palette.success?.main as string) ?? '#4caf50'} />
          )}
          <Wrench size={12} style={{ opacity: 0.5 }} />
          <Typography variant="caption" fontWeight={600} sx={{ fontSize: '0.75rem' }}>
            {opDisplayLabel(msg.op)}
          </Typography>
          <Chip
            title={msg.path}
            label={leaf}
            size="small"
            sx={{ height: 18, fontSize: '0.65rem', '& .MuiChip-label': { px: 0.5 } }}
          />
        </Stack>
        {isError && msg.toolErrorText && (
          <Box sx={{ px: 1.5, py: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
            <Typography variant="caption" color="error" sx={{ fontSize: '0.7rem' }}>
              {msg.toolErrorText}
            </Typography>
          </Box>
        )}
      </Box>
    </Stack>
  );
}

function ErrorBubble({ message }: { message: ChatMessage }) {
  return (
    <Stack direction="row" alignItems="flex-start" gap={1} sx={{ mb: 1.5 }} data-testid="chat-error">
      <Box sx={{ width: 28, flexShrink: 0 }} />
      <Box
        sx={{
          width: '100%',
          border: '1px solid',
          borderColor: 'error.main',
          borderRadius: 2,
          px: 1.5,
          py: 1,
          bgcolor: 'rgba(244, 67, 54, 0.08)',
        }}
      >
        <Typography variant="caption" color="error" sx={{ fontSize: '0.75rem' }}>
          {message.content}
        </Typography>
      </Box>
    </Stack>
  );
}

function ThinkingIndicator() {
  const theme = useTheme();
  return (
    <Stack direction="row" alignItems="flex-start" gap={1} sx={{ mb: 1.5 }} data-testid="thinking">
      <Box
        sx={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          bgcolor: theme.vars?.palette.action?.selected ?? 'action.selected',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Sparkles size={14} />
      </Box>
      <Box sx={{ px: 2, py: 1.25, borderRadius: '16px 16px 16px 4px', bgcolor: theme.vars?.palette.action?.hover ?? 'action.hover' }}>
        <Stack direction="row" gap={0.5} alignItems="center">
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'text.disabled', animation: 'pulse 1.4s ease-in-out infinite' }} />
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'text.disabled', animation: 'pulse 1.4s ease-in-out 0.2s infinite' }} />
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'text.disabled', animation: 'pulse 1.4s ease-in-out 0.4s infinite' }} />
        </Stack>
      </Box>
    </Stack>
  );
}

function getGreeting(tab: string): string {
  return tab === 'requirements'
    ? 'I can refine the requirements bundle — ask me to add features, tighten FRs, or extend the wireframes.'
    : 'Chat is currently available on the requirements tab.';
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

const PANEL_WIDTH = 380;

export default function ChatPanel({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const location = useLocation();
  const { orgId, projectId } = useParams();

  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const tabLabel = resolveTabLabel(location.pathname);
  const tabKey = resolveTabKey(location.pathname);
  const isChatEnabledTab = tabKey === 'requirements';

  const effectiveOrgId = orgId ?? '';
  const effectiveProjectId = projectId ?? '';
  const projectKey = useMemo<ProjectKey>(
    () => ({ orgId: effectiveOrgId, projectId: effectiveProjectId }),
    [effectiveOrgId, effectiveProjectId],
  );

  const projectDisplayName = effectiveProjectId
    ? effectiveProjectId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Project';

  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    getChatMessages(effectiveOrgId, effectiveProjectId),
  );
  useEffect(() => {
    setMessages(getChatMessages(effectiveOrgId, effectiveProjectId));
    return subscribeChatStore(() => setMessages(getChatMessages(effectiveOrgId, effectiveProjectId)));
  }, [effectiveOrgId, effectiveProjectId]);

  // Rehydrate history from the server when local history is empty but a
  // conversation exists (refresh recovery — server truth, no local draft).
  useEffect(() => {
    if (!effectiveOrgId || !effectiveProjectId) return;
    if (getChatMessages(effectiveOrgId, effectiveProjectId).length > 0) return;
    const convId = getChatConversationId(projectKey);
    if (!convId) return;
    let cancelled = false;
    (async () => {
      const server = await getConversation(effectiveProjectId, convId);
      if (cancelled) return;
      const display = toDisplayMessages(server);
      if (display.length > 0) setChatMessages(projectKey, display);
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveOrgId, effectiveProjectId, projectKey]);

  useEffect(() => {
    setChatPanelOpen(true);
    return () => setChatPanelOpen(false);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  /**
   * Attach one turn's stream and drive the chat display: assistant text, tool
   * cards, live file snapshots (published on the turn-activity bus so the
   * requirements page mirrors them), and the terminal outcome. `displayTurnId`
   * is the local message-log id (NOT the server turn id).
   */
  const streamChatTurn = useCallback(
    async (serverTurnId: string, displayTurnId: string, signal?: AbortSignal) => {
      publishTurnActivity({ kind: 'turnStarted', orgId: effectiveOrgId, projectId: effectiveProjectId });
      let result: TurnResult;
      try {
        // The display fold replays on top of the CURRENT server tree — the
        // committed truth the backend snapshotted for the turn.
        const seed = await readTree(effectiveProjectId, 'specs/')
          .then((t) => t.files)
          .catch(() => ({}) as Record<string, string>);
        result = await attachTurnStream(effectiveProjectId, serverTurnId, {
          from: 0,
          seed,
          signal,
          handlers: {
            onText: (delta) => appendAssistantText(projectKey, displayTurnId, delta),
            onSnapshot: (files) =>
              publishTurnActivity({
                kind: 'turnSnapshot',
                orgId: effectiveOrgId,
                projectId: effectiveProjectId,
                files,
              }),
            onChange: (change) => {
              const res = change.result;
              upsertToolMessage(projectKey, {
                id: change.toolCallId || nextId('tool'),
                role: 'tool',
                content: '',
                timestamp: Date.now(),
                turnId: displayTurnId,
                toolName: change.toolName,
                op: change.op,
                path: change.path,
                toolStatus: res.ok ? 'done' : 'error',
                toolErrorText: res.ok ? undefined : res.message,
                toolErrorCode: res.ok ? undefined : res.code,
              });
            },
          },
        });
      } catch (err) {
        if (signal?.aborted) {
          // Unmount/StrictMode abort: the turn keeps running server-side; a
          // remount's active-turn check re-attaches. Not an outcome.
          publishTurnActivity({ kind: 'turnEnded', orgId: effectiveOrgId, projectId: effectiveProjectId, committed: false });
          return;
        }
        result = {
          ok: false,
          code: 'request_failed',
          message: err instanceof Error && err.message ? err.message : 'The chat turn failed.',
        };
      }
      publishTurnActivity({
        kind: 'turnEnded',
        orgId: effectiveOrgId,
        projectId: effectiveProjectId,
        committed: result.ok,
      });
      if (result.ok) {
        setTurnStatus(projectKey, displayTurnId, 'completed');
      } else {
        appendErrorMessage(projectKey, displayTurnId, turnErrorMessage(result), result.code);
        setTurnStatus(projectKey, displayTurnId, 'failed');
      }
    },
    [effectiveOrgId, effectiveProjectId, projectKey],
  );

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending || !isChatEnabledTab) return;
    if (!effectiveOrgId || !effectiveProjectId) return;

    setInput('');
    setIsSending(true);

    // One conversation id across the whole chat session.
    let convId = getChatConversationId(projectKey);
    if (!convId) {
      convId = newConversationId();
      setChatConversationId(projectKey, convId);
    }

    const turnId = nextId('t');
    appendUserMessage(projectKey, trimmed, turnId);

    const start = await startTurn(effectiveProjectId, convId, {
      useCase: 'requirements-chat',
      instruction: trimmed,
    });
    if (!start.ok) {
      // One active turn per project (D18): a 409 here means some other
      // generation is running — the pages own the viewer attach; chat just
      // reports it.
      appendErrorMessage(projectKey, turnId, turnErrorMessage(start), start.code);
      setTurnStatus(projectKey, turnId, 'failed');
      setIsSending(false);
      return;
    }
    await streamChatTurn(start.turnId, turnId);
    setIsSending(false);
  }, [input, isSending, isChatEnabledTab, effectiveOrgId, effectiveProjectId, projectKey, streamChatTurn]);

  // Refresh-mid-chat recovery (D16): a running requirements-chat turn is
  // re-attached from index 0. Any partial output persisted before the refresh
  // is dropped first — the replay re-streams the same frames.
  useEffect(() => {
    if (!effectiveOrgId || !effectiveProjectId) return;
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      const active = await getActiveTurn(effectiveProjectId).catch(() => null);
      if (cancelled || !active || active.status !== 'running') return;
      if (active.useCase !== 'requirements-chat') return;
      const inFlight = [...getChatMessages(effectiveOrgId, effectiveProjectId)]
        .reverse()
        .find((m): m is UserMessage => m.role === 'user' && m.turnStatus === 'in_flight');
      const displayTurnId = inFlight?.turnId ?? nextId('t');
      if (inFlight?.turnId) dropTurnMessages(projectKey, inFlight.turnId);
      setIsSending(true);
      try {
        await streamChatTurn(active.turnId, displayTurnId, controller.signal);
      } finally {
        if (!cancelled) setIsSending(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [effectiveOrgId, effectiveProjectId, projectKey, streamChatTurn]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const showGreeting = messages.length === 0;

  return (
    <>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      <Box
        sx={{
          width: PANEL_WIDTH,
          flexShrink: 0,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: theme.vars?.palette.background?.paper ?? 'background.paper',
          borderLeft: '1px solid',
          borderColor: 'divider',
          animation: 'fadeIn 0.18s ease-out',
        }}
        data-testid="chat-panel"
      >
        <Box
          sx={{
            px: 2,
            py: 1.25,
            bgcolor: 'background.paper',
            color: 'text.primary',
            borderBottom: '1px solid',
            borderColor: 'divider',
            flexShrink: 0,
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Stack direction="row" alignItems="center" gap={1}>
              <Sparkles size={18} color={theme.vars?.palette.primary.main as string} />
              <Typography variant="body2" fontWeight={700}>
                Agent Chat
              </Typography>
            </Stack>
            <IconButton size="small" sx={{ color: 'text.secondary' }} onClick={onClose}>
              <X size={16} />
            </IconButton>
          </Stack>
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2 }}>
          {showGreeting && (
            <Stack alignItems="center" sx={{ mt: 4, mb: 3, px: 1 }}>
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  bgcolor: theme.vars?.palette.action?.selected ?? 'action.selected',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mb: 2,
                }}
              >
                <Sparkles size={24} />
              </Box>
              <Typography variant="body2" fontWeight={600} sx={{ mb: 1, textAlign: 'center' }}>
                Hi! I'm your Agent.
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textAlign: 'center', lineHeight: 1.6, fontSize: '0.75rem' }}
              >
                {getGreeting(tabKey)}
              </Typography>
            </Stack>
          )}

          {messages.map((msg) => {
            if (msg.role === 'user') return <UserBubble key={msg.id} message={msg} />;
            if (msg.role === 'assistant') return <AssistantBubble key={msg.id} content={msg.content} />;
            if (msg.role === 'tool') return <ToolCard key={msg.id} msg={msg} />;
            if (msg.role === 'error') return <ErrorBubble key={msg.id} message={msg} />;
            return null;
          })}

          {isSending && <ThinkingIndicator />}

          <div ref={messagesEndRef} />
        </Box>

        <Divider />

        <Box sx={{ px: 2, pt: 1, pb: 1.5, flexShrink: 0 }}>
          <Stack direction="row" alignItems="center" gap={0.75} sx={{ mb: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
              project:
            </Typography>
            <Chip
              label={projectDisplayName}
              size="small"
              variant="outlined"
              sx={{ height: 20, fontSize: '0.65rem', fontWeight: 600, '& .MuiChip-label': { px: 0.75 } }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
              context:
            </Typography>
            <Chip
              label={tabLabel}
              size="small"
              color="primary"
              variant="outlined"
              sx={{ height: 20, fontSize: '0.65rem', fontWeight: 600, '& .MuiChip-label': { px: 0.75 } }}
            />
          </Stack>
          <Stack direction="row" alignItems="flex-end" gap={1}>
            <TextField
              inputRef={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isChatEnabledTab
                  ? 'Describe a change to the requirements...'
                  : 'Chat is currently available on the requirements tab.'
              }
              disabled={!isChatEnabledTab || isSending}
              multiline
              minRows={3}
              maxRows={6}
              fullWidth
              size="small"
              data-testid="chat-input"
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 1,
                  fontSize: '0.8125rem',
                  alignItems: 'flex-start',
                },
              }}
            />
            <IconButton
              color="primary"
              onClick={() => void handleSend()}
              disabled={!input.trim() || isSending || !isChatEnabledTab}
              data-testid="chat-send"
              sx={{
                bgcolor: input.trim() && !isSending ? (theme.vars?.palette.primary.main ?? 'primary.main') : undefined,
                color: input.trim() && !isSending ? (theme.vars?.palette.primary.contrastText ?? '#fff') : undefined,
                width: 36,
                height: 36,
                // Never let the fullWidth input squeeze the button below its
                // 36px hit target next to the multiline field.
                flexShrink: 0,
                // Lift the button in its own stacking context so it always wins
                // the hit-test at its coordinates (MUI ButtonBase is already
                // position:relative, so zIndex applies without changing layout —
                // unlike putting position on the panel wrapper, which shifted it).
                position: 'relative',
                zIndex: 1,
                '&:hover': input.trim() && !isSending ? { bgcolor: theme.vars?.palette.primary.dark ?? 'primary.dark' } : {},
              }}
            >
              {isSending ? <CircularProgress size={16} /> : <ArrowUp size={18} />}
            </IconButton>
          </Stack>
        </Box>
      </Box>
    </>
  );
}
