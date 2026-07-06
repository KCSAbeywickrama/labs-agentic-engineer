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
 * Per-project chat store backing the requirements chat panel.
 *
 * Committed-truth model (shared-volume-clone D13): every chat turn commits
 * server-side; the console holds no draft. This store therefore keeps only
 * the DISPLAY concerns:
 *   - the message log (persisted to localStorage; transient by design),
 *   - the persisted chat conversation id (one conversation per project),
 *   - a turn-activity bus so the spec page can pause collab, mirror the live
 *     fold, and refetch the committed tree when a chat turn lands.
 *
 * The pre-turn draft snapshots that powered the client-side Undo are GONE:
 * with every turn committed to `main`, "undo" would be a revert commit — a
 * server-side operation the discard endpoint covers — not a local restore.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatMessage = UserMessage | AssistantMessage | ToolMessage | ErrorMessage;

export interface UserMessage {
  id: string;
  role: 'user';
  content: string;
  timestamp: number;
  turnId?: string;
  /** Lifecycle of the turn this message started. */
  turnStatus?: 'in_flight' | 'completed' | 'failed';
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  content: string; // streamed text-delta accumulated in place
  timestamp: number;
  turnId?: string;
}

/** One folded file mutation, projected from a `tool-result` frame. */
export interface ToolMessage {
  id: string; // the tool-call id
  role: 'tool';
  content: '';
  timestamp: number;
  turnId?: string;
  toolName: string; // addFile | editFile | removeFile | setFrontmatterField
  op: 'add' | 'edit' | 'remove' | 'frontmatter';
  path: string;
  toolStatus: 'running' | 'done' | 'error';
  toolErrorText?: string;
  toolErrorCode?: string;
}

export interface ErrorMessage {
  id: string;
  role: 'error';
  content: string;
  timestamp: number;
  turnId?: string;
  errorCode?: string;
}

/** Friendly verb for a folded op, for tool-card titles. */
export function opDisplayLabel(op: ToolMessage['op']): string {
  switch (op) {
    case 'add':
      return 'Created';
    case 'remove':
      return 'Deleted';
    case 'frontmatter':
      return 'Updated field';
    default:
      return 'Modified';
  }
}

// ---------------------------------------------------------------------------
// Persistence (messages only)
// ---------------------------------------------------------------------------

// v3: committed-truth cutover — the 'undone' turn status is gone (client-side
// Undo removed), so pre-cutover logs are simply left behind under the v2 key.
const SCHEMA_VERSION = 3;
const STORE_KEY_PREFIX = 'aep.chat.v3.';
const MAX_MESSAGES_PER_PROJECT = 200;

interface StoredBlob {
  schemaVersion: number;
  messages: ChatMessage[];
  updatedAt: number;
}

function storageKey(orgId: string, projectId: string): string {
  return `${STORE_KEY_PREFIX}${orgId}.${projectId}`;
}

function readMessages(orgId: string, projectId: string): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(orgId, projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredBlob;
    if (parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.messages)) return [];
    return parsed.messages;
  } catch {
    return [];
  }
}

function writeMessages(orgId: string, projectId: string, messages: ChatMessage[]): void {
  if (typeof window === 'undefined') return;
  const blob: StoredBlob = {
    schemaVersion: SCHEMA_VERSION,
    messages: messages.slice(-MAX_MESSAGES_PER_PROJECT),
    updatedAt: Date.now(),
  };
  try {
    window.localStorage.setItem(storageKey(orgId, projectId), JSON.stringify(blob));
  } catch {
    /* quota — chat history is transient, drop silently */
  }
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

export interface ProjectKey {
  orgId: string;
  projectId: string;
}

const cache = new Map<string, ChatMessage[]>();
const chatListeners = new Set<() => void>();
const EMPTY: ChatMessage[] = [];

function cacheKey(orgId: string, projectId: string): string {
  return `${orgId}.${projectId}`;
}

function load(orgId: string, projectId: string): ChatMessage[] {
  const key = cacheKey(orgId, projectId);
  const existing = cache.get(key);
  if (existing) return existing;
  const fromDisk = readMessages(orgId, projectId);
  cache.set(key, fromDisk);
  return fromDisk;
}

function mutateMessages(
  orgId: string,
  projectId: string,
  fn: (messages: ChatMessage[]) => ChatMessage[],
): void {
  const key = cacheKey(orgId, projectId);
  const current = load(orgId, projectId);
  const next = fn(current);
  if (next === current) return;
  cache.set(key, next);
  writeMessages(orgId, projectId, next);
  chatListeners.forEach((fn) => fn());
}

export function getChatMessages(orgId: string, projectId: string): ChatMessage[] {
  if (!orgId || !projectId) return EMPTY;
  return load(orgId, projectId);
}

/** Replace the whole message log (used by rehydrate when local history is empty). */
export function setChatMessages(key: ProjectKey, messages: ChatMessage[]): void {
  mutateMessages(key.orgId, key.projectId, () => messages);
}

export function clearChatHistory(orgId: string, projectId: string): void {
  mutateMessages(orgId, projectId, () => []);
}

export function subscribeChatStore(listener: () => void): () => void {
  chatListeners.add(listener);
  return () => chatListeners.delete(listener);
}

let idCounter = 0;
export function nextId(prefix = 'msg'): string {
  return `${prefix}-${Date.now()}-${++idCounter}`;
}

// ---------------------------------------------------------------------------
// Message mutations
// ---------------------------------------------------------------------------

export function appendUserMessage(key: ProjectKey, content: string, turnId: string): UserMessage {
  const msg: UserMessage = {
    id: nextId('u'),
    role: 'user',
    content,
    timestamp: Date.now(),
    turnId,
    turnStatus: 'in_flight',
  };
  mutateMessages(key.orgId, key.projectId, (msgs) => [...msgs, msg]);
  return msg;
}

export function setTurnStatus(
  key: ProjectKey,
  turnId: string,
  status: UserMessage['turnStatus'],
): void {
  mutateMessages(key.orgId, key.projectId, (msgs) =>
    msgs.map((m) => (m.role === 'user' && m.turnId === turnId ? { ...m, turnStatus: status } : m)),
  );
}

export function appendAssistantText(key: ProjectKey, turnId: string, delta: string): void {
  mutateMessages(key.orgId, key.projectId, (msgs) => {
    const last = msgs[msgs.length - 1];
    if (last && last.role === 'assistant' && last.turnId === turnId) {
      const updated: AssistantMessage = { ...last, content: last.content + delta };
      return [...msgs.slice(0, -1), updated];
    }
    const fresh: AssistantMessage = {
      id: nextId('a'),
      role: 'assistant',
      content: delta,
      timestamp: Date.now(),
      turnId,
    };
    return [...msgs, fresh];
  });
}

export function upsertToolMessage(key: ProjectKey, msg: ToolMessage): void {
  mutateMessages(key.orgId, key.projectId, (msgs) => {
    const idx = msgs.findIndex((m) => m.id === msg.id);
    if (idx < 0) return [...msgs, msg];
    return msgs.map((m, i) => (i === idx ? msg : m));
  });
}

export function appendErrorMessage(
  key: ProjectKey,
  turnId: string | undefined,
  content: string,
  errorCode?: string,
): void {
  const msg: ErrorMessage = {
    id: nextId('e'),
    role: 'error',
    content,
    timestamp: Date.now(),
    turnId,
    errorCode,
  };
  mutateMessages(key.orgId, key.projectId, (msgs) => [...msgs, msg]);
}

/**
 * Drop a turn's streamed output messages (assistant/tool/error) but keep the
 * user prompt. Used when re-attaching to a running turn after a refresh: the
 * `?from=0` replay re-streams the same frames, so the previously-persisted
 * partial output would otherwise duplicate.
 */
export function dropTurnMessages(key: ProjectKey, turnId: string): void {
  mutateMessages(key.orgId, key.projectId, (msgs) =>
    msgs.filter((m) => m.role === 'user' || m.turnId !== turnId),
  );
}

// ---------------------------------------------------------------------------
// Chat conversation id (persisted; one conversation per project)
// ---------------------------------------------------------------------------

const CONV_KEY_PREFIX = 'aep.chat.conv.';

export function getChatConversationId(key: ProjectKey): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage.getItem(`${CONV_KEY_PREFIX}${key.orgId}.${key.projectId}`) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setChatConversationId(key: ProjectKey, id: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${CONV_KEY_PREFIX}${key.orgId}.${key.projectId}`, id);
  } catch {
    /* quota — a fresh conversation next session is acceptable */
  }
}

// ---------------------------------------------------------------------------
// Turn-activity bus — chat → spec page (pause collab while a turn runs,
// mirror the live fold, refetch the committed tree when the turn lands)
// ---------------------------------------------------------------------------

export type TurnActivityEvent =
  | { kind: 'turnStarted'; orgId: string; projectId: string }
  /** The chat turn's live folded snapshot (full `specs/…` keys, display-only). */
  | { kind: 'turnSnapshot'; orgId: string; projectId: string; files: Record<string, string> }
  /** `committed` — the backend committed the turn; subscribers refetch HEAD. */
  | { kind: 'turnEnded'; orgId: string; projectId: string; committed: boolean };

const turnActivityListeners = new Set<(e: TurnActivityEvent) => void>();

export function publishTurnActivity(event: TurnActivityEvent): void {
  turnActivityListeners.forEach((fn) => fn(event));
}

export function subscribeTurnActivity(listener: (e: TurnActivityEvent) => void): () => void {
  turnActivityListeners.add(listener);
  return () => turnActivityListeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Panel open/close + copilot request (used by AepLayout)
// ---------------------------------------------------------------------------

let chatPanelOpen = false;
const panelListeners = new Set<() => void>();

export function isChatPanelOpen(): boolean {
  return chatPanelOpen;
}

export function setChatPanelOpen(open: boolean): void {
  chatPanelOpen = open;
  panelListeners.forEach((fn) => fn());
}

const copilotRequestListeners = new Set<() => void>();

export function requestCopilotOpen(): void {
  copilotRequestListeners.forEach((fn) => fn());
}

export function subscribeCopilotRequest(listener: () => void): () => void {
  copilotRequestListeners.add(listener);
  return () => copilotRequestListeners.delete(listener);
}

export function subscribeChatPanelState(listener: () => void): () => void {
  panelListeners.add(listener);
  return () => panelListeners.delete(listener);
}
