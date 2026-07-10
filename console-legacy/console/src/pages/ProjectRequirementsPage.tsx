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
 * Requirements page — committed-truth model (shared-volume-clone D13–D20).
 *
 * There is no client-side draft: the server tree at HEAD (`readTree`) is the
 * COMPLETE truth. Generation runs server-side (`startTurn` → 202 → resumable
 * stream); the fold here is display-only live preview, and on the terminal
 * `turn-committed` event the page refetches HEAD. Unsaved EDITOR buffers are
 * transient UI state, flushed through one `files/apply` commit at Publish;
 * file add/delete/rename of committed files are one commit each. Refresh
 * mid-generation re-attaches to the running turn (D16); a concurrent turn
 * attaches as a viewer (D18); editing is guarded while a requirements turn
 * writes this subtree (D20).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  PageContent,
  Stack,
  Tooltip,
  Typography,
} from '@wso2/oxygen-ui';
import { GitCompare, GitHub, Save, Sparkles } from '@wso2/oxygen-ui-icons-react';
import type { CollabConfig } from '@aep/md-editor';
import { Explorer, type ExplorerRef, type AddFileMenuItem } from '@aep/explorer';
import { api, ApiError } from '../services/api';
import type { ArtifactVersion } from '../services/api';
import { applyFiles, readTree, type ApplyDelete, type ApplyWrite } from '../services/api/files';
import {
  attachTurnStream,
  getActiveTurn,
  getTurn,
  newConversationId,
  startTurn,
  turnErrorMessage,
} from '../services/api/turns';
import { computeDerivedArtifacts, derivedPathsFor } from '../lib/derivedArtifacts';
import { useCollabEditor } from '../hooks/useCollabEditor';
import CollabAwarenessBar from '../components/CollabAwarenessBar';
import { env } from '../config/env';
import VersionSelector from '../components/VersionSelector';
import { subscribeTurnActivity } from '../services/chatStore';
import {
  DOCUMENT_TYPES,
  documentTypeForFile,
  getDocumentType,
  nextFilenameFor,
  toTitleCase,
  type DocumentType,
} from '../lib/documentTypes';

const REQUIREMENTS_MAIN_FILE = 'requirements.md';
const REQ_PREFIX = 'specs/requirements/';
// The turn-seed read spans the whole spec tree — the display fold must replay
// on the same view the agents service reads (see `attachTurnStream`'s seed).
const SPECS_PREFIX = 'specs/';

/** filename (bundle key) ↔ full `specs/requirements/…` path (server/turn/apply). */
const toFull = (name: string): string => `${REQ_PREFIX}${name}`;
const toName = (full: string): string =>
  full.startsWith(REQ_PREFIX) ? full.slice(REQ_PREFIX.length) : full;

/** Project a full-path map to the filename-keyed map the Explorer renders. */
function filesAsFilenames(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [full, content] of Object.entries(files)) out[toName(full)] = content;
  return out;
}

/** Machine-derived views (`.excalidraw` scenes, `*.gen.json` projections). */
function isDerivedPath(path: string): boolean {
  return /\.excalidraw$/i.test(path) || /\.gen\.json$/i.test(path);
}

/** The one banner both spec pages show when an apply hits a CAS conflict. */
export const APPLY_CONFLICT_MESSAGE =
  'changed on the server since you loaded them. Reload to get the latest — your unsaved local edits will be discarded.';

/** A running turn the page is attached to (own generation or viewer, D16/D18). */
interface ActiveGen {
  turnId: string;
  useCase: string;
  viewer: boolean;
}

export default function ProjectRequirementsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgId, projectId } = useParams();
  const routeOrgId = orgId ?? 'default';

  const streamPrompt = (location.state as { streamPrompt?: string } | null)?.streamPrompt ?? null;

  const [loading, setLoading] = useState(!streamPrompt);
  const [activePath, setActivePath] = useState<string | null>(null); // filename space

  // -- Server truth (committed HEAD) + transient editor buffers --------------
  const [serverFiles, setServerFiles] = useState<Record<string, string>>({});
  const serverFilesRef = useRef<Record<string, string>>({});
  // Blob shas at HEAD (the apply `baseSha`s) — read synchronously by handlers.
  const serverShasRef = useRef<Record<string, string>>({});
  // Unsaved editor buffers (full-path keys). Transient UI state only — flushed
  // via files/apply at Publish; refs stay in sync for synchronous handlers.
  const [buffers, setBuffersState] = useState<Record<string, string>>({});
  const buffersRef = useRef<Record<string, string>>({});
  const updateBuffers = useCallback(
    (fn: (prev: Record<string, string>) => Record<string, string>) => {
      const next = fn(buffersRef.current);
      if (next === buffersRef.current) return;
      buffersRef.current = next;
      setBuffersState(next);
    },
    [],
  );

  const [roomId, setRoomId] = useState<string | null>(null);
  const [generatingFile, setGeneratingFile] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamingMain, setStreamingMain] = useState(!!streamPrompt);
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [viewingHistorical, setViewingHistorical] = useState(false);
  const [historicalFiles, setHistoricalFiles] = useState<Record<string, string> | null>(null);
  // Live streamed snapshot (full-path keys) while a turn runs — lets the
  // explorer/editor mount and show content growing BEFORE the backend commits
  // (on a fresh project HEAD is empty, so without this the page sits on the
  // "Generating requirements…" placeholder until the very end).
  const [liveFiles, setLiveFiles] = useState<Record<string, string> | null>(null);
  const [serverUnsaved, setServerUnsaved] = useState(false); // HEAD ahead of last tag
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [lastTaggedActive, setLastTaggedActive] = useState<string | null>(null);
  const [repoUrl, setRepoUrl] = useState<string>('');
  const [userName, setUserName] = useState<string | undefined>(undefined);
  const [publishing, setPublishing] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  // Files awaiting their first content this turn (add/generate) — sidebar spinner.
  const [pendingPaths, setPendingPaths] = useState<Set<string>>(new Set());
  // A chat turn is writing this project — pause the collab save loop + guard.
  const [chatTurnInFlight, setChatTurnInFlight] = useState(false);
  // The running turn this page is attached to (generation, resume, or viewer).
  const [activeGen, setActiveGen] = useState<ActiveGen | null>(null);
  const [viewerNotice, setViewerNotice] = useState<string | null>(null);
  // A files/apply CAS conflict (409): the conflicting paths + reload affordance.
  const [applyConflict, setApplyConflict] = useState<string[] | null>(null);

  const editorRef = useRef<ExplorerRef>(null);
  // The create-flow prompt, captured ONCE at first render: the router state is
  // cleared (navigate-replace) as soon as the bootstrap starts, and reading it
  // live would re-run — and therefore abort — the in-flight bootstrap effect.
  const [initialPrompt] = useState(() => streamPrompt);
  // Serializes locally-started generation turns (the server's one-turn-per-
  // project guard would 409 the second anyway; don't even send it).
  const generatingRef = useRef(false);

  // -- Chat-turn lifecycle (the chat panel streams; this page mirrors) -------
  useEffect(() => {
    if (!projectId) return;
    return subscribeTurnActivity((e) => {
      if (e.orgId !== routeOrgId || e.projectId !== projectId) return;
      if (e.kind === 'turnStarted') {
        setChatTurnInFlight(true);
      } else if (e.kind === 'turnSnapshot') {
        setLiveFiles((prev) => ({ ...(prev ?? {}), ...e.files }));
      } else if (e.kind === 'turnEnded') {
        setChatTurnInFlight(false);
        setLiveFiles(null);
        if (e.committed) void refreshServer();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeOrgId, projectId]);

  // -- Collab: save flows into the transient editor buffer -------------------
  const handleCollabSave = useCallback(
    async (val: string) => {
      if (!activePath) return;
      setBuffer(toFull(activePath), val);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activePath],
  );
  const handleSeedRequested = useCallback((markdown: string) => {
    editorRef.current?.setActiveMarkdown(markdown);
  }, []);

  const { connected, peers, ydoc, provider, user } = useCollabEditor({
    roomId,
    orgId: routeOrgId,
    projectId,
    getMarkdown: () => editorRef.current?.getActiveMarkdown() ?? '',
    onSave: handleCollabSave,
    onSeedRequested: handleSeedRequested,
    isEditing: true,
    userName,
    paused: chatTurnInFlight,
  });

  const collabConfig: CollabConfig | undefined = useMemo(() => {
    if (!ydoc || !provider || !user) return undefined;
    return { ydoc, provider, user };
  }, [ydoc, provider, user]);

  /** Buffer one editor value; a buffer that matches the server content is dropped. */
  const setBuffer = useCallback(
    (full: string, content: string) => {
      updateBuffers((prev) => {
        if (serverFilesRef.current[full] === content) {
          if (!(full in prev)) return prev;
          const next = { ...prev };
          delete next[full];
          return next;
        }
        if (prev[full] === content) return prev;
        return { ...prev, [full]: content };
      });
    },
    [updateBuffers],
  );

  // -- Server sync (committed HEAD; versions/metadata) ------------------------
  const refreshServer = useCallback(async () => {
    if (!projectId) return;
    const [tree, bundle, session] = await Promise.all([
      readTree(projectId, REQ_PREFIX).catch(() => ({
        files: {} as Record<string, string>,
        shas: {} as Record<string, string>,
      })),
      api.getRequirements(projectId),
      // Skip the collab-session pre-flight while collab is disabled — no roomId
      // is set, so no WebSocket is opened and the awareness bar stays hidden.
      env.VITE_COLLAB_ENABLED ? api.getCollabSession(projectId) : Promise.resolve(undefined),
    ]);
    serverFilesRef.current = tree.files;
    serverShasRef.current = tree.shas;
    setServerFiles(tree.files);
    // Buffers that now match the committed content are no longer edits.
    updateBuffers((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [p, c] of Object.entries(prev)) {
        if (tree.files[p] === c) {
          delete next[p];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    if (bundle) {
      setServerUnsaved(bundle.hasUnsavedChanges ?? false);
      setCurrentVersion(bundle.version ?? 0);
      if (bundle.versions) setVersions(bundle.versions);
    }
    if (session?.roomId) setRoomId(session.roomId);
    if (session) setUserName(session.userName || session.email || 'Anonymous');
  }, [projectId, updateBuffers]);

  // -- Turn attach (generation, refresh-resume, viewer) -----------------------

  /**
   * Attach to a turn's stream, drive the live preview, and on the terminal
   * `turn-committed` event refetch the server tree. `viewer` shows the D18
   * "in-progress generation" notice.
   */
  const attachGen = useCallback(
    async (
      turnId: string,
      useCase: string,
      o: {
        viewer?: boolean;
        signal?: AbortSignal;
        editorTarget?: string;
        pendingFile?: string;
      } = {},
    ) => {
      if (!projectId) return;
      setActiveGen({ turnId, useCase, viewer: o.viewer ?? false });
      if (o.viewer) setViewerNotice('A generation is already in progress — viewing it live.');
      try {
        // The fold's seed is the CURRENT server tree (whole spec subtree — the
        // same view the agents service reads). Replayed parts re-apply on top;
        // a resumed replay may briefly diverge from the final committed state,
        // which the terminal event + refetch reconcile.
        const seed = await readTree(projectId, SPECS_PREFIX)
          .then((t) => t.files)
          .catch(() => ({}) as Record<string, string>);
        const result = await attachTurnStream(projectId, turnId, {
          from: 0,
          seed,
          signal: o.signal,
          handlers: {
            onSnapshot: (files) => {
              setLiveFiles((prev) => ({ ...(prev ?? {}), ...files }));
              if (o.pendingFile && files[toFull(o.pendingFile)] !== undefined) {
                clearPending(o.pendingFile);
              }
              if (o.editorTarget) {
                const md = files[toFull(o.editorTarget)];
                if (md !== undefined) editorRef.current?.setActiveMarkdown(md);
              }
            },
          },
        });
        if (o.signal?.aborted) return;
        if (result.ok) {
          await refreshServer();
        } else {
          setStreamError(turnErrorMessage(result));
        }
      } catch (err) {
        if (o.signal?.aborted) return;
        setStreamError(
          err instanceof Error && err.message ? err.message : 'Generation failed.',
        );
      } finally {
        if (!o.signal?.aborted) {
          setActiveGen(null);
          setLiveFiles(null);
          setViewerNotice(null);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, refreshServer],
  );

  /** 409 turn_in_progress → attach to the running turn as a viewer (D18). */
  const attachToActive = useCallback(
    async (activeTurnId: string, signal?: AbortSignal) => {
      if (!projectId) return;
      const status = await getTurn(projectId, activeTurnId).catch(() => null);
      if (signal?.aborted) return;
      await attachGen(activeTurnId, status?.useCase ?? 'requirements-generate', {
        viewer: true,
        signal,
      });
    },
    [projectId, attachGen],
  );

  const bootstrapFromPrompt = useCallback(
    async (prompt: string, controller: AbortController) => {
      if (!projectId) return;
      setStreamError(null);
      setStreamingMain(true);
      setActivePath(REQUIREMENTS_MAIN_FILE);
      try {
        // Seed the page from HEAD (empty on a fresh project) before streaming.
        await refreshServer();
        if (controller.signal.aborted) return;
        const start = await startTurn(projectId, newConversationId(), {
          useCase: 'requirements-generate',
          instruction: prompt,
        });
        if (controller.signal.aborted) return;
        if (!start.ok) {
          if (start.code === 'turn_in_progress' && start.activeTurnId) {
            await attachToActive(start.activeTurnId, controller.signal);
          } else {
            setStreamError(turnErrorMessage(start));
          }
          return;
        }
        await attachGen(start.turnId, 'requirements-generate', {
          signal: controller.signal,
          editorTarget: REQUIREMENTS_MAIN_FILE,
        });
      } catch (err) {
        // An abort (unmount, StrictMode's throwaway first mount) is not an
        // error; anything else must SURFACE — swallowing it wedges the page
        // on the generating state with no way out.
        if (controller.signal.aborted) return;
        setStreamError(
          err instanceof Error && err.message ? err.message : 'Requirements generation failed.',
        );
      } finally {
        // A superseded attempt must not clobber the live attempt's UI state.
        if (!controller.signal.aborted) {
          setStreamingMain(false);
          setLoading(false);
        }
      }
    },
    [projectId, refreshServer, attachGen, attachToActive],
  );

  // -- Initial load + streaming bootstrap ------------------------------------
  //
  // Start-on-mount / abort-on-cleanup so it survives StrictMode's dev-mode
  // mount→unmount→remount: the first (throwaway) attempt is aborted before its
  // POST is sent and the remount starts a fresh one.
  useEffect(() => {
    if (!projectId) return;

    if (initialPrompt) {
      // Clear the router state so a refresh doesn't re-trigger a generation
      // (the captured `initialPrompt` keeps this effect's input stable).
      navigate(location.pathname, { replace: true });
      const controller = new AbortController();
      void bootstrapFromPrompt(initialPrompt, controller);
      return () => controller.abort();
    }

    // Normal load + refresh-mid-generation recovery (D16): a running
    // requirements turn is re-attached from index 0 in live mode.
    const controller = new AbortController();
    (async () => {
      await refreshServer();
      if (controller.signal.aborted) return;
      setLoading(false);
      const active = await getActiveTurn(projectId).catch(() => null);
      if (controller.signal.aborted) return;
      if (active && active.status === 'running' && active.useCase.startsWith('requirements')) {
        setViewerNotice('A generation is in progress — showing it live.');
        await attachGen(active.turnId, active.useCase, { viewer: true, signal: controller.signal });
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt, projectId]);

  // Retry a failed cold-start bootstrap. `initialPrompt` is retained across the
  // router-state clear, so the same prompt can be re-run without leaving the page.
  const retryCtrlRef = useRef<AbortController | null>(null);
  useEffect(() => () => retryCtrlRef.current?.abort(), []);
  const retryBootstrap = useCallback(() => {
    if (!initialPrompt) return;
    retryCtrlRef.current?.abort();
    const controller = new AbortController();
    retryCtrlRef.current = controller;
    void bootstrapFromPrompt(initialPrompt, controller);
  }, [initialPrompt, bootstrapFromPrompt]);

  // Repo URL banner.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      const status = await api.getProjectStatus(projectId);
      if (!cancelled && status?.repoUrl) setRepoUrl(status.repoUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Fetch the active file's content at the latest tag for the diff view.
  useEffect(() => {
    if (!projectId || !activePath || versions.length === 0) {
      setLastTaggedActive(null);
      return;
    }
    const latest = Math.max(...versions.map((v) => v.version));
    let cancelled = false;
    (async () => {
      const at = await api.getRequirementsAtVersion(projectId, `v${latest}`);
      if (!cancelled) setLastTaggedActive(at?.files?.[activePath] ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, activePath, versions]);

  // -- Pending-path helpers (sidebar spinner) ---------------------------------
  const markPending = useCallback((name: string) => {
    setPendingPaths((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
  }, []);
  const clearPending = useCallback((name: string) => {
    setPendingPaths((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }, []);

  // -- Per-file generation turns ----------------------------------------------

  const generateFor = useCallback(
    async (filename: string, docType: DocumentType) => {
      if (!projectId || !docType.generationSkillId) return;
      if (generatingRef.current) return; // a generation is already in flight
      generatingRef.current = true;
      setGeneratingFile(filename);
      markPending(filename);
      setStreamError(null);
      // Show the target row immediately; the stream fills it in.
      setLiveFiles((prev) => ({ ...(prev ?? {}), [toFull(filename)]: '' }));
      try {
        const start = await startTurn(projectId, newConversationId(), {
          useCase: 'requirements-generate',
          instruction: `Generate the ${docType.label} for this project.`,
          target: filename,
        });
        if (!start.ok) {
          if (start.code === 'turn_in_progress' && start.activeTurnId) {
            await attachToActive(start.activeTurnId);
          } else {
            setStreamError(turnErrorMessage(start));
            setLiveFiles(null);
          }
          return;
        }
        const isCanvas = docType.extension === '.excalidraw';
        await attachGen(start.turnId, 'requirements-generate', {
          pendingFile: filename,
          editorTarget: isCanvas ? undefined : filename,
        });
      } finally {
        setGeneratingFile(null);
        clearPending(filename);
        generatingRef.current = false;
      }
    },
    [projectId, markPending, clearPending, attachGen, attachToActive],
  );

  const activeDocType: DocumentType | undefined =
    activePath ? documentTypeForFile(activePath) : undefined;

  const generateActive = () => {
    if (!activePath || !activeDocType) return;
    void generateFor(activePath, activeDocType);
  };

  // -- File operations: add / delete / rename ---------------------------------
  //
  // Committed truth: mutations of committed files are one `files/apply` commit
  // each; a brand-new manual doc starts life as an editor buffer and commits
  // with the Publish flush.

  const addFileMenuItems: AddFileMenuItem[] = useMemo(() => {
    const filenames = Object.keys(filesAsFilenames({ ...serverFiles, ...buffers }));
    const existingTypeIds = new Set(
      filenames.map((n) => documentTypeForFile(n)?.id).filter((id): id is NonNullable<typeof id> => Boolean(id)),
    );
    return DOCUMENT_TYPES.filter((t) => !t.protected && !existingTypeIds.has(t.id)).map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
    }));
  }, [serverFiles, buffers]);

  const handleAddFile = useCallback(
    (typeId?: string) => {
      if (!projectId || !typeId) return undefined;
      const type = getDocumentType(typeId);
      if (!type) return undefined;
      const names = Object.keys(
        filesAsFilenames({ ...serverFilesRef.current, ...buffersRef.current }),
      );
      const filename = nextFilenameFor(type, names);
      if (type.generationSkillId) {
        // The generation turn authors + commits the file server-side.
        setActivePath(filename);
        void generateFor(filename, type);
        return filename;
      }
      const initial =
        type.extension === '.excalidraw'
          ? ''
          : `# ${type.label}\n\nGenerate from existing documents using the Sparkles button above.`;
      updateBuffers((prev) => ({ ...prev, [toFull(filename)]: initial }));
      setActivePath(filename);
      return filename;
    },
    [projectId, generateFor, updateBuffers],
  );

  /** Surface a failed apply (non-409) on the shared error banner. */
  const reportApplyError = useCallback((err: unknown, fallback: string) => {
    setPublishError(err instanceof ApiError && err.message ? err.message : fallback);
  }, []);

  const handleDelete = useCallback(
    (name: string) => {
      if (!projectId || name === REQUIREMENTS_MAIN_FILE) return; // protected root
      const full = toFull(name);
      updateBuffers((prev) => {
        if (!(full in prev)) return prev;
        const next = { ...prev };
        delete next[full];
        return next;
      });
      if (activePath === name) setActivePath(REQUIREMENTS_MAIN_FILE);
      if (!(full in serverFilesRef.current)) return; // buffer-only — nothing committed
      // One commit per delete. A derived/source sibling dies with the file
      // (the `.dsl` source and its `.excalidraw` view are one document).
      const deletes: ApplyDelete[] = [{ path: full, baseSha: serverShasRef.current[full] }];
      const sibling = /\.excalidraw$/i.test(full)
        ? full.replace(/\.excalidraw$/i, '.dsl')
        : /\.dsl$/i.test(full)
          ? full.replace(/\.dsl$/i, '.excalidraw')
          : null;
      if (sibling && sibling in serverFilesRef.current) {
        deletes.push({ path: sibling, baseSha: serverShasRef.current[sibling] });
      }
      void (async () => {
        try {
          const res = await applyFiles(projectId, { deletes, message: `Delete ${name}` });
          if (!res.ok) setApplyConflict(res.conflicts.map((c) => c.path));
          await refreshServer();
        } catch (err) {
          reportApplyError(err, 'Failed to delete the file.');
        }
      })();
    },
    [projectId, activePath, updateBuffers, refreshServer, reportApplyError],
  );

  const handleRename = useCallback(
    (oldName: string, newName: string) => {
      if (!projectId || oldName === REQUIREMENTS_MAIN_FILE || oldName === newName) return;
      const oldFull = toFull(oldName);
      const newFull = toFull(newName);
      const content = buffersRef.current[oldFull] ?? serverFilesRef.current[oldFull] ?? '';
      const committed = oldFull in serverFilesRef.current;
      updateBuffers((prev) => {
        const next = { ...prev };
        delete next[oldFull];
        if (!committed) next[newFull] = content; // buffer-only file: local rename
        return next;
      });
      if (activePath === oldName) setActivePath(newName);
      if (!committed) return;
      void (async () => {
        try {
          const res = await applyFiles(projectId, {
            writes: [{ path: newFull, content }],
            deletes: [{ path: oldFull, baseSha: serverShasRef.current[oldFull] }],
            message: `Rename ${oldName} to ${newName}`,
          });
          if (!res.ok) setApplyConflict(res.conflicts.map((c) => c.path));
          await refreshServer();
        } catch (err) {
          reportApplyError(err, 'Failed to rename the file.');
        }
      })();
    },
    [projectId, activePath, updateBuffers, refreshServer, reportApplyError],
  );

  // -- Save (flush buffers → apply commit; NO tag — versions are cut by Build) --
  const handleSave = async () => {
    if (!projectId) return;
    // Flush the active editor buffer first.
    if (activePath) {
      const md = editorRef.current?.getActiveMarkdown();
      if (md !== undefined) setBuffer(toFull(activePath), md);
    }
    setPublishing(true);
    setPublishError(null);
    setApplyConflict(null);
    try {
      const server = serverFilesRef.current;
      const shas = serverShasRef.current;
      const merged = { ...server, ...buffersRef.current };
      // Recompute the derived views (`.dsl → .excalidraw`) so sources never
      // commit alongside stale views; prune derived files whose source is gone.
      const sources: Record<string, string> = {};
      for (const [p, c] of Object.entries(merged)) if (!isDerivedPath(p)) sources[p] = c;
      const derived = computeDerivedArtifacts(projectId, sources);
      const keep = derivedPathsFor(sources);
      const finalTree: Record<string, string> = { ...sources };
      for (const [p, c] of Object.entries(derived.files)) if (keep.has(p)) finalTree[p] = c;

      const writes: ApplyWrite[] = [];
      for (const [p, c] of Object.entries(finalTree)) {
        if (!p.startsWith(REQ_PREFIX)) continue;
        if (server[p] === c) continue;
        writes.push(shas[p] ? { path: p, content: c, baseSha: shas[p] } : { path: p, content: c });
      }
      const deletes: ApplyDelete[] = [];
      for (const p of Object.keys(server)) {
        if (!isDerivedPath(p) || keep.has(p)) continue;
        deletes.push({ path: p, baseSha: shas[p] });
      }

      if (writes.length > 0 || deletes.length > 0) {
        const res = await applyFiles(projectId, { writes, deletes, message: 'Update requirements' });
        if (!res.ok) {
          setApplyConflict(res.conflicts.map((c) => c.path));
          setPublishing(false);
          return;
        }
      }
      updateBuffers(() => ({}));
      await refreshServer();
      setPublishing(false);
    } catch (err) {
      setPublishError(err instanceof ApiError ? err.message : 'Failed to save. Please try again.');
      setPublishing(false);
    }
  };

  // -- Discard (server-side revert to the last tag) ----------------------------
  const handleDiscard = async () => {
    if (!projectId) return;
    setIsDiscarding(true);
    try {
      await api.discardRequirements(projectId);
      updateBuffers(() => ({}));
      await refreshServer();
    } finally {
      setIsDiscarding(false);
    }
  };

  /** The apply-conflict "Reload" affordance: adopt server truth, drop buffers. */
  const reloadFromServer = useCallback(async () => {
    updateBuffers(() => ({}));
    setApplyConflict(null);
    await refreshServer();
  }, [updateBuffers, refreshServer]);

  // -- Versions ------------------------------------------------------------
  const handleVersionSelect = async (version: number) => {
    if (!projectId) return;
    const latestVersion = versions.length > 0 ? Math.max(...versions.map((v) => v.version)) : 0;
    if (version === latestVersion) {
      setHistoricalFiles(null);
      setViewingHistorical(false);
      await refreshServer();
    } else {
      const at = await api.getRequirementsAtVersion(projectId, `v${version}`);
      if (at?.files) {
        setHistoricalFiles(at.files);
        setCurrentVersion(version);
        setViewingHistorical(true);
      }
    }
  };

  // -- Derived render state ------------------------------------------------

  // D20 edit guard: a requirements turn (generate or chat) is writing this
  // subtree — freeze the editor + Publish; unrelated pages stay editable.
  const reqTurnActive =
    streamingMain ||
    generatingFile !== null ||
    chatTurnInFlight ||
    (activeGen?.useCase.startsWith('requirements') ?? false);

  const bufferDirty = Object.entries(buffers).some(([p, c]) => serverFiles[p] !== c);
  const dirty = bufferDirty || serverUnsaved;

  // Display = committed HEAD + unsaved buffers (+ live overlay while a turn
  // streams). The live fold spans the whole spec tree — only this page's
  // subtree is shown here.
  const displayFull = useMemo(() => {
    const out: Record<string, string> = { ...serverFiles, ...buffers };
    if (liveFiles) {
      for (const [p, c] of Object.entries(liveFiles)) {
        if (p.startsWith(REQ_PREFIX)) out[p] = c;
      }
    }
    return out;
  }, [serverFiles, buffers, liveFiles]);

  // Derived VIEW overlay: the `.excalidraw` scenes are recomputed from their
  // `.dsl` sources for display (the committed ones can be stale right after a
  // generation commit; Publish recommits fresh ones). Identity-stabilized on
  // the source subset so a markdown keystroke never recompiles a DSL.
  const dslSourceRef = useRef<Record<string, string> | null>(null);
  const dslSource = useMemo<Record<string, string>>(() => {
    const subset: Record<string, string> = {};
    for (const [p, c] of Object.entries(displayFull)) {
      if (/\.dsl$/i.test(p)) subset[p] = c;
    }
    const prev = dslSourceRef.current;
    if (prev) {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(subset);
      if (prevKeys.length === nextKeys.length && nextKeys.every((p) => prev[p] === subset[p])) {
        return prev;
      }
    }
    dslSourceRef.current = subset;
    return subset;
  }, [displayFull]);
  const derivedView = useMemo<Record<string, string> | null>(() => {
    if (Object.keys(dslSource).length === 0) return null;
    return computeDerivedArtifacts(projectId ?? '', dslSource).files;
  }, [dslSource, projectId]);
  const displayWithDerived = useMemo(
    () => (derivedView ? { ...displayFull, ...derivedView } : displayFull),
    [displayFull, derivedView],
  );

  // Hide `.dsl` sources; the user only sees the rendered `.excalidraw`.
  const hideDsl = (m: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(m).filter(([k]) => !/\.dsl$/i.test(k)));
  const explorerFiles = hideDsl(
    viewingHistorical && historicalFiles ? historicalFiles : filesAsFilenames(displayWithDerived),
  );

  // Default the active file to requirements.md (or the first available).
  useEffect(() => {
    setActivePath((prev) => {
      const names = Object.keys(explorerFiles);
      if (prev && names.includes(prev)) return prev;
      if (names.includes(REQUIREMENTS_MAIN_FILE)) return REQUIREMENTS_MAIN_FILE;
      return names[0] ?? null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverFiles, buffers, liveFiles, viewingHistorical, historicalFiles]);

  const getFileLabel = (path: string): string | undefined => {
    const type = documentTypeForFile(path);
    const label = type ? type.label : toTitleCase(path);
    return pendingPaths.has(path) ? `${label} — generating…` : label;
  };
  const getFileSortKey = (path: string): number | undefined => {
    const type = documentTypeForFile(path);
    if (!type) return undefined;
    const idx = DOCUMENT_TYPES.findIndex((t) => t.id === type.id);
    return idx < 0 ? undefined : idx;
  };

  if (loading) {
    return (
      <PageContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 12 }}>
          <CircularProgress size={48} sx={{ mb: 3 }} />
          <Typography variant="h6" color="text.secondary">Loading requirements...</Typography>
        </Box>
      </PageContent>
    );
  }

  const generatingWholePage =
    streamingMain || activeGen?.useCase === 'requirements-generate';

  if (Object.keys(explorerFiles).length === 0 && generatingWholePage) {
    return (
      <PageContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 12 }}>
          <CircularProgress size={48} sx={{ mb: 3 }} />
          <Typography variant="h6" color="text.secondary">Generating requirements…</Typography>
        </Box>
      </PageContent>
    );
  }

  if (Object.keys(explorerFiles).length === 0 && !generatingWholePage && !connected) {
    // A failed cold-start bootstrap lands here (empty tree, not streaming).
    // Surface the error inline with a Retry instead of the bare empty state, so
    // a transient pre-flight failure isn't a dead end.
    return (
      <PageContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 12 }}>
          {streamError && initialPrompt ? (
            <>
              <Typography variant="h6" color="error">Couldn't start generation.</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2, maxWidth: 480, textAlign: 'center' }}>
                {streamError}
              </Typography>
              <Button variant="contained" onClick={retryBootstrap}>Retry</Button>
            </>
          ) : (
            <>
              <Typography variant="h6" color="text.secondary">No requirements generated yet.</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Go to the prompt page to generate requirements from a description.
              </Typography>
            </>
          )}
        </Box>
      </PageContent>
    );
  }

  const editorCollab: CollabConfig | undefined =
    connected && !viewingHistorical ? collabConfig : undefined;

  const isCanvasFile = activePath?.toLowerCase().endsWith('.excalidraw') ?? false;
  const canShowDiff =
    dirty && lastTaggedActive !== null && !viewingHistorical && !reqTurnActive && !isCanvasFile;
  const renderDiff = showDiff && canShowDiff;

  const showGenerate =
    !!activeDocType?.generationSkillId &&
    !viewingHistorical &&
    !streamingMain &&
    activeDocType.id !== 'requirements';
  const generateLabel = activeDocType?.generationSourceFiles?.length
    ? `Generate from ${activeDocType.generationSourceFiles.join(', ')}`
    : 'Generate';

  return (
    <PageContent fullWidth noPadding sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          px: 3, py: 1.5, borderBottom: 1, borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 2, bgcolor: 'background.paper', flexShrink: 0,
        }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" gap={1.5}>
            <Typography variant="h4">Requirements</Typography>
            {versions.length > 0 && (
              <VersionSelector
                versions={versions}
                currentVersion={currentVersion}
                onVersionSelect={handleVersionSelect}
                isHistorical={viewingHistorical}
                hasUnsavedChanges={dirty}
                onDiscard={handleDiscard}
                isDiscarding={isDiscarding}
              />
            )}
            {canShowDiff && (
              <Button
                variant={renderDiff ? 'contained' : 'outlined'}
                color={renderDiff ? 'primary' : 'inherit'}
                size="small"
                startIcon={<GitCompare size={16} />}
                onClick={() => setShowDiff((v) => !v)}
                sx={{ minWidth: 'auto' }}
              >
                Diff
              </Button>
            )}
            {chatTurnInFlight && (
              <Typography variant="caption" color="text.secondary">The assistant is editing…</Typography>
            )}
            {viewerNotice && !chatTurnInFlight && (
              <Typography variant="caption" color="text.secondary" data-testid="viewer-notice">
                {viewerNotice}
              </Typography>
            )}
          </Stack>
        </Box>

        {showGenerate && (
          <Tooltip title={reqTurnActive ? 'A generation is writing the requirements — wait for it to finish.' : generateLabel}>
            <span>
              <Button
                variant="outlined"
                size="small"
                startIcon={generatingFile === activePath ? <CircularProgress size={14} /> : <Sparkles size={16} />}
                // One active turn per project (D18): any running turn blocks a
                // new start, so don't offer one.
                disabled={reqTurnActive || activeGen !== null}
                onClick={generateActive}
              >
                {generatingFile === activePath ? 'Generating...' : 'Generate'}
              </Button>
            </span>
          </Tooltip>
        )}

        {repoUrl && (
          <Button
            variant="outlined"
            size="small"
            startIcon={<GitHub size={16} />}
            onClick={() => window.open(repoUrl, '_blank', 'noopener,noreferrer')}
          >
            View Repo
          </Button>
        )}

        {!viewingHistorical && !streamingMain && (
          <>
            <Divider orientation="vertical" flexItem />
            <Tooltip title={reqTurnActive ? 'A generation is writing the requirements — saving is disabled until it finishes.' : ''}>
              <span>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={publishing ? <CircularProgress size={14} color="inherit" /> : <Save size={16} />}
                  disabled={publishing || Object.keys(explorerFiles).length === 0 || reqTurnActive}
                  onClick={handleSave}
                >
                  {publishing ? 'Saving...' : 'Save'}
                </Button>
              </span>
            </Tooltip>
          </>
        )}
      </Box>

      {(streamError || publishError || applyConflict) && (
        <Box sx={{ px: 3, py: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
          {streamError && <Typography variant="body2" color="error">{streamError}</Typography>}
          {publishError && <Typography variant="body2" color="error">{publishError}</Typography>}
          {applyConflict && (
            <Stack direction="row" alignItems="center" gap={1.5} data-testid="apply-conflict">
              <Typography variant="body2" color="error">
                {applyConflict.join(', ')} {APPLY_CONFLICT_MESSAGE}
              </Typography>
              <Button size="small" variant="outlined" onClick={() => void reloadFromServer()}>
                Reload
              </Button>
            </Stack>
          )}
        </Box>
      )}

      <Box sx={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <Explorer
            files={explorerFiles}
            activePath={activePath}
            onActivePathChange={setActivePath}
            onFileChange={(name: string, md: string) => {
              setBuffer(toFull(name), md);
            }}
            onAddFile={handleAddFile}
            addFileMenu={{ items: addFileMenuItems }}
            onDelete={handleDelete}
            onRename={handleRename}
            getFileLabel={getFileLabel}
            getFileSortKey={getFileSortKey}
            pendingPaths={pendingPaths}
            editorProps={{
              readOnly: viewingHistorical || reqTurnActive || activeGen !== null,
              showToolbar: !viewingHistorical && !streamingMain,
              toolbarRightContent: roomId ? (
                <CollabAwarenessBar connected={connected} peers={peers} inToolbar />
              ) : undefined,
              collab: editorCollab,
              baseMarkdown: renderDiff ? lastTaggedActive ?? undefined : undefined,
            }}
            editorRef={editorRef}
          />
        </Box>
      </Box>
    </PageContent>
  );
}
