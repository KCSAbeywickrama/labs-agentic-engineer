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
 * The turn start path: one place that turns a request into a
 * running turn, for the `/v1` edge and the Turn socket. Before
 * a turn is accepted it checks, in order: the pod is not shutting down, the
 * org has a model key, the instruction is usable, the project resolves (the
 * tools socket lookup, which also writes the snapshots), the snapshots and
 * attachments can be read, no turn runs on the scope, and the thread admits
 * the send (lookup → admit → desk.start, so a refused send takes no
 * lock). Every refusal is a `TurnStartError` the edge maps to a status.
 *
 * A browser turn runs in the chat its thread belongs to (`conversations/
 * chat.ts`). The main chat's is a spec turn. An area's chat (the Issues
 * area's own, or the area focused on an issue) runs plain chat turns for the
 * area's sub-agent: no `/<skill>` flows, no Room, no spec scope, its scope's
 * tools over its MCP route; a turn focused on an issue is refused while the
 * issue is closed (`409 issue_closed`), which removes the thread. A main turn
 * is told what the Issues area's chat came to meanwhile (branch notes); that
 * chat's turn outcome is kept for it.
 *
 * Server-started turns (the Turn socket) take the same path with the
 * caller's `turnId`: a turn id the desk still knows reattaches instead.
 * **Kickoff** (`start`) is `/start` on the project's current thread, in the
 * Room, credited to the named user. **Plan** runs the task-plan toolset on a
 * throwaway conversation (no Room, no thread), dropped when the turn ends.
 *
 * The accepted turn runs detached from the request, inside the TurnDesk: its
 * `run` joins the Room for a file-writing project turn, loads the MCP tools
 * when the turn's gates say so, and calls `runConversationTurn` with the
 * desk's abort signal. A failure the agent can name (`turn-error.ts`) ends
 * the turn `agent-error` with its code; anything else that throws ends it
 * `internal` (the desk's rule).
 */

import { randomUUID } from "node:crypto";
import type { FilePart, LanguageModel } from "ai";
import type {
  PlanScope,
  StreamPart,
  Surface,
  TurnAim,
  TurnAttachment,
  TurnScope,
  TurnSpec,
} from "@aep/agent-stream";
import type { RoomPeer } from "../collab/room-peer.js";
import { orgDesignSystem } from "../agents/main/prompt.js";
import type { SkillSource } from "../agents/main/skill-source.js";
import { AttachmentRefusedError, fitAttachments, fitReferences, type UnreadableReference } from "../conversation/attachments.js";
import {
  loadSkillsFromSnapshot,
  overlayReferenceTexts,
  readReferenceAttachments,
  readSnapshot,
  toAttachmentParts,
} from "../conversation/load-workspace.js";
import { runConversationTurn } from "../conversation/run-conversation-turn.js";
import { stepContextOf } from "../conversation/step-context.js";
import { codedErrorFrame, turnErrorFrame } from "../conversation/turn-error.js";
import type { BranchNote } from "../conversations/branch-notes.js";
import { chatKey, issueOf, MAIN_CHAT, type Chat } from "../conversations/chat.js";
import { issueMcpPath, issuesMcpPath, issueState } from "../conversations/issue-state.js";
import type { ThreadBook } from "../conversations/thread-book.js";
import { mcpRoute } from "../shared/mcp-client.js";
import { composeInstruction, eagerSkillsFor, scopeFactFor, toolsetFor, wantsRegisterDraftTool } from "../prompts/turn.js";
import { connectionHost, type ModelConnection } from "../shared/model.js";
import { projectSnapshotDir, skillsSnapshotDir } from "../shared/snapshot-path.js";
import type { ConversationStore } from "../store/conversation-store.js";
import { ToolsSocketError, type ProjectSnapshot, type ToolsSocket } from "../tools-socket/client.js";
import { removeIssueThread } from "./issue-thread-removal.js";
import { designFeaturesOf, savesItsEnd, turnSpecFor, turnSummary } from "./start-spec.js";
import {
  DeskClosedError,
  errorClassOf,
  stdoutTurnLog,
  TurnDesk,
  TurnInProgressError,
  type Scope,
  type TurnLogLine,
  type TurnMeta,
  type TurnOutcome,
  type TurnRun,
} from "./turn-desk.js";
import { catalogTurn, designOrRoomTurn } from "./turn-spec.js";

/** The longest instruction a turn takes (aep-api's `createTurnMaxInstructionBytes`). */
export const MAX_INSTRUCTION_BYTES = 64 << 10;

/** A project name: a DNS label, as the platform names projects. */
const PROJECT_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Whether `name` can name a project at all (anything else is `project_unknown`). */
export function isProjectName(name: string): boolean {
  return PROJECT_RE.test(name);
}

/** Who a turn is credited to: the verified user, or the user a server-started turn names. */
export interface Credit {
  /** The JWT `sub`; `""` when a server-started turn names no one. */
  userId: string;
  name: string;
  email: string;
}

/** A server-started turn, as the Turn socket's `TurnRequest` carries it. */
export interface ServerTurnRequest {
  /** The caller's id: a retry with the same id reattaches. */
  turnId: string;
  project: string;
  kind: "start" | "plan";
  credit: Credit;
  /** Plan: the commit the planner reads the repository at (40-hex); absent, the default-branch tip. */
  at?: string;
  /** Plan: what the version carries. */
  scope?: PlanScope;
  /** Start: the project idea (else the lookup's). */
  text?: string;
}

/** The code of a turn whose Room edits did not all land (`room-peer.ts` gave up or never resynced). */
export const ROOM_UNAVAILABLE = "room_unavailable";

/** The display line of a Plan turn (no one typed it). */
const PLAN_SUMMARY = "Plan the implementation Tasks";
/** The command a kickoff runs (`start-spec.ts` resolves the idea). */
const START_COMMAND = "/start";

/** What a browser sent for one turn. */
export interface TurnInput {
  /** Verbatim; `/<skill>` commands are parsed here (`start-spec.ts`). */
  instruction: string;
  /** What the user was looking at (S6); absent = the whole product. */
  scope?: TurnScope;
  aim?: TurnAim;
  /** Chat attachments, bytes base64 (`turn-input.ts` caps them). */
  attachments: TurnAttachment[];
}

/** What a turn's model is built for, beyond its connection. */
export interface TurnModelContext {
  /** The organization the turn runs for, named on its provider log lines. */
  orgId?: string;
  /** The conversation the turn runs in (a provider may route by session). */
  conversationId: string;
  /** Told when a model call waits out a short 429 (a `provider-wait` frame). */
  onProviderWait?: (host: string) => void;
}

export type BuildModel = (conn: ModelConnection, ctx: TurnModelContext) => LanguageModel;

/** Join the project's Room for one turn, as the credited user. */
export type JoinRoom = (project: string, credit: Credit) => Promise<RoomPeer>;

export interface TurnStarterDeps {
  desk: TurnDesk;
  threads: ThreadBook;
  store: ConversationStore;
  tools: ToolsSocket;
  /** `AE_SNAPSHOTS_DIR`: where the lookup's snapshots are read from. */
  snapshotsDir: string;
  /** The org's model connection (`connectionFromEnv`); `null` = no key (`no_default_key`). */
  connection: ModelConnection | null;
  buildModel: BuildModel;
  /**
   * Joins the Room for a file-writing project turn (the pod's is
   * `collab/local-room.ts`). Absent, a project turn writes to a throwaway
   * bundle over the snapshot (nothing persists).
   */
  room?: JoinRoom;
  /** Who reads the turns' prose (`console` in the pod; absent in a local run). */
  surface?: Surface;
  /** The pod's org, named on provider log lines. */
  orgId?: string;
  /** The start path's value-free log (stdout as JSON by default). */
  log?: (line: TurnLogLine) => void;
  /**
   * No one answers questions in this run, so every turn is told to generate
   * on stated assumptions (the playground's one-shot phase verbs). The pod
   * never sets it: a browser always has a person behind it.
   */
  headless?: boolean;
}

function shuttingDown(): TurnStartError {
  return new TurnStartError(503, "shutting_down", "the design agent is shutting down");
}

/** Why a turn was not started. `code` is the problem (or TurnConflict) code. */
export class TurnStartError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** With `turn_in_progress`: the running turn. */
    readonly activeTurnId?: string,
  ) {
    super(message);
    this.name = "TurnStartError";
  }
}

/** The files, skills and documents one turn reads, prepared before it is accepted. */
interface TurnMaterial {
  files: Record<string, string>;
  skillSource: SkillSource;
  references: FilePart[];
  unreadableReferences: UnreadableReference[];
  chatAttachments: FilePart[];
  baseRef: string;
  skillsRef: string;
}

/** Everything a run needs, settled before the turn is accepted. */
interface Launch {
  scope: Scope;
  kind: TurnMeta["kind"];
  /** The caller's turn id (server-started turns); a uuid is minted otherwise. */
  turnId?: string;
  conversationId: string;
  input: TurnInput;
  credit: Credit;
  spec: TurnSpec;
  flow: string;
  material: TurnMaterial;
  conn: ModelConnection;
  /** The project turn joins the Room (`undefined` for marketplace, Plan and area-chat turns). */
  roomProject?: string;
  /** The project chat the turn runs in (the main chat for every turn but an area chat's). */
  chat: Chat;
  /**
   * A main-chat browser turn: told what the area chats came to meanwhile,
   * taken once the desk accepted the turn (a refused start leaves them).
   */
  takesBranchNotes?: true;
  route: "project" | "marketplace";
  /** A one-shot conversation (Plan): no earlier turn's facts, dropped from the store at the end. */
  throwaway?: boolean;
}

export class TurnStarter {
  private refusing = false;

  constructor(private readonly deps: TurnStarterDeps) {}

  /**
   * Refuse every later start with `503 shutting_down`. Flipped at
   * SIGTERM before `desk.abortAll` (`pod/shutdown.ts`). A start already past
   * its first check (awaiting the lookup or the snapshot read) is refused
   * again at `launch`, and the desk itself refuses once `abortAll` ran.
   */
  refuse(): void {
    this.refusing = true;
  }

  /**
   * Start a browser turn in one of the project's current threads, in the
   * chat that thread belongs to; resolves to its turn id.
   */
  async startProjectTurn(req: { project: string; conversationId: string; input: TurnInput; credit: Credit }): Promise<string> {
    const conn = this.admissible(req.input);
    const chat = this.deps.threads.chatOf(req.project, req.conversationId);
    if (!chat) throw rotated();
    if (chat.area !== undefined && req.input.scope) {
      throw new TurnStartError(400, "invalid_turn", "an area's chat takes no scope");
    }
    // A closed issue has no thread: refused (and its thread removed) before the lookup.
    const issue = issueOf(chat);
    if (issue !== undefined) await this.checkIssueOpen(req.project, issue);
    const lookup = await this.lookup(req.project);
    // An area's sub-agent works on no spec: its message is a plain chat turn,
    // so a typed `/design` is words for that agent, not a command.
    const { spec, flow } =
      chat.area === undefined ? turnSpecFor(req.input.instruction, lookup) : { spec: { kind: "chat" as const, text: req.input.instruction }, flow: "" };
    const material = await this.material(req.input, spec, () => this.projectDirs(req.project, lookup), conn);
    const scope: Scope = { kind: "project", project: req.project, chat: chatKey(chat) };
    this.refuseBusy(scope);
    // A full or demoted thread is refused before anything holds the lock.
    if ((await this.deps.threads.admit(req.project, req.conversationId, conn.contextWindow)) === "rotated") throw rotated();
    return this.launch({
      scope,
      kind: "browser",
      conversationId: req.conversationId,
      input: req.input,
      credit: req.credit,
      spec,
      flow,
      material,
      conn,
      ...(this.deps.room && chat.area === undefined ? { roomProject: req.project } : {}),
      route: "project",
      chat,
      ...(chat.area === undefined ? { takesBranchNotes: true } : {}),
    }).turnId;
  }

  /**
   * Refuse an issue's chat unless the issue is open: `404 issue_unknown` for
   * no such issue, `409 issue_closed` for a closed one, whose thread is then
   * removed (a close the pod was not told of included), at its running turn's
   * end when one runs. The issue tools not answering is `503 tools_unavailable`.
   */
  async checkIssueOpen(project: string, issueNumber: number): Promise<void> {
    if (!isProjectName(project)) throw new TurnStartError(404, "project_unknown", "no such project");
    let state: "open" | "closed" | "unknown";
    try {
      state = await issueState(this.deps.tools, project, issueNumber);
    } catch {
      throw new TurnStartError(503, "tools_unavailable", "the studio's tools are not answering");
    }
    if (state === "unknown") throw new TurnStartError(404, "issue_unknown", "no such issue");
    if (state === "closed") {
      await removeIssueThread(this.deps, project, issueNumber, new Date());
      throw new TurnStartError(409, "issue_closed", "the issue is closed");
    }
  }

  /**
   * Start a server-started turn (the Turn socket): a kickoff or a Plan, under
   * the caller's `turnId`. A turn id the desk still knows (running, or
   * finished and retained) reattaches and starts nothing.
   */
  async startServerTurn(req: ServerTurnRequest): Promise<{ turnId: string; reattached: boolean }> {
    if (this.refusing) throw shuttingDown();
    const known = this.deps.desk.status(req.turnId);
    if (known) {
      if (known.project !== req.project) throw new TurnStartError(400, "invalid_turn", "the turn id names a turn of another project");
      return { turnId: req.turnId, reattached: true };
    }
    return req.kind === "start" ? this.startKickoff(req) : this.startPlan(req);
  }

  /** `/start` on the project's current thread, in the Room. */
  private async startKickoff(req: ServerTurnRequest): Promise<{ turnId: string; reattached: boolean }> {
    const text = req.text?.trim() ?? "";
    const input: TurnInput = { instruction: text ? `${START_COMMAND} ${text}` : START_COMMAND, attachments: [] };
    const conn = this.admissible(input);
    const lookup = await this.lookup(req.project);
    const { spec, flow } = turnSpecFor(input.instruction, lookup);
    const material = await this.material(input, spec, () => this.projectDirs(req.project, lookup), conn);
    const scope: Scope = { kind: "project", project: req.project };
    this.refuseBusy(scope, req.turnId);
    const by = req.credit.name.trim() || undefined;
    let conversationId = this.deps.threads.current(req.project, by).conversationId;
    // A full thread rotates away: the kickoff opens the fresh one.
    if ((await this.deps.threads.admit(req.project, conversationId, conn.contextWindow)) === "rotated") {
      conversationId = this.deps.threads.current(req.project, by).conversationId;
    }
    return this.launch({
      scope,
      kind: "kickoff",
      turnId: req.turnId,
      conversationId,
      input,
      credit: req.credit,
      spec,
      flow,
      material,
      conn,
      ...(this.deps.room ? { roomProject: req.project } : {}),
      route: "project",
      chat: MAIN_CHAT,
    });
  }

  /** The task-plan toolset on a throwaway conversation, no Room. */
  private async startPlan(req: ServerTurnRequest): Promise<{ turnId: string; reattached: boolean }> {
    const spec: TurnSpec = {
      kind: "plan",
      ...(req.scope ? { scope: req.scope } : {}),
    };
    const input: TurnInput = { instruction: req.scope ? `${PLAN_SUMMARY} (${req.scope.tag})` : PLAN_SUMMARY, attachments: [] };
    const conn = this.admissible(input);
    // The pin is a resolved sha (`edge/turn-socket.ts`): the lookup snapshots
    // that commit, so the planner reads the version it plans, not the tip.
    const lookup = await this.lookup(req.project, req.at);
    const material = await this.material(input, spec, () => this.projectDirs(req.project, lookup), conn);
    const scope: Scope = { kind: "project", project: req.project };
    this.refuseBusy(scope, req.turnId);
    return this.launch({
      scope,
      kind: "plan",
      turnId: req.turnId,
      conversationId: randomUUID(),
      input,
      credit: req.credit,
      spec,
      flow: "",
      material,
      conn,
      route: "project",
      chat: MAIN_CHAT,
      throwaway: true,
    });
  }

  private projectDirs(project: string, lookup: ProjectSnapshot): { snapshotDir: string; skillsDir: string; baseRef: string; skillsRef: string } {
    return {
      snapshotDir: projectSnapshotDir(this.deps.snapshotsDir, project, lookup.headSha),
      skillsDir: skillsSnapshotDir(this.deps.snapshotsDir, lookup.skillsSha),
      baseRef: lookup.headSha,
      skillsRef: lookup.skillsSha,
    };
  }

  /** Start a turn in a marketplace conversation (no project, no Room); the caller checked ownership. */
  async startMarketplaceTurn(req: { conversationId: string; input: TurnInput; credit: Credit }): Promise<string> {
    const conn = this.admissible(req.input);
    const { skillsSha } = await this.toolsCall(() => this.deps.tools.skills());
    const { spec, flow } = turnSpecFor(req.input.instruction, { references: [] });
    // The marketplace reads only the Org skills snapshot: it is both the
    // turn's files and its skills.
    const material = await this.material(req.input, spec, () => {
      const dir = skillsSnapshotDir(this.deps.snapshotsDir, skillsSha);
      return { snapshotDir: dir, skillsDir: dir, baseRef: skillsSha, skillsRef: skillsSha };
    }, conn);
    const scope: Scope = { kind: "marketplace", conversationId: req.conversationId };
    this.refuseBusy(scope);
    return this.launch({
      scope,
      kind: "browser",
      conversationId: req.conversationId,
      input: req.input,
      credit: req.credit,
      spec,
      flow,
      material,
      conn,
      route: "marketplace",
      chat: MAIN_CHAT,
    }).turnId;
  }

  /** The checks that need nothing but the request: shutdown, key, instruction. */
  private admissible(input: TurnInput): ModelConnection {
    if (this.refusing) throw shuttingDown();
    const conn = this.deps.connection;
    if (!conn) throw new TurnStartError(409, "no_default_key", "the organization has no default model key");
    if (input.instruction.trim() === "") throw new TurnStartError(400, "invalid_turn", "instruction is required");
    if (Buffer.byteLength(input.instruction) > MAX_INSTRUCTION_BYTES) {
      throw new TurnStartError(413, "payload_too_large", "instruction exceeds the size limit");
    }
    return conn;
  }

  /**
   * The project's snapshot. `ref_not_found` is the request's fault only when
   * it sent `at`: the pin names no commit, which a retry will not change.
   * Without `at` it is the sidecar failing to read the tip it resolved.
   */
  private async lookup(project: string, at?: string): Promise<ProjectSnapshot> {
    if (!isProjectName(project)) throw new TurnStartError(404, "project_unknown", "no such project");
    const found = await this.toolsCall(async () => {
      try {
        return await this.deps.tools.lookup(project, at);
      } catch (err) {
        if (at !== undefined && err instanceof ToolsSocketError && err.code === "ref_not_found") {
          throw new TurnStartError(400, "invalid_turn", "at names no commit of the project's repository");
        }
        throw err;
      }
    });
    if (!found) throw new TurnStartError(404, "project_unknown", "no such project");
    return found;
  }

  /** A tools socket call; a failure is the sidecar's, not the request's. */
  private async toolsCall<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (err instanceof ToolsSocketError) {
        throw new TurnStartError(503, "tools_unavailable", "the studio's tools are not answering");
      }
      throw err;
    }
  }

  /**
   * The project's head once a design run's Room work has been saved: the
   * commit its run ended at. undefined when the tools socket cannot say;
   * the run then records no end, and aep-api reads its start instead.
   */
  private async headAfterSave(project: string): Promise<string | undefined> {
    try {
      return (await this.deps.tools.lookup(project))?.headSha;
    } catch (err) {
      (this.deps.log ?? stdoutTurnLog)({ msg: "turn_end_unread", source: "ae-design-agent", errorClass: errorClassOf(err) });
      return undefined;
    }
  }

  /** A turn runs on the scope: 409, unless it is the turn `turnId` names (the desk reattaches it). */
  private refuseBusy(scope: Scope, turnId?: string): void {
    const active = this.deps.desk.active(scope);
    if (active && active.turnId !== turnId) throw new TurnStartError(409, "turn_in_progress", "a turn is already running", active.turnId);
  }

  /**
   * Read the snapshots and fit the documents to the connection. A chat
   * attachment the model cannot take is the user's to fix (400); a snapshot
   * that will not read after a good lookup is an infrastructure fault.
   */
  private async material(
    input: TurnInput,
    spec: TurnSpec,
    dirs: () => { snapshotDir: string; skillsDir: string; baseRef: string; skillsRef: string },
    conn: ModelConnection,
  ): Promise<TurnMaterial> {
    let read: { files: Record<string, string>; skillSource: SkillSource; references: FilePart[]; baseRef: string; skillsRef: string };
    try {
      const d = dirs();
      read = {
        files: readSnapshot(d.snapshotDir),
        skillSource: loadSkillsFromSnapshot(d.skillsDir),
        // Flows ground their artifacts in the reference documents; the
        // history dedupe keeps a re-named document from being stored twice.
        references: spec.kind === "start" || spec.kind === "flow" ? readReferenceAttachments(d.snapshotDir, spec.references) : [],
        baseRef: d.baseRef,
        skillsRef: d.skillsRef,
      };
    } catch (err) {
      // The error's text names snapshot paths: the caller gets a fixed
      // sentence, the log the class only.
      (this.deps.log ?? stdoutTurnLog)({ msg: "turn_material_unreadable", source: "ae-design-agent", errorClass: errorClassOf(err) });
      throw new TurnStartError(500, "internal", "the turn's files could not be read");
    }
    const references = await fitReferences(read.references, conn.capabilities);
    // The encoded budget is shared with the references (the ceiling belongs
    // to the model request), so their cost is passed in.
    const spent = references.parts.reduce((n, part) => n + (typeof part.data === "string" ? part.data.length : 0), 0);
    let chatAttachments: FilePart[];
    try {
      chatAttachments = await fitAttachments(toAttachmentParts(input.attachments, spent), conn.capabilities);
    } catch (err) {
      if (err instanceof AttachmentRefusedError) throw new TurnStartError(400, "attachment_rejected", err.message);
      throw err;
    }
    return {
      files: read.files,
      skillSource: read.skillSource,
      references: references.parts,
      unreadableReferences: references.unreadable,
      chatAttachments,
      baseRef: read.baseRef,
      skillsRef: read.skillsRef,
    };
  }

  /** Hand the turn to the desk: its id, and whether a turn of that id was already there. */
  private launch(l: Launch): { turnId: string; reattached: boolean } {
    const { desk } = this.deps;
    const turnId = l.turnId ?? randomUUID();
    // A one-shot conversation has no earlier turn of its own to report on.
    const last = l.throwaway ? null : desk.lastTerminal(l.scope);
    const summary = turnSummary(l.input.instruction, l.spec);
    const author = authorOf(l.credit);
    const meta: TurnMeta = {
      conversationId: l.conversationId,
      kind: l.kind,
      flow: l.flow,
      instruction: summary,
      ...(author ? { author } : {}),
      model: l.conn.model,
      modelHost: connectionHost(l.conn),
      baseRef: l.material.baseRef,
      skillsRef: l.material.skillsRef,
      ...designFeaturesFact(l.flow, l.spec),
      ...(l.chat.area !== undefined ? { area: l.chat.area } : {}),
      ...(l.chat.focus !== undefined ? { focus: l.chat.focus } : {}),
    };
    const scope = l.input.scope;
    const instruction = composeInstruction(l.spec, {
      // Composed after the snapshot read: a feature scope names its file,
      // which only the turn's own files can say.
      ...(scope ? { scope: scopeFactFor(scope, Object.keys(l.material.files)) } : {}),
      // D20 from the pod's last terminal facts: the last turn failed, or it
      // ran on another snapshot than this one.
      previousTurnFailed: last?.status === "failed",
      ...(l.input.aim ? { aim: l.input.aim } : {}),
      ...(this.deps.headless ? { headless: true } : {}),
      ...(l.chat.area !== undefined ? { area: l.chat.area } : {}),
      now: new Date().toISOString(),
    });
    const filesChangedExternally = last !== null && last.baseRef !== l.material.baseRef;
    // The start awaited the lookup and the snapshot read since `admissible`:
    // the pod may have begun shutting down meanwhile.
    if (this.refusing) throw shuttingDown();
    try {
      return desk.start(l.scope, meta, this.run(l, { turnId, summary, instruction, filesChangedExternally }), turnId);
    } catch (err) {
      if (err instanceof TurnInProgressError) {
        throw new TurnStartError(409, "turn_in_progress", "a turn is already running", err.activeTurnId);
      }
      if (err instanceof DeskClosedError) throw shuttingDown();
      throw err;
    }
  }

  private run(
    l: Launch,
    t: { turnId: string; summary: string; instruction: string; filesChangedExternally: boolean },
  ): TurnRun {
    const { deps } = this;
    const host = connectionHost(l.conn);
    const roomScoped = l.roomProject !== undefined;
    const gates = { flow: l.flow, roomScoped };
    const { chat } = l;
    const toolset = toolsetFor(l.spec);
    // An area's sub-agent carries no spec flows, so there is nothing to inline.
    const eager = chat.area !== undefined ? [] : eagerSkillsFor(l.spec, l.input.scope, orgDesignSystem(l.material.skillSource));
    // An area's sub-agent acts with its chat's tools only, over its MCP route:
    // the issue's when the chat is focused on one, else the Issues area's.
    const issue = issueOf(chat);
    const areaMcp =
      chat.area === undefined
        ? undefined
        : mcpRoute(deps.tools, issue !== undefined ? issueMcpPath(projectOf(l.scope), issue) : issuesMcpPath(projectOf(l.scope)));
    const m = l.material;
    const author = authorOf(l.credit);
    return async (emit, signal): Promise<TurnOutcome> => {
      // Taken before the first await: the desk calls the run as it accepts the turn.
      const branchNotes: BranchNote[] = l.takesBranchNotes ? deps.threads.takeBranchNotes(projectOf(l.scope)) : [];
      let contextTokens: number | undefined;
      const onEvent = (part: StreamPart): void => {
        contextTokens = stepContextOf(part) ?? contextTokens;
        // A failure the agent can name streams as its coded frame, never the provider's raw error.
        emit(part.type === "error" ? (codedErrorFrame(part.error, host) ?? part) : part);
      };
      let peer: RoomPeer | undefined;
      // Left once: the outcome reads the count, the `finally` makes sure it happens.
      let leaving: Promise<number> | undefined;
      const leaveRoom = (): Promise<number> => (leaving ??= peer ? peer.leave() : Promise.resolve(0));
      try {
        let files = m.files;
        if (l.roomProject !== undefined && deps.room) {
          peer = await deps.room(l.roomProject, l.credit);
          // The Room holds no reference documents; their text rides in from
          // the snapshot, which is their authority.
          files = overlayReferenceTexts(peer.files(), m.files);
        }
        const model = deps.buildModel(l.conn, {
          ...(deps.orgId ? { orgId: deps.orgId } : {}),
          conversationId: l.conversationId,
          onProviderWait: (wait) => emit({ type: "provider-wait", host: wait } as StreamPart),
        });
        const refs = { baseRef: m.baseRef, skillsRef: m.skillsRef };
        try {
          const res = await runConversationTurn({
            id: l.conversationId,
            instruction: t.instruction,
            files,
            filesChangedExternally: t.filesChangedExternally,
            skillSource: m.skillSource,
            ...(m.references.length ? { referenceAttachments: m.references } : {}),
            ...(m.unreadableReferences.length ? { unreadableReferences: m.unreadableReferences } : {}),
            ...(m.chatAttachments.length ? { chatAttachments: m.chatAttachments } : {}),
            toolset,
            ...(l.spec.kind === "plan" && l.spec.scope ? { planScope: l.spec.scope } : {}),
            ...(wantsRegisterDraftTool(l.spec, l.route) ? { registerDraft: true } : {}),
            ...(areaMcp ? { mcp: areaMcp } : catalogTurn(gates) ? { mcp: deps.tools } : {}),
            ...(chat.area !== undefined ? { chat, project: projectOf(l.scope) } : {}),
            ...(branchNotes.length ? { branchNotes } : {}),
            webSearch: chat.area === undefined && designOrRoomTurn(gates),
            ...(eager.length ? { eagerSkills: eager } : {}),
            ...(deps.surface ? { surface: deps.surface } : {}),
            ...(peer ? { collabPeer: peer } : {}),
            journal: {
              turnId: t.turnId,
              text: t.summary,
              ...(author ? { author: { id: author.id, displayName: author.name } } : {}),
              // The names that reached the model, not the ones that were sent.
              ...(m.chatAttachments.length ? { attachments: m.chatAttachments.flatMap((p) => (p.filename ? [p.filename] : [])) } : {}),
              ...(l.input.aim ? { anchor: l.input.aim.anchor } : {}),
              // Likewise the scope the instruction was composed from, so a
              // reloaded thread can say what each message was about.
              ...(l.input.scope ? { scope: l.input.scope } : {}),
            },
            model,
            connection: l.conn,
            store: deps.store,
            onEvent,
            abortSignal: signal,
          });
          // What the Issues area's chat came to reaches the main chat's next turn.
          if (chat.area === "issues" && res.outcome) deps.threads.noteOutcome(projectOf(l.scope), res.outcome);
          const usage = {
            usage: res.usage,
            ...(contextTokens !== undefined ? { contextTokens } : {}),
            changedPaths: res.changedPaths,
          };
          // A design run saves its Room work before it leaves, so the commit
          // it ends at holds its own requirement edits (L30).
          const saved = peer !== undefined && savesItsEnd(l.flow) ? await peer.flush() : false;
          // A turn whose edits did not all reach the Room has not completed:
          // its Room connection dropped and the rejoin failed or never synced.
          const dropped = await leaveRoom();
          if (dropped > 0) {
            return {
              status: "failed",
              reason: "agent-error",
              code: ROOM_UNAVAILABLE,
              message: `the Room could not be reached: ${dropped} file(s) written this turn are not in it`,
              ...usage,
              ...refs,
            };
          }
          const endRef = saved && l.roomProject !== undefined ? await this.headAfterSave(l.roomProject) : undefined;
          return { status: "completed", ...usage, ...refs, ...(endRef ? { endRef } : {}) };
        } catch (err) {
          if (signal.aborted) throw err; // the desk already ended the turn (cap or shutdown)
          const frame = turnErrorFrame(err, host);
          const coded = "code" in frame ? frame : undefined;
          return {
            status: "failed",
            reason: "agent-error",
            message: frame.error,
            ...(coded ? { code: coded.code } : {}),
            ...(coded && "host" in coded && coded.host ? { host: coded.host } : {}),
            ...(coded && "resetAt" in coded && coded.resetAt ? { resetAt: coded.resetAt } : {}),
            ...refs,
          };
        }
      } finally {
        // The agent never lingers in the Room past its turn (presence honesty).
        await leaveRoom();
        if (l.throwaway) await deps.store.delete(l.conversationId);
      }
    };
  }
}

/** The send addressed a thread that is not its chat's current one. */
function rotated(): TurnStartError {
  return new TurnStartError(409, "conversation_rotated", "the conversation is no longer the project's current thread");
}

/** The project a project-scoped turn runs for. */
function projectOf(scope: Scope): string {
  if (scope.kind !== "project") throw new Error("an area chat's turn is a project turn");
  return scope.project;
}

/** A design turn's feature IDs for its usage record; none for a bare `/design` or any other flow. */
function designFeaturesFact(flow: string, spec: TurnSpec): { designFeatures?: string[] } {
  if (flow !== "design") return {};
  const ids = designFeaturesOf(spec);
  return ids.length > 0 ? { designFeatures: ids } : {};
}

/** The turn's author: the credited user, named by `name` or else the id; none when the credit names no one. */
function authorOf(credit: Credit): { id: string; name: string } | undefined {
  if (credit.userId === "") return undefined;
  return { id: credit.userId, name: credit.name.trim() || credit.userId };
}

/**
 * The desk's `onFinished`: the record goes to the usage outbox, a project
 * turn's closing context size goes to its thread for auto-rotation, and an
 * issue thread's removal that waited for the turn runs.
 */
export function finishedTurnSink(
  threads: Pick<ThreadBook, "noteContextTokens" | "turnEnded">,
  outbox: { push(r: Parameters<TurnRecordSink>[0]): void },
): TurnRecordSink {
  return (record) => {
    outbox.push(record);
    if (record.project === undefined) return;
    if (record.contextTokens !== undefined) {
      threads.noteContextTokens(record.project, record.conversationId, record.contextTokens);
    }
    // The store is in memory: a removal cannot fail, and the sink must not throw.
    threads.turnEnded(record.project, record.conversationId).catch(() => undefined);
  };
}

type TurnRecordSink = ConstructorParameters<typeof TurnDesk>[0]["onFinished"];
