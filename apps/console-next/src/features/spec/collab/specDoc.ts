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

import { useMemo } from "react";
import * as Y from "yjs";
import { applyToolCall, FileBundle, isFileMutationTool, type StreamPart } from "@aep/agent-stream";
import { deleteDocFile, isMarkdownPath, readDocFile, setDocFile, setDocFileAsAgent } from "@aep/collab-doc";
import { useSession } from "../../../auth/SessionContext";
import { env } from "../../../config/env";
import { useMockSpecExtras, type MockSpecExtras } from "../api/specModel";
import { useSpecRoom } from "./specRoom";

// The project's spec document: ONE Y.Doc per project, every file a share keyed
// by its repo path (@aep/collab-doc's model). Everything in the app that reads
// or edits the spec gets the doc from here, and nothing else creates one.
//
// ON THE PLATFORM it is the collab room's doc (specRoom.ts): seeded server-side
// from git, edited by everyone in the project and by the agent, committed back
// by the collab server. Null until the room has synced.
//
// IN MOCK MODE it is a local doc, seeded once from the mock's files and kept
// for the browser session, so an edit survives moving between files. The
// agent's file writes in a chat turn are applied to it from the turn's stream
// (`applyAgentWrite`), marked as the agent's the way the agents service writes
// into the room, so they land with a fading wash. No one else sees it, and a
// reload starts over.

/** Marks the seed's writes, so they are never mistaken for the user's edits. */
const SEED_ORIGIN = "console-next:local-seed";

/** Marks the agent's file writes, applied here while the room is not wired. */
const AGENT_ORIGIN = "console-next:agent-write";

/** The writer the agents service names on its marks (services/agents room-peer.ts). */
const AGENT_NAME = "Spec Agent";

/** Seed a doc as the room would hold it: the files. */
export function seedSpecDoc(doc: Y.Doc, seed: Pick<MockSpecExtras, "files">): void {
  for (const [path, markdown] of Object.entries(seed.files)) setDocFile(doc, path, markdown, SEED_ORIGIN);
}

const sessionDocs = new Map<string, Y.Doc>();

/**
 * The project's doc, seeded from the model the first time it is asked for.
 * The app reads it through `useSpecDoc`; MSW's design agent reads it too, as
 * the real agent reads the room, to see the spec as the user has edited it.
 */
export function projectSpecDoc(projectName: string, seed: Pick<MockSpecExtras, "files">): Y.Doc {
  const existing = sessionDocs.get(projectName);
  if (existing) return existing;
  const doc = new Y.Doc();
  seedSpecDoc(doc, seed);
  sessionDocs.set(projectName, doc);
  return doc;
}

/** The project's spec doc, or null until it is ready. */
export function useSpecDoc(projectName: string): Y.Doc | null {
  const mock = env.apiMode === "mock";
  const { orgHandle } = useSession();
  const room = useSpecRoom(orgHandle, projectName, !mock);
  const seed = useMockSpecExtras(projectName).data;
  const local = useMemo(() => (mock && seed ? projectSpecDoc(projectName, seed) : null), [mock, projectName, seed]);
  return mock ? local : room.doc;
}

/** Commit the room's pending edits to git before a build tags HEAD; nothing to commit in mock mode. */
export function useSpecFlush(projectName: string): () => Promise<void> {
  const { orgHandle } = useSession();
  return useSpecRoom(orgHandle, projectName, env.apiMode !== "mock").flush;
}

/**
 * Apply one of the agent's accepted file writes (a file tool's `tool-result`,
 * which carries the call's input) to the doc, through @aep/agent-stream's own
 * applier, so an `editFile` matches exactly as the agents service matched it.
 * False when the part is not a file write or changed nothing. An edit is not
 * idempotent (its new text can contain its old), so the caller applies each
 * write once.
 *
 * An existing markdown file takes the write as the agents service writes into
 * the room (setDocFileAsAgent): character-exact, so the user's text is
 * untouched, and what the agent inserts carries its mark with the time it
 * wrote it, which draws the fading wash (specLinesPlugin.ts).
 *
 * The stand-in for the room: today no peer writes the agent's changes into
 * this local doc, so the chat's turn stream does. Once the Hocuspocus provider
 * is wired the agents service writes them into the room itself, and this and
 * `applyAgentWrite` are deleted.
 */
export function applyAgentToolCall(doc: Y.Doc, part: StreamPart): boolean {
  if (!part.toolName || !isFileMutationTool(part.toolName)) return false;
  const input = part.input as { path?: unknown } | undefined;
  if (typeof input?.path !== "string") return false;
  const path = input.path;
  const before = readDocFile(doc, path);
  const bundle = new FileBundle(before === undefined ? {} : { [path]: before });
  applyToolCall(bundle, { ...part, input: { ...input, path } });
  const after = bundle.read(path);
  if (after === before) return false;
  if (after === undefined) deleteDocFile(doc, path, AGENT_ORIGIN);
  else if (before !== undefined && isMarkdownPath(path)) {
    setDocFileAsAgent(doc, path, after, AGENT_ORIGIN, { agent: AGENT_NAME, at: new Date().toISOString() });
  }
  // A new file, or a plain-text one (diff-and-patched by setDocFile).
  else setDocFile(doc, path, after, AGENT_ORIGIN);
  return true;
}

/**
 * The agent wrote a file in a project's spec: apply it to that project's doc.
 * A project whose doc was never opened has nothing to update; its doc is
 * seeded from the mock, which already holds the write, when it opens. On the
 * platform no local doc exists: the agent writes into the room.
 */
export function applyAgentWrite(projectName: string, part: StreamPart): void {
  const doc = sessionDocs.get(projectName);
  if (doc) applyAgentToolCall(doc, part);
}
