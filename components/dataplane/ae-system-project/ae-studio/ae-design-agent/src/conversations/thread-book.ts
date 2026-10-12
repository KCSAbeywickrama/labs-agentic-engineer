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
 * The pod's current thread per project chat (`chat.ts`): the project's main
 * chat, its Issues chat and each open issue's chat. Every member of a project
 * shares a chat's one current thread, minted lazily as a plain uuid; rotating
 * the main chat replaces it and drops the old thread's messages, which are
 * never listed or served again. The book holds only the current ids, their
 * creators and the last turn's context size; the messages stay behind the
 * `ConversationStore` port. Nothing outlives the process: after a pod roll
 * every chat starts fresh (a local run may `resume` a main thread it kept).
 *
 * Auto-rotation ports `A/spec/context_rotation.go`: a send is admitted only
 * to its chat's current thread, and a thread whose last measured context is
 * past 80 % of the connection's declared window is rotated before the send,
 * which is then refused (`409 conversation_rotated`). A connection that
 * declares no window has no token bound, so the thread's stored messages are
 * bounded instead: past `THREAD_FALLBACK_BYTES` (base64 attachments counted)
 * it rotates the same way. Without it, a thread on such a connection would
 * grow in the pod's memory until the pod's death.
 *
 * Opening a thread resolves nothing, so the threads no turn was admitted to
 * are capped at `MAX_UNUSED_THREADS` pod-wide, least recently used evicted
 * first. A thread with a turn belongs to a project the turn resolved, so
 * those are bounded by the org's projects and their open issues. An evicted
 * thread holds no messages; a send to its id is `rotated` and its history is
 * unknown.
 *
 * Two facts cross chats. What the Issues chat came to since the main chat's
 * previous turn is that turn's branch notes (`noteOutcome`,
 * `takeBranchNotes`). An issue's chat is removed when the issue is closed or
 * reopened (`removeIssueThread`): only threads created before the event go,
 * and a thread whose turn is running goes when that turn ends
 * (`deferIssueRemoval`, `turnEnded`), so the turn's own save never brings it
 * back.
 */

import { randomUUID } from "node:crypto";
import type { components } from "../generated/api.js";
import { projectDisplayHistory, type DisplayMessage } from "../conversation/display-history.js";
import type { ConversationStore } from "../store/conversation-store.js";
import type { BranchNote } from "./branch-notes.js";
import { chatKey, issueChat, issueOf, MAIN_CHAT, type Chat } from "./chat.js";

export type ThreadView = components["schemas"]["ProjectConversationView"];

/** Rotation fires once the context is past ROTATE_AT_NUM/ROTATE_AT_DEN of the window. */
const ROTATE_AT_NUM = 4;
const ROTATE_AT_DEN = 5;

/**
 * The stored size past which a thread rotates when the connection declares no
 * context window: 8 MiB of messages, base64 file parts included.
 */
export const THREAD_FALLBACK_BYTES = 8 << 20;

/**
 * The most threads no turn was admitted to that the pod keeps. Opening one
 * resolves nothing (a turn resolves its project), so any well-formed name
 * mints an entry; past the cap the least recently used of them is evicted.
 */
export const MAX_UNUSED_THREADS = 1000;

/**
 * The approximate stored size of `value`: string lengths (base64 and most
 * prose are one byte a character), binary byte lengths, object keys.
 */
function storedBytes(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return value.byteLength;
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + storedBytes(v), 0);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).reduce((n, [k, v]) => n + k.length + storedBytes(v), 0);
  }
  return 8;
}

/** Whether `tokens` is past the rotation share of `window` (strictly, as in Go). */
function contextFull(tokens: number, window: number): boolean {
  return tokens * ROTATE_AT_DEN > window * ROTATE_AT_NUM;
}

interface Thread {
  id: string;
  project: string;
  chat: Chat;
  createdAt: Date;
  /** The JWT display name of the member who opened the thread. */
  createdBy?: string;
  /** The context size the thread's last finished turn measured. */
  contextTokens?: number;
}

/** A removal waiting for the turn running on the issue's thread. */
interface PendingRemoval {
  conversationId: string;
  before: Date;
}

export interface ThreadBookDeps {
  store: ConversationStore;
  now?: () => Date;
}

/** The book's key of a project chat. */
function threadKey(project: string, chat: Chat): string {
  return `${project}/${chatKey(chat)}`;
}

export class ThreadBook {
  /** The current thread per project chat. */
  private readonly threads = new Map<string, Thread>();
  /** A current thread's key by its id. */
  private readonly byId = new Map<string, string>();
  /** Chats whose current thread no turn was admitted to, least recently used first. */
  private readonly unused = new Set<string>();
  /** The Issues chat's finished turns since the main chat's previous turn, per project. */
  private readonly issuesOutcomes = new Map<string, { turns: number; outcome: string }>();
  /** Issue threads whose removal waits for their running turn, by thread key. */
  private readonly pendingRemovals = new Map<string, PendingRemoval>();
  private readonly store: ConversationStore;
  private readonly now: () => Date;

  constructor(deps: ThreadBookDeps) {
    this.store = deps.store;
    this.now = deps.now ?? (() => new Date());
  }

  /** The chat's current thread (the main chat's by default), opened (credited to `by`) when there is none. */
  current(project: string, by?: string, chat: Chat = MAIN_CHAT): ThreadView {
    const key = threadKey(project, chat);
    const open = this.threads.get(key);
    if (!open) return view(this.open(project, chat, by));
    if (this.unused.delete(key)) this.unused.add(key);
    return view(open);
  }

  /**
   * Adopt `conversationId` as the project's main thread when it has none: a
   * local run (the playground) keeps its thread across processes, its
   * messages behind a file store. The pod never calls this. A project that
   * already has a main thread keeps it.
   */
  resume(project: string, conversationId: string): ThreadView {
    const key = threadKey(project, MAIN_CHAT);
    const open = this.threads.get(key);
    if (open) return view(open);
    const thread: Thread = { id: conversationId, project, chat: MAIN_CHAT, createdAt: this.now() };
    this.set(key, thread);
    return view(thread);
  }

  /** Replace the project's main thread with a fresh one credited to `by`. */
  async rotate(project: string, by?: string): Promise<ThreadView> {
    const old = this.threads.get(threadKey(project, MAIN_CHAT));
    const fresh = this.open(project, MAIN_CHAT, by);
    if (old) {
      this.byId.delete(old.id);
      await this.store.delete(old.id);
    }
    return view(fresh);
  }

  /** The chat whose current thread `conversationId` is, or `null` for any other id. */
  chatOf(project: string, conversationId: string): Chat | null {
    const thread = this.thread(project, conversationId);
    return thread ? thread.chat : null;
  }

  /**
   * A current thread's display history, oldest first: `[]` before its first
   * turn, `null` for any id that is not one of this project's current threads.
   */
  async history(project: string, conversationId: string): Promise<DisplayMessage[] | null> {
    if (!this.thread(project, conversationId)) return null;
    const conversation = await this.store.get(conversationId);
    return conversation ? projectDisplayHistory(conversation) : [];
  }

  /**
   * Record a finished turn's context size. A turn that ran on a thread that is
   * no longer current says nothing about the thread that replaced it.
   */
  noteContextTokens(project: string, conversationId: string, tokens: number): void {
    const thread = this.thread(project, conversationId);
    if (thread) thread.contextTokens = tokens;
  }

  /**
   * Whether a send to `conversationId` may start. `"rotated"` when the id is
   * not one of the project's current threads, or when it was full and has
   * just been rotated away; the next `current()` of its chat opens a fresh
   * one, credited to whoever asks.
   */
  async admit(project: string, conversationId: string, contextWindow?: number): Promise<"ok" | "rotated"> {
    const thread = this.thread(project, conversationId);
    if (!thread) return "rotated";
    const key = threadKey(project, thread.chat);
    if (!(await this.full(thread, contextWindow))) {
      this.unused.delete(key);
      return "ok";
    }
    this.drop(key, thread);
    await this.store.delete(thread.id);
    return "rotated";
  }

  /** An Issues turn finished with `outcome`: the main chat's next turn is told (`takeBranchNotes`). */
  noteOutcome(project: string, outcome: string): void {
    const seen = this.issuesOutcomes.get(project);
    this.issuesOutcomes.set(project, { turns: (seen?.turns ?? 0) + 1, outcome });
  }

  /**
   * What the Issues chat came to since the main chat's previous turn, for the
   * main turn starting now: one note naming how many of its turns finished
   * with an outcome and the newest one, or none. Taken once: a main turn that
   * then fails does not hand it on.
   */
  takeBranchNotes(project: string): BranchNote[] {
    const seen = this.issuesOutcomes.get(project);
    this.issuesOutcomes.delete(project);
    return seen ? [{ area: "issues", turns: seen.turns, outcome: seen.outcome }] : [];
  }

  /**
   * Remove the chat thread of issue `issueNumber` when it was created before
   * `before` (the close or reopen that removes it); a thread started after it
   * (a reopened issue's fresh one) stays. Idempotent: an issue with no thread
   * is a no-op. `true` when a thread went.
   */
  async removeIssueThread(project: string, issueNumber: number, before: Date): Promise<boolean> {
    const key = threadKey(project, issueChat(issueNumber));
    this.pendingRemovals.delete(key);
    const thread = this.threads.get(key);
    if (!thread || thread.createdAt >= before) return false;
    this.drop(key, thread);
    await this.store.delete(thread.id);
    return true;
  }

  /**
   * Remove issue `issueNumber`'s thread when the turn running on
   * `conversationId` ends (`turnEnded`), bounded by `before`. A second
   * removal for the same turn keeps the later bound, which covers both.
   */
  deferIssueRemoval(project: string, issueNumber: number, conversationId: string, before: Date): void {
    const key = threadKey(project, issueChat(issueNumber));
    const prev = this.pendingRemovals.get(key);
    const bound = prev && prev.conversationId === conversationId && prev.before > before ? prev.before : before;
    this.pendingRemovals.set(key, { conversationId, before: bound });
  }

  /**
   * A turn on `conversationId` ended: a removal waiting for it runs now. When
   * that thread already went another way, the removal is dropped, and so are
   * the messages the turn's save stored again (no current thread names them).
   */
  async turnEnded(project: string, conversationId: string): Promise<void> {
    for (const [key, pending] of this.pendingRemovals) {
      if (pending.conversationId !== conversationId) continue;
      const thread = this.threads.get(key);
      const issue = thread ? issueOf(thread.chat) : undefined;
      if (thread?.id === conversationId && thread.project === project && issue !== undefined) {
        await this.removeIssueThread(project, issue, pending.before);
        continue;
      }
      this.pendingRemovals.delete(key);
      if (!this.byId.has(conversationId)) await this.store.delete(conversationId);
    }
  }

  /** The current thread of `project` that `conversationId` names, if any. */
  private thread(project: string, conversationId: string): Thread | undefined {
    const key = this.byId.get(conversationId);
    const thread = key !== undefined ? this.threads.get(key) : undefined;
    return thread?.project === project ? thread : undefined;
  }

  /** Past 80 % of a declared window, or past `THREAD_FALLBACK_BYTES` stored when none is declared. */
  private async full(thread: Thread, contextWindow: number | undefined): Promise<boolean> {
    if (contextWindow !== undefined && contextWindow > 0) {
      return thread.contextTokens !== undefined && contextFull(thread.contextTokens, contextWindow);
    }
    const stored = await this.store.get(thread.id);
    return stored !== null && storedBytes(stored.messages) > THREAD_FALLBACK_BYTES;
  }

  private open(project: string, chat: Chat, by?: string): Thread {
    const key = threadKey(project, chat);
    const old = this.threads.get(key);
    if (old) this.byId.delete(old.id);
    const thread: Thread = { id: randomUUID(), project, chat, createdAt: this.now(), ...(by ? { createdBy: by } : {}) };
    this.set(key, thread);
    this.unused.delete(key);
    this.unused.add(key);
    const oldest = this.unused.values().next();
    if (this.unused.size > MAX_UNUSED_THREADS && !oldest.done) {
      const evicted = this.threads.get(oldest.value);
      if (evicted) this.drop(oldest.value, evicted);
    }
    return thread;
  }

  private set(key: string, thread: Thread): void {
    this.threads.set(key, thread);
    this.byId.set(thread.id, key);
  }

  /** Forget a chat's current thread (its messages are the caller's to delete). */
  private drop(key: string, thread: Thread): void {
    this.threads.delete(key);
    this.byId.delete(thread.id);
    this.unused.delete(key);
  }
}

function view(thread: Thread): ThreadView {
  return {
    conversationId: thread.id,
    createdAt: thread.createdAt.toISOString(),
    ...(thread.createdBy ? { createdBy: thread.createdBy } : {}),
    current: true,
  };
}
