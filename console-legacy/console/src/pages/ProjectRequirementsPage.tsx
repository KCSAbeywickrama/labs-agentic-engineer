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
 * Requirements page — post-migration (§1/§5/§6 of the generation-migration doc).
 *
 * The BFF no longer holds a per-project working tree: this page owns the DRAFT
 * (the shared `specDraftSession`), and generation/chat run through the unified
 * turn endpoint whose stream is folded client-side. Manual edits and generation
 * folds mutate the draft in localStorage; nothing hits the network until the
 * user Publishes (atomic `files/apply` to GitHub, then a save-tag). The chat
 * panel writes into the SAME draft session, so its edits appear here live.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
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
import { GitCompare, GitHub, Rocket, Sparkles } from '@wso2/oxygen-ui-icons-react';
import type { CollabConfig } from '@aep/md-editor';
import { Explorer, type ExplorerRef, type AddFileMenuItem } from '@aep/explorer';
import { api, ApiError } from '../services/api';
import type { ArtifactVersion } from '../services/api';
import { readTree, applyFiles } from '../services/api/files';
import { runTurn, newConversationId, turnErrorMessage } from '../services/api/turns';
import { computeDerivedArtifacts, derivedPathsFor } from '../lib/derivedArtifacts';
import {
  buildApplyRequest,
  clearSpecDraft,
  commitApplied,
  deleteDraftFile,
  getSpecDraft,
  hasDraftChanges,
  patchDraftFile,
  rebaseToServer,
  setDraftFiles,
  subscribeSpecDraft,
  syncBase,
  type SpecDraftKey,
} from '../services/specDraftSession';
import { projectArchitecturePath } from '../lib/paths';
import { useCollabEditor } from '../hooks/useCollabEditor';
import CollabAwarenessBar from '../components/CollabAwarenessBar';
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

/** Shown when a generate turn hits the output-token limit; partial content kept. */
const TRUNCATED_MESSAGE =
  'Generation was cut off at the length limit. The partial result was kept — refine your prompt or regenerate to complete it.';

/** filename (bundle key) ↔ full `specs/requirements/…` path (session/turn/apply). */
const toFull = (name: string): string => `${REQ_PREFIX}${name}`;
const toName = (full: string): string =>
  full.startsWith(REQ_PREFIX) ? full.slice(REQ_PREFIX.length) : full;

/** Project a full-path draft to the filename-keyed map the Explorer renders. */
function draftAsFilenames(draft: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [full, content] of Object.entries(draft)) out[toName(full)] = content;
  return out;
}

export default function ProjectRequirementsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgId, projectId } = useParams();
  const routeOrgId = orgId ?? 'default';

  const streamPrompt = (location.state as { streamPrompt?: string } | null)?.streamPrompt ?? null;

  const key = useMemo<SpecDraftKey>(
    () => ({ orgId: routeOrgId, projectId: projectId ?? '', kind: 'requirements' }),
    [routeOrgId, projectId],
  );

  const [loading, setLoading] = useState(!streamPrompt);
  // Any change to the shared session forces a re-render; the draft is read
  // fresh from the store below (no mirror-state that could miss a base-only change).
  const [, bumpSession] = useReducer((n: number) => n + 1, 0);
  const [activePath, setActivePath] = useState<string | null>(null); // filename space

  const [roomId, setRoomId] = useState<string | null>(null);
  const [generatingFile, setGeneratingFile] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamingMain, setStreamingMain] = useState(!!streamPrompt);
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [viewingHistorical, setViewingHistorical] = useState(false);
  const [historicalFiles, setHistoricalFiles] = useState<Record<string, string> | null>(null);
  // Live streamed snapshot (full-path keys) while a generate turn runs — lets
  // the explorer/editor mount and show content growing BEFORE the fold commits
  // the draft (on a fresh project the draft is empty, so without this the page
  // sits on the "Generating requirements…" placeholder until the very end).
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
  // A chat turn is writing the draft — pause the collab save loop + hint the user.
  const [chatTurnInFlight, setChatTurnInFlight] = useState(false);

  const editorRef = useRef<ExplorerRef>(null);
  const startedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // Serializes generation turns: they all seed from and replace the shared draft,
  // so two in flight at once (each on its own conversation id, so the server's
  // per-conversation guard never fires) would race and clobber each other.
  const generatingRef = useRef(false);

  // The current draft (full-path keys), read fresh from the shared session.
  const draft = getSpecDraft(key).draft;

  // -- Session subscription: any draft/base change re-renders the page -------
  useEffect(() => subscribeSpecDraft(key, bumpSession), [key]);

  // Chat-turn lifecycle (the chat panel writes this session; pause collab).
  useEffect(() => {
    if (!projectId) return;
    return subscribeTurnActivity((e) => {
      if (e.orgId !== routeOrgId || e.projectId !== projectId) return;
      if (e.kind === 'turnStarted') setChatTurnInFlight(true);
      else if (e.kind === 'turnEnded') setChatTurnInFlight(false);
    });
  }, [routeOrgId, projectId]);

  // -- Collab: save writes the DRAFT (the per-file PUT route is gone) --------
  const handleCollabSave = useCallback(
    async (val: string) => {
      if (!activePath) return;
      patchDraftFile(key, toFull(activePath), val);
    },
    [key, activePath],
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

  // -- Server sync (committed HEAD → session base; versions/metadata) --------
  const refreshServer = useCallback(async () => {
    if (!projectId) return;
    const [tree, bundle, session] = await Promise.all([
      readTree(projectId, REQ_PREFIX).catch(() => ({ files: {}, shas: {} })),
      api.getRequirements(projectId),
      api.getCollabSession(projectId),
    ]);
    syncBase(key, tree);
    if (bundle) {
      setServerUnsaved(bundle.hasUnsavedChanges ?? false);
      setCurrentVersion(bundle.version ?? 0);
      if (bundle.versions) setVersions(bundle.versions);
    }
    if (session?.roomId) setRoomId(session.roomId);
    if (session) setUserName(session.userName || session.email || 'Anonymous');
  }, [key, projectId]);

  // -- Initial load + streaming bootstrap ----------------------------------
  useEffect(() => {
    if (!projectId) return;

    if (streamPrompt && !startedRef.current) {
      startedRef.current = true;
      navigate(location.pathname, { replace: true });
      void bootstrapFromPrompt(streamPrompt);
      return;
    }

    (async () => {
      await refreshServer();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamPrompt, projectId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Default the active file to requirements.md (or the first available).
  // Streamed liveFiles count as available: while a generate turn runs the draft
  // is still empty, and without them this effect would null the active path the
  // moment bootstrap sets it — leaving the editor pane on its empty state until
  // the fold commits (the sidebar meanwhile shows the streaming file).
  useEffect(() => {
    setActivePath((prev) => {
      const names = Object.keys(draftAsFilenames(liveFiles ? { ...draft, ...liveFiles } : draft));
      if (viewingHistorical && historicalFiles) {
        const hnames = Object.keys(historicalFiles);
        if (prev && hnames.includes(prev)) return prev;
        return hnames.includes(REQUIREMENTS_MAIN_FILE) ? REQUIREMENTS_MAIN_FILE : (hnames[0] ?? null);
      }
      if (prev && names.includes(prev)) return prev;
      if (names.includes(REQUIREMENTS_MAIN_FILE)) return REQUIREMENTS_MAIN_FILE;
      return names[0] ?? null;
    });
  }, [draft, liveFiles, viewingHistorical, historicalFiles]);

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

  // -- Pending-path helpers (sidebar spinner) ------------------------------
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

  // -- Generation turns (unified endpoint; fold client-side) ---------------

  /**
   * Fold a finished generate turn's agent-authored snapshot into the draft:
   * recompute derived artifacts, prune stale ones, and replace the draft. The
   * derived files commit alongside their sources at Publish (never sent to a turn).
   */
  const commitTurnResult = useCallback(
    (folded: Record<string, string>) => {
      const derived = computeDerivedArtifacts(projectId ?? '', folded);
      const keepDerived = derivedPathsFor(folded);
      const next: Record<string, string> = { ...folded };
      for (const [p, c] of Object.entries(derived.files)) {
        if (keepDerived.has(p)) next[p] = c;
      }
      setDraftFiles(key, next);
    },
    [key, projectId],
  );

  const bootstrapFromPrompt = useCallback(
    async (prompt: string) => {
      if (!projectId) return;
      setStreamError(null);
      setStreamingMain(true);
      setActivePath(REQUIREMENTS_MAIN_FILE);
      const controller = new AbortController();
      abortRef.current = controller;
      // Seed base (empty on a fresh project) so the draft starts clean.
      await refreshServer();
      const seed = getSpecDraft(key).draft;
      const result = await runTurn(
        projectId,
        newConversationId(),
        { useCase: 'requirements-generate', instruction: prompt, files: seed },
        {
          onText: () => {},
          onSnapshot: (files) => {
            setLiveFiles(files);
            const md = files[toFull(REQUIREMENTS_MAIN_FILE)];
            if (md !== undefined) editorRef.current?.setActiveMarkdown(md);
          },
        },
        controller.signal,
      );
      setStreamingMain(false);
      setLiveFiles(null);
      setLoading(false);
      if (result.ok) {
        commitTurnResult(result.files);
        if (result.truncated) setStreamError(TRUNCATED_MESSAGE);
      } else setStreamError(turnErrorMessage(result));
    },
    [key, projectId, refreshServer, commitTurnResult],
  );

  const generateFor = useCallback(
    async (filename: string, docType: DocumentType) => {
      if (!projectId || !docType.generationSkillId) return;
      if (generatingRef.current) return; // a generation is already in flight
      generatingRef.current = true;
      setGeneratingFile(filename);
      markPending(filename);
      setStreamError(null);
      try {
        const seed = getSpecDraft(key).draft;
        const isCanvas = docType.extension === '.excalidraw';
        const result = await runTurn(projectId, newConversationId(), {
          useCase: 'requirements-generate',
          instruction: `Generate the ${docType.label} for this project.`,
          target: filename,
          files: seed,
        }, {
          onSnapshot: (files) => {
            setLiveFiles(files);
            const full = toFull(filename);
            const content = files[full];
            if (content !== undefined && !isCanvas) {
              editorRef.current?.setActiveMarkdown(content);
              clearPending(filename);
            }
          },
        });
        if (result.ok) {
          commitTurnResult(result.files);
          if (result.truncated) setStreamError(TRUNCATED_MESSAGE);
        } else setStreamError(turnErrorMessage(result));
      } finally {
        setGeneratingFile(null);
        setLiveFiles(null);
        clearPending(filename);
        generatingRef.current = false;
      }
    },
    [key, projectId, markPending, clearPending, commitTurnResult],
  );

  const activeDocType: DocumentType | undefined =
    activePath ? documentTypeForFile(activePath) : undefined;

  const generateActive = () => {
    if (!activePath || !activeDocType) return;
    void generateFor(activePath, activeDocType);
  };

  // -- File operations: add / delete / rename (draft mutations) ------------

  const addFileMenuItems: AddFileMenuItem[] = useMemo(() => {
    const filenames = Object.keys(draftAsFilenames(draft));
    const existingTypeIds = new Set(
      filenames.map((n) => documentTypeForFile(n)?.id).filter((id): id is NonNullable<typeof id> => Boolean(id)),
    );
    return DOCUMENT_TYPES.filter((t) => !t.protected && !existingTypeIds.has(t.id)).map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
    }));
  }, [draft]);

  const handleAddFile = useCallback(
    (typeId?: string) => {
      if (!projectId || !typeId) return undefined;
      const type = getDocumentType(typeId);
      if (!type) return undefined;
      const filename = nextFilenameFor(type, Object.keys(draftAsFilenames(draft)));
      const willAutoGenerate = !!type.generationSkillId;
      const initial =
        type.extension === '.excalidraw' || willAutoGenerate
          ? ''
          : `# ${type.label}\n\nGenerate from existing documents using the Sparkles button above.`;
      patchDraftFile(key, toFull(filename), initial);
      setActivePath(filename);
      if (willAutoGenerate) void generateFor(filename, type);
      return filename;
    },
    [key, projectId, draft, generateFor],
  );

  const handleDelete = useCallback(
    (name: string) => {
      if (name === REQUIREMENTS_MAIN_FILE) return; // protected root
      deleteDraftFile(key, toFull(name));
      if (activePath === name) setActivePath(REQUIREMENTS_MAIN_FILE);
    },
    [key, activePath],
  );

  const handleRename = useCallback(
    (oldName: string, newName: string) => {
      if (oldName === REQUIREMENTS_MAIN_FILE || oldName === newName) return;
      const content = getSpecDraft(key).draft[toFull(oldName)] ?? '';
      patchDraftFile(key, toFull(newName), content);
      deleteDraftFile(key, toFull(oldName));
      if (activePath === oldName) setActivePath(newName);
    },
    [key, activePath],
  );

  // -- Publish (apply draft → save-tag → architecture) ---------------------
  const handlePublish = async () => {
    if (!projectId) return;
    // Flush the active editor buffer into the draft first.
    if (activePath) {
      const md = editorRef.current?.getActiveMarkdown();
      if (md !== undefined) patchDraftFile(key, toFull(activePath), md);
    }
    setPublishing(true);
    setPublishError(null);
    try {
      if (hasDraftChanges(key)) {
        const applied = await applyFiles(projectId, buildApplyRequest(key, 'Update requirements'));
        if (!applied.ok) {
          // Conflict: nothing applied. Re-base the draft onto the latest server
          // state (keeps your edits) so a re-publish overwrites; no merge UI.
          const tree = await readTree(projectId, REQ_PREFIX).catch(() => ({ files: {}, shas: {} }));
          rebaseToServer(key, tree);
          setPublishError(
            'Your draft was based on an older version — it has been re-based onto the latest. Review and Publish again to overwrite the conflicting files.',
          );
          setPublishing(false);
          return;
        }
        commitApplied(key, applied);
      }
      await api.saveRequirements(projectId);
      clearSpecDraft(key);
      const existingDesign = await api.getDesign(projectId);
      const regenerate = !!existingDesign && existingDesign.status !== 'none';
      navigate(projectArchitecturePath(routeOrgId, projectId), {
        state: { fromRequirements: true, regenerate },
      });
    } catch (err) {
      setPublishError(err instanceof ApiError ? err.message : 'Failed to publish. Please try again.');
      setPublishing(false);
    }
  };

  // -- Discard (revert HEAD to last tag; reset draft) ----------------------
  const handleDiscard = async () => {
    if (!projectId) return;
    setIsDiscarding(true);
    try {
      await api.discardRequirements(projectId);
      clearSpecDraft(key);
      await refreshServer();
    } finally {
      setIsDiscarding(false);
    }
  };

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
  const dirty = hasDraftChanges(key) || serverUnsaved;

  // Hide `.dsl` sources; the user only sees the rendered `.excalidraw`.
  const hideDsl = (m: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(m).filter(([k]) => !/\.dsl$/i.test(k)));
  const explorerFiles = hideDsl(
    viewingHistorical && historicalFiles
      ? historicalFiles
      : draftAsFilenames(liveFiles ? { ...draft, ...liveFiles } : draft),
  );

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

  if (Object.keys(explorerFiles).length === 0 && streamingMain) {
    return (
      <PageContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 12 }}>
          <CircularProgress size={48} sx={{ mb: 3 }} />
          <Typography variant="h6" color="text.secondary">Generating requirements…</Typography>
        </Box>
      </PageContent>
    );
  }

  if (Object.keys(explorerFiles).length === 0 && !streamingMain && !connected) {
    return (
      <PageContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 12 }}>
          <Typography variant="h6" color="text.secondary">No requirements generated yet.</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Go to the prompt page to generate requirements from a description.
          </Typography>
        </Box>
      </PageContent>
    );
  }

  const editorCollab: CollabConfig | undefined =
    connected && !viewingHistorical ? collabConfig : undefined;

  const isCanvasFile = activePath?.toLowerCase().endsWith('.excalidraw') ?? false;
  const canShowDiff =
    dirty && lastTaggedActive !== null && !viewingHistorical && !streamingMain && !isCanvasFile;
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
          </Stack>
        </Box>

        {showGenerate && (
          <Tooltip title={generateLabel}>
            <span>
              <Button
                variant="outlined"
                size="small"
                startIcon={generatingFile === activePath ? <CircularProgress size={14} /> : <Sparkles size={16} />}
                // Disable while ANY generation (this or another file) or a chat
                // turn is running — all three write the one shared draft.
                disabled={generatingFile !== null || chatTurnInFlight}
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
            <Button
              variant="contained"
              size="small"
              startIcon={publishing ? <CircularProgress size={14} color="inherit" /> : <Rocket size={16} />}
              disabled={publishing || Object.keys(explorerFiles).length === 0}
              onClick={handlePublish}
            >
              {publishing ? 'Publishing...' : 'Publish'}
            </Button>
          </>
        )}
      </Box>

      {(streamError || publishError) && (
        <Box sx={{ px: 3, py: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
          {streamError && <Typography variant="body2" color="error">{streamError}</Typography>}
          {publishError && <Typography variant="body2" color="error">{publishError}</Typography>}
        </Box>
      )}

      <Box sx={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <Explorer
            files={explorerFiles}
            activePath={activePath}
            onActivePathChange={setActivePath}
            onFileChange={(name: string, md: string) => {
              patchDraftFile(key, toFull(name), md);
            }}
            onAddFile={handleAddFile}
            addFileMenu={{ items: addFileMenuItems }}
            onDelete={handleDelete}
            onRename={handleRename}
            getFileLabel={getFileLabel}
            getFileSortKey={getFileSortKey}
            pendingPaths={pendingPaths}
            editorProps={{
              readOnly:
                viewingHistorical ||
                streamingMain ||
                generatingFile === activePath ||
                chatTurnInFlight,
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
