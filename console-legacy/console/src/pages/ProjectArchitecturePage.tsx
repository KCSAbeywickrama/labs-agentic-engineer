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
 * Architecture (design) page — committed-truth model (shared-volume-clone
 * D13–D20). The server tree at HEAD is the complete truth; design generation
 * runs server-side against HEAD, gated on an approved requirements version
 * (D19 — unapproved requirement edits only warn). The fold here is a
 * display-only live preview; on `turn-committed` the page refetches. Unsaved
 * editor buffers flush through one `files/apply` commit at Publish; deletes
 * of committed files are one commit each.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { Package, Rocket, Sparkles } from '@wso2/oxygen-ui-icons-react';
import { Explorer, type CustomView, type ExplorerRef } from '@aep/explorer';
import {
  CELL_DIAGRAM_VIEW_ID,
  CellDiagramView,
  type CellDiagramViewProps,
} from '@aep/cell-diagram-view';
import { COMPONENT_DESIGN_JSON_RE } from '@aep/agent-stream';
import { buildProjectDesign, toCellDiagramProject } from '@aep/design-projection';
import { createLiveDesignState, projectLiveDesign } from '../lib/liveDesignOverlay';
import { MdEditor } from '@aep/md-editor';
import { OpenApiView } from '@aep/openapi-view';
import { api, ApiError } from '../services/api';
import type { ArtifactVersion, Design, DesignComponent } from '../services/api';
import {
  attachTurnStream,
  getActiveTurn,
  newConversationId,
  startTurn,
  turnErrorMessage,
} from '../services/api/turns';
import { applyFiles, readTree, type ApplyDelete, type ApplyWrite } from '../services/api/files';
import { computeDerivedArtifacts, derivedPathsFor } from '../lib/derivedArtifacts';
import { projectTasksPath } from '../lib/paths';
import VersionSelector from '../components/VersionSelector';
import LineageLabel from '../components/LineageLabel';
import {
  componentNameFromPath,
  designDocumentTypeForPath,
} from '../lib/designDocumentTypes';

const DESIGN_ROOT_FILE = 'design.md';

// Identity-stable empty fallback for the cell diagram's components prop — see
// the effectiveComponents note below.
const NO_COMPONENTS: DesignComponent[] = [];

// The design tree lives under `specs/design/` in the repo. The Files API
// speaks FULL `specs/…` path keys; the design bundle and the Explorer speak
// paths RELATIVE to `specs/design/` (e.g. `design.md`,
// `components/x/design.json`). This one pair of helpers bridges the two spaces.
const DESIGN_PREFIX = 'specs/design/';
// The turn-seed read spans the whole spec tree (fold parity with the agents
// service's snapshot view).
const SPECS_PREFIX = 'specs/';
function toFullPath(rel: string): string {
  return rel.startsWith(DESIGN_PREFIX) ? rel : DESIGN_PREFIX + rel;
}
function toRelPath(full: string): string {
  return full.startsWith(DESIGN_PREFIX) ? full.slice(DESIGN_PREFIX.length) : full;
}

// Derived artifacts (`*.excalidraw` scenes, `*.gen.json` projections) are
// machine-generated views committed alongside their sources — they belong to
// the cell diagram / renderers, not the hand-editable file tree.
function isDerivedRel(rel: string): boolean {
  return rel.endsWith('.excalidraw') || rel.endsWith('.gen.json');
}

// Recompute the derived views (`*.excalidraw`, `cell-diagram.gen.json`) over the
// agent-authored sources in `files` and return the merged set, pruning any stale
// derived paths. Used before a manual-edit Publish, so a hand-edited
// `design.json`/`.dsl` source never commits alongside a stale view.
// Suffix-keyed, so it is path-space agnostic (full `specs/…` keys here).
function withDerivedArtifacts(
  projectName: string,
  files: Record<string, string>,
): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (!isDerivedRel(path)) sources[path] = content;
  }
  const derived = computeDerivedArtifacts(projectName, sources);
  const valid = derivedPathsFor(sources);
  const out: Record<string, string> = { ...sources };
  for (const [path, content] of Object.entries(derived.files)) {
    if (valid.has(path)) out[path] = content;
  }
  return out;
}

// Tree-display tweaks for the design Explorer. The on-disk layout is
// `specs/design/components/<name>/…` but a "Components" folder row in the
// sidebar adds nothing the user cares about, so we collapse it. Each component
// then renders at top level with a package icon.
const ARCHITECTURE_TRANSPARENT_FOLDERS = new Set(['components']);
function getArchitectureFolderIcon(folderPath: string) {
  if (folderPath.startsWith('components/')) return <Package size={16} style={{ flexShrink: 0 }} />;
  return undefined;
}

// Route the per-component `openapi.yaml` files to the dedicated OpenAPI
// viewer. Every other path (component design, custom views, etc.) returns
// undefined so Explorer's default editor chain handles them.
const OPENAPI_PATH_RE = /^components\/[^/]+\/openapi\.ya?ml$/;
function renderOpenApiFile(path: string, content: string): React.ReactNode | undefined {
  if (!OPENAPI_PATH_RE.test(path)) return undefined;
  return <OpenApiView spec={content} />;
}
// User-facing label override: components/<x>/openapi.yaml reads as "API Spec"
// in the tree. The on-disk path stays unchanged.
function getArchitectureFileLabel(path: string): string | undefined {
  if (OPENAPI_PATH_RE.test(path)) return 'API Spec';
  return undefined;
}

// A component's primary design doc; deleting it retires the whole component.
const COMPONENT_ROOT_RE = /^components\/[^/]+\/design\.(md|json)$/;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProjectArchitecturePage() {
  const navigate = useNavigate();
  const { orgId, projectId } = useParams();
  const routeOrgId = orgId ?? 'default';

  const [loading, setLoading] = useState(true);
  const [activePath, setActivePath] = useState<string | null>(CELL_DIAGRAM_VIEW_ID);
  const [design, setDesign] = useState<Design | null>(null);
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [viewingHistorical, setViewingHistorical] = useState(false);
  // Read-only snapshot of a historical version (bundle files are rel-keyed).
  const [historical, setHistorical] = useState<
    { files: Record<string, string>; components: DesignComponent[] } | null
  >(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  // D19: HEAD's requirements differ from the latest approved tag — warn, but
  // let generation proceed ("generate against what I see").
  const [reqUnapproved, setReqUnapproved] = useState(false);
  const [viewerNotice, setViewerNotice] = useState<string | null>(null);
  // A files/apply CAS conflict (409): the conflicting paths + reload affordance.
  const [applyConflict, setApplyConflict] = useState<string[] | null>(null);

  // -- Server truth (committed HEAD, full-path keys) + editor buffers ---------
  const [serverFiles, setServerFiles] = useState<Record<string, string>>({});
  const serverFilesRef = useRef<Record<string, string>>({});
  const serverShasRef = useRef<Record<string, string>>({});
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

  // Transient live-fold preview populated from the turn stream while
  // `generating` (full-path keys); the file tree shows a spinner on every path
  // touched so far. Both reset on finish; the page refetches HEAD once the
  // backend commits the turn.
  const [livePreview, setLivePreview] = useState<Record<string, string> | null>(null);
  const [pendingArtifacts, setPendingArtifacts] = useState<Set<string>>(() => new Set());

  const editorRef = useRef<ExplorerRef>(null);
  // Live-stream diagram projection memory (reset at each Generate).
  const liveDesignRef = useRef(createLiveDesignState());

  const refreshTree = useCallback(async () => {
    if (!projectId) return;
    try {
      const tree = await readTree(projectId, DESIGN_PREFIX);
      serverFilesRef.current = tree.files;
      serverShasRef.current = tree.shas;
      setServerFiles(tree.files);
    } catch {
      // No design directory yet (fresh project) — an empty tree.
      serverFilesRef.current = {};
      serverShasRef.current = {};
      setServerFiles({});
    }
    // Buffers that now match the committed content are no longer edits.
    updateBuffers((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [p, c] of Object.entries(prev)) {
        if (serverFilesRef.current[p] === c) {
          delete next[p];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [projectId, updateBuffers]);

  // Refresh only the bundle-derived projection (cell-diagram components,
  // versions, unsaved flag).
  const refreshBundle = useCallback(async () => {
    if (!projectId) return;
    const bundle = await api.getDesignBundle(projectId);
    if (!bundle) {
      setDesign(null);
      setHasUnsavedChanges(false);
      return;
    }
    setDesign(bundle.design);
    setHasUnsavedChanges(bundle.design?.hasUnsavedChanges ?? false);
    setCurrentVersion(bundle.design?.version ?? 0);
    if (bundle.design?.versions) setVersions(bundle.design.versions);
  }, [projectId]);

  // D19: does HEAD carry requirement edits newer than the latest approved tag?
  const refreshReqApproval = useCallback(async () => {
    if (!projectId) return;
    const req = await api.getRequirements(projectId);
    setReqUnapproved(req?.hasUnsavedChanges ?? false);
  }, [projectId]);

  /** Attach one design turn's stream and resolve it to a refetch or an error. */
  const attachDesignTurn = useCallback(
    async (turnId: string, signal?: AbortSignal) => {
      if (!projectId) return;
      const seed = await readTree(projectId, SPECS_PREFIX)
        .then((t) => t.files)
        .catch(() => ({}) as Record<string, string>);
      const result = await attachTurnStream(projectId, turnId, {
        from: 0,
        seed,
        signal,
        handlers: {
          // Merge over the initial preview: the fold's seed is the FILTERED
          // turn snapshot (no derived views / openapi.yaml), so replacing
          // wholesale would blank committed rows mid-stream. Deletions
          // reconcile at the post-commit refetch.
          onSnapshot: (files) => setLivePreview((prev) => ({ ...(prev ?? {}), ...files })),
          onBusyPaths: (paths) => {
            const rel = new Set<string>();
            for (const p of paths) {
              if (p.startsWith(DESIGN_PREFIX)) rel.add(toRelPath(p));
            }
            setPendingArtifacts(rel);
          },
        },
      });
      if (signal?.aborted) return;
      if (result.ok) {
        await Promise.all([refreshTree(), refreshBundle(), refreshReqApproval()]);
      } else {
        // base-moved carries the conflicting paths in its message (D15/D20).
        setPublishError(turnErrorMessage(result));
      }
    },
    [projectId, refreshTree, refreshBundle, refreshReqApproval],
  );

  // Initial load + refresh-mid-generation recovery (D16).
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      if (projectId) {
        await Promise.all([refreshTree(), refreshBundle(), refreshReqApproval()]);
      }
      if (controller.signal.aborted) return;
      setLoading(false);
      if (!projectId) return;
      const active = await getActiveTurn(projectId).catch(() => null);
      if (controller.signal.aborted) return;
      if (active && active.status === 'running' && active.useCase === 'design-generate') {
        setGenerating(true);
        setViewerNotice('A design generation is in progress — showing it live.');
        liveDesignRef.current = createLiveDesignState();
        setLivePreview({ ...serverFilesRef.current, ...buffersRef.current });
        setActivePath(CELL_DIAGRAM_VIEW_ID);
        try {
          await attachDesignTurn(active.turnId, controller.signal);
        } finally {
          if (!controller.signal.aborted) {
            setGenerating(false);
            setLivePreview(null);
            setPendingArtifacts(new Set());
            setViewerNotice(null);
          }
        }
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Manual edit → transient buffer (committed by the Publish flush).
  const handleFileChange = useCallback(
    (rel: string, content: string) => {
      if (viewingHistorical || generating) return;
      const full = toFullPath(rel);
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
    [viewingHistorical, generating, updateBuffers],
  );

  const handleDelete = useCallback(
    (rel: string) => {
      if (!projectId || viewingHistorical || generating) return;
      // Refuse the root design.md.
      if (designDocumentTypeForPath(rel)?.protected) return;
      const compName = componentNameFromPath(rel);
      const targets: string[] = [];
      if (compName && COMPONENT_ROOT_RE.test(rel)) {
        // Deleting a component's design doc retires the whole component: drop
        // every path under components/<name>/.
        const prefix = `${DESIGN_PREFIX}components/${compName}/`;
        for (const full of Object.keys({ ...serverFilesRef.current, ...buffersRef.current })) {
          if (full.startsWith(prefix)) targets.push(full);
        }
      } else {
        targets.push(toFullPath(rel));
      }
      updateBuffers((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const p of targets) {
          if (p in next) {
            delete next[p];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      if (activePath === rel) setActivePath(CELL_DIAGRAM_VIEW_ID);
      const committed = targets.filter((p) => p in serverFilesRef.current);
      if (committed.length === 0) return;
      // Committed truth: a delete is one commit, immediately.
      void (async () => {
        try {
          const res = await applyFiles(projectId, {
            deletes: committed.map((p) => ({ path: p, baseSha: serverShasRef.current[p] })),
            message: `Delete ${rel}`,
          });
          if (!res.ok) setApplyConflict(res.conflicts.map((c) => c.path));
          await Promise.all([refreshTree(), refreshBundle()]);
        } catch (err) {
          setPublishError(
            err instanceof ApiError && err.message ? err.message : 'Failed to delete the file.',
          );
        }
      })();
    },
    [projectId, viewingHistorical, generating, activePath, updateBuffers, refreshTree, refreshBundle],
  );

  const handleVersionSelect = useCallback(
    async (tag: string | null) => {
      if (!projectId) return;
      if (!tag) {
        setViewingHistorical(false);
        setHistorical(null);
        await refreshBundle();
        return;
      }
      const bundle = await api.getDesignBundleAtVersion(projectId, tag);
      if (bundle) {
        setHistorical({ files: bundle.files, components: bundle.design?.components ?? [] });
        setViewingHistorical(true);
        if (activePath !== CELL_DIAGRAM_VIEW_ID && !(activePath && bundle.files[activePath])) {
          setActivePath(CELL_DIAGRAM_VIEW_ID);
        }
      }
    },
    [projectId, activePath, refreshBundle],
  );

  const handleGenerate = useCallback(async () => {
    if (!projectId || generating) return;
    setGenerating(true);
    setPublishError(null);
    setApplyConflict(null);
    setPendingArtifacts(new Set());
    // Fresh per-generation projection memory (last-good design.json contents +
    // last stable diagram) — see liveDesignOverlay.ts.
    liveDesignRef.current = createLiveDesignState();
    // Seed the live preview with the current tree so the tree/editor stay put
    // until the first folded snapshot arrives. Pull the user onto the cell
    // diagram so the design lands in front of them.
    setLivePreview({ ...serverFilesRef.current, ...buffersRef.current });
    setActivePath(CELL_DIAGRAM_VIEW_ID);

    try {
      const start = await startTurn(projectId, newConversationId(), {
        useCase: 'design-generate',
        instruction:
          'Generate the system design and component designs from the approved requirements.',
      });
      if (!start.ok) {
        // 409 turn_in_progress → attach to the running generation as a viewer
        // (D18); every other failure (incl. the D19 approval gate) is a banner.
        if (start.code === 'turn_in_progress' && start.activeTurnId) {
          setViewerNotice('A generation is already in progress — viewing it live.');
          await attachDesignTurn(start.activeTurnId);
        } else {
          setPublishError(turnErrorMessage(start));
        }
        return;
      }
      await attachDesignTurn(start.turnId);
    } finally {
      setGenerating(false);
      setLivePreview(null);
      setPendingArtifacts(new Set());
      setViewerNotice(null);
    }
  }, [projectId, generating, attachDesignTurn]);

  const handlePublish = useCallback(async () => {
    if (!projectId || publishing) return;
    setPublishing(true);
    setPublishError(null);
    setApplyConflict(null);
    try {
      // 1. Flush the editor buffers as ONE commit, with the derived views
      // (`*.excalidraw`, `cell-diagram.gen.json`) recomputed so a hand-edited
      // design.json/.dsl source never commits alongside a stale view.
      const server = serverFilesRef.current;
      const shas = serverShasRef.current;
      const finalTree = withDerivedArtifacts(projectId, { ...server, ...buffersRef.current });
      const writes: ApplyWrite[] = [];
      for (const [p, c] of Object.entries(finalTree)) {
        if (!p.startsWith(DESIGN_PREFIX)) continue;
        if (server[p] === c) continue;
        writes.push(shas[p] ? { path: p, content: c, baseSha: shas[p] } : { path: p, content: c });
      }
      const deletes: ApplyDelete[] = [];
      for (const p of Object.keys(server)) {
        if (!isDerivedRel(p) || p in finalTree) continue;
        deletes.push({ path: p, baseSha: shas[p] });
      }

      let commitSha: string | undefined;
      if (writes.length > 0 || deletes.length > 0) {
        let outcome;
        try {
          outcome = await applyFiles(projectId, { writes, deletes, message: 'Update design' });
        } catch (err) {
          // 400 path/size, 404 project, 5xx — surface the server message.
          setPublishError(
            err instanceof Error && err.message ? err.message : 'Failed to apply design changes.',
          );
          return;
        }
        if (!outcome.ok) {
          // 409 — a stale baseSha; nothing was applied (see the banner).
          setApplyConflict(outcome.conflicts.map((c) => c.path));
          return;
        }
        commitSha = outcome.commitSha;
      }

      // 2. Cut the design tag (hard semantic validation happens here). The
      // {commitSha} pin is optional now — the backend reads its own mirror —
      // but pass the fresh sha when the flush just minted one.
      try {
        await api.saveAndProceedDesign(projectId, commitSha);
      } catch (err) {
        // A 422 arrives with joined validation errors already in `.message`.
        setPublishError(
          err instanceof Error && err.message ? err.message : 'Failed to save the design.',
        );
        await refreshBundle();
        return;
      }
      updateBuffers(() => ({}));
      navigate(projectTasksPath(routeOrgId, projectId));
    } finally {
      setPublishing(false);
    }
  }, [projectId, publishing, routeOrgId, navigate, refreshBundle, updateBuffers]);

  const handleDiscard = useCallback(async () => {
    if (!projectId) return;
    await api.discardDesignChanges(projectId);
    updateBuffers(() => ({}));
    await Promise.all([refreshTree(), refreshBundle()]);
  }, [projectId, updateBuffers, refreshTree, refreshBundle]);

  /** The apply-conflict "Reload" affordance: adopt server truth, drop buffers. */
  const reloadFromServer = useCallback(async () => {
    updateBuffers(() => ({}));
    setApplyConflict(null);
    await Promise.all([refreshTree(), refreshBundle()]);
  }, [updateBuffers, refreshTree, refreshBundle]);

  // The committed tree + unsaved buffers — what the editors show outside a
  // live stream.
  const merged = useMemo(() => ({ ...serverFiles, ...buffers }), [serverFiles, buffers]);

  // The files to display, keyed relative to `specs/design/`. Historical view
  // shows the version snapshot (already rel-keyed); otherwise the live fold
  // preview while generating, else committed HEAD + buffers. The live fold
  // spans the whole spec tree — only the design subtree is shown here.
  const displayFilesRel = useMemo<Record<string, string>>(() => {
    if (viewingHistorical && historical) return historical.files;
    const source = generating && livePreview ? livePreview : merged;
    const out: Record<string, string> = {};
    for (const [full, content] of Object.entries(source)) {
      if (!full.startsWith(DESIGN_PREFIX)) continue;
      out[toRelPath(full)] = content;
    }
    return out;
  }, [viewingHistorical, historical, generating, livePreview, merged]);

  // The cell diagram reads projected components: the historical snapshot when
  // viewing history, otherwise the current bundle projection. The fallback must
  // be identity-STABLE: `?? []` would mint a fresh array per render, defeating
  // CellDiagramView's memo — and the diagram lib fully redraws (zoom-to-fit
  // included) on every re-render, so a broken memo means a visible diagram
  // refresh on every stream snapshot.
  const effectiveComponents =
    viewingHistorical && historical ? historical.components : design?.components ?? NO_COMPONENTS;

  // Project the cell diagram from the SAME files the tree shows (historical
  // snapshot, live stream preview, or HEAD + buffers) through the exact
  // pipeline that derives the committed `cell-diagram.gen.json`. Without this the
  // diagram would render only `design.components` (the committed-HEAD bundle),
  // so it stayed empty all through a generate and until Publish — the design
  // page's "nothing streaming" symptom.
  //
  // The strict projection is a pure function of the component design.json
  // files (buildProjectDesign lists components off them, and
  // toCellDiagramProject consumes only fields sourced from them), so the memo
  // below keys on that subset with identity stabilised across re-renders:
  // a keystroke in design.md or openapi.yaml mints a new merged object but no
  // new design.json string, and must NOT re-project (a new project object
  // means a full diagram re-layout).
  const strictDesignSourceRef = useRef<Record<string, string> | null>(null);
  const strictDesignSource = useMemo<Record<string, string>>(() => {
    const sourceFull: Record<string, string> =
      viewingHistorical && historical
        ? Object.fromEntries(
            Object.entries(historical.files).map(([rel, c]) => [toFullPath(rel), c]),
          )
        : merged;
    const subset: Record<string, string> = {};
    for (const [path, content] of Object.entries(sourceFull)) {
      if (COMPONENT_DESIGN_JSON_RE.test(path)) subset[path] = content;
    }
    const prev = strictDesignSourceRef.current;
    if (prev) {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(subset);
      if (
        prevKeys.length === nextKeys.length &&
        nextKeys.every((p) => prev[p] === subset[p])
      ) {
        return prev;
      }
    }
    strictDesignSourceRef.current = subset;
    return subset;
  }, [viewingHistorical, historical, merged]);

  // While a generate STREAMS, the snapshot contains one design.json that is
  // mid-write, so the strict projection is wrong for it: it degraded streaming
  // components to default boxes and re-projected a brand-new object per
  // snapshot (a full diagram re-layout up to ~12×/s — the flicker). The live
  // branch therefore goes through `projectLiveDesign` (tolerant partial-JSON
  // repair + last-good + identity-stable output); the committed/historical
  // branches keep the strict truth-telling projection.
  const liveProject = useMemo<NonNullable<CellDiagramViewProps['project']> | null>(() => {
    if (generating && livePreview) {
      return projectLiveDesign(
        projectId ?? '',
        livePreview,
        liveDesignRef.current,
      ) as unknown as NonNullable<CellDiagramViewProps['project']> | null;
    }
    try {
      const proj = toCellDiagramProject(buildProjectDesign(projectId ?? '', strictDesignSource));
      // `CellDiagramProject` (design-projection) is a structural mirror of the
      // @wso2/cell-diagram `Project`; the only divergence is `type: string` vs
      // the lib's `ComponentType` enum, which the diagram accepts.
      return proj.components.length > 0
        ? (proj as unknown as NonNullable<CellDiagramViewProps['project']>)
        : null;
    } catch {
      return null;
    }
  }, [generating, livePreview, strictDesignSource, projectId]);

  const designMdContent = displayFilesRel[DESIGN_ROOT_FILE] ?? '';
  const designReadOnly = viewingHistorical || generating;
  const handleDesignMdChange = useCallback(
    (md: string) => {
      handleFileChange(DESIGN_ROOT_FILE, md);
    },
    [handleFileChange],
  );

  // The "Component Design" view rolls the cell diagram and the top-level
  // architecture markdown into one page — the cell diagram on top, the
  // narrative on the bottom — so the user navigates once and sees the
  // whole system in context. The standalone `design.md` row is hidden
  // from the side tree below for the same reason.
  const customViews = useMemo<CustomView[]>(
    () => [
      {
        id: CELL_DIAGRAM_VIEW_ID,
        label: 'Component Design',
        // Single-scroll layout: the cell diagram is rendered as a fixed-height
        // "figure" at the top of the view, with the markdown editor flowing
        // beneath it in the same scroll context. The diagram reads as an
        // embedded picture — non-interactive in the markdown sense (you can't
        // edit it by typing), and it scrolls out of the way as the user reads
        // or edits the narrative below.
        content: (
          <Box
            sx={{
              height: '100%',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              bgcolor: 'background.paper',
            }}
          >
            {/* The diagram is sized to match the markdown content column
                (816px, centered) with a soft framed look so it reads as a
                figure inset inside the document — not as a top panel that
                happens to live above another panel. */}
            <Box
              aria-label="Architecture cell diagram"
              sx={{
                flexShrink: 0,
                pt: 4,
                pb: 2,
                px: 3,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
              }}
            >
              <Box sx={{ width: '100%', maxWidth: 816 }}>
                <Typography
                  variant="overline"
                  component="h3"
                  sx={{
                    m: 0,
                    mb: 1,
                    color: 'text.secondary',
                    letterSpacing: '0.08em',
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  Cell Diagram
                </Typography>
                <Box
                  sx={{
                    width: '100%',
                    height: 640,
                    display: 'flex',
                    borderRadius: 1.5,
                    border: 1,
                    borderColor: 'divider',
                    overflow: 'hidden',
                    position: 'relative',
                    // Clip the diagram's portal-mounted zoom controls so the
                    // figure reads as a picture, not a canvas surface.
                    '& button[aria-label^="Zoom"]': { display: 'none' },
                  }}
                >
                  <CellDiagramView
                    project={liveProject ?? undefined}
                    components={effectiveComponents}
                  />
                </Box>
              </Box>
            </Box>
            <Box sx={{ flexShrink: 0 }}>
              {/* Toolbar suppressed — the editor sits inside the same
                  document surface as the diagram above; a toolbar bar
                  would reintroduce the panel-on-panel feel. Inline
                  markdown still works (`**bold**`, `# heading`, …). */}
              <MdEditor
                value={designMdContent}
                onChange={handleDesignMdChange}
                readOnly={designReadOnly}
                showToolbar={false}
                placeholder="System architecture overview…"
              />
            </Box>
          </Box>
        ),
      },
    ],
    [effectiveComponents, liveProject, designMdContent, handleDesignMdChange, designReadOnly],
  );

  // Strip the root `design.md` (folded into the "Component Design" view above)
  // and the derived artifacts (machine-generated views) from the file list
  // passed to Explorer — the tree shows only hand-editable sources.
  const treeFiles = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [rel, content] of Object.entries(displayFilesRel)) {
      if (rel === DESIGN_ROOT_FILE) continue;
      if (isDerivedRel(rel)) continue;
      out[rel] = content;
    }
    return out;
  }, [displayFilesRel]);

  // Publish/Discard are enabled while unsaved buffers exist, or while the
  // bundle still reports uncommitted (untagged) work to tag.
  const bufferDirty = Object.entries(buffers).some(([p, c]) => serverFiles[p] !== c);
  const dirty = bufferDirty || hasUnsavedChanges;

  if (loading) {
    return (
      <PageContent>
        <Stack alignItems="center" sx={{ py: 8 }}>
          <CircularProgress />
        </Stack>
      </PageContent>
    );
  }

  return (
    <PageContent fullWidth noPadding sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          px: 3,
          py: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          bgcolor: 'background.paper',
          flexShrink: 0,
        }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" gap={1.5}>
            <Typography variant="h4">Architecture</Typography>
            <LineageLabel sourceSpec={design?.sourceSpec} />
            {versions.length > 0 && (
              <VersionSelector
                versions={versions}
                currentVersion={currentVersion}
                isHistorical={viewingHistorical}
                onVersionSelect={(v) => {
                  const tag = versions.find((x) => x.version === v)?.tagName ?? null;
                  void handleVersionSelect(tag);
                }}
                hasUnsavedChanges={dirty}
                onDiscard={handleDiscard}
              />
            )}
            {viewerNotice && (
              <Typography variant="caption" color="text.secondary" data-testid="viewer-notice">
                {viewerNotice}
              </Typography>
            )}
          </Stack>
        </Box>

        <Button
          variant="outlined"
          size="small"
          startIcon={generating ? <CircularProgress size={14} /> : <Sparkles size={16} />}
          onClick={handleGenerate}
          disabled={generating || viewingHistorical}
        >
          {generating ? 'Generating…' : design ? 'Regenerate' : 'Generate'}
        </Button>

        {!viewingHistorical && (
          <>
            <Divider orientation="vertical" flexItem />
            <Tooltip title={generating ? 'A generation is writing the design — publishing is disabled until it finishes.' : ''}>
              <span>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={publishing ? <CircularProgress size={14} color="inherit" /> : <Rocket size={16} />}
                  onClick={handlePublish}
                  disabled={!dirty || publishing || generating}
                >
                  {publishing ? 'Publishing…' : 'Publish'}
                </Button>
              </span>
            </Tooltip>
          </>
        )}
      </Box>

      {reqUnapproved && !viewingHistorical && (
        <Box sx={{ px: 3, py: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }} data-testid="unapproved-requirements-banner">
          <Typography variant="body2" color="warning.main">
            Generating against unapproved requirement changes — the requirements have edits newer
            than the latest approved version. Approve them on the Requirements page to keep the
            design lineage clean, or generate against what you see.
          </Typography>
        </Box>
      )}

      {(publishError || applyConflict) && (
        <Box sx={{ px: 3, py: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
          {publishError && (
            <Typography variant="body2" color="error">
              {publishError}
            </Typography>
          )}
          {applyConflict && (
            <Stack direction="row" alignItems="center" gap={1.5} data-testid="apply-conflict">
              <Typography variant="body2" color="error">
                {applyConflict.join(', ')} changed on the server since you loaded them. Reload to
                get the latest — your unsaved local edits will be discarded.
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
            files={treeFiles}
            customViews={customViews}
            pendingPaths={pendingArtifacts}
            // The `components/` directory is an organisational detail on disk;
            // in the tree we want each component to read as a top-level
            // entity, so hide the parent folder and promote its children up.
            transparentFolders={ARCHITECTURE_TRANSPARENT_FOLDERS}
            // Component folders (children of `components/`) display as the
            // unit that gets built and shipped, so give them a package icon.
            getFolderIcon={getArchitectureFolderIcon}
            // Heading-level outlines under each file in the side tree add
            // noise on this page — the cell diagram is the primary navigator.
            showHeadings={false}
            // Render `components/<x>/openapi.yaml` as a swagger-style docs
            // page instead of falling through to the markdown editor with
            // raw YAML. All other paths use the default editor chain.
            getFileRenderer={renderOpenApiFile}
            // …and display it in the tree as "API Spec" — the filename is
            // an implementation detail.
            getFileLabel={getArchitectureFileLabel}
            activePath={activePath}
            onActivePathChange={setActivePath}
            onFileChange={handleFileChange}
            // Manual file-add is intentionally omitted on the architecture
            // page — components live and die with the design regeneration
            // flow, not with hand-edited paths in the tree.
            onDelete={handleDelete}
            editorRef={editorRef}
            searchPlaceholder="Search files"
            editorProps={{
              readOnly: viewingHistorical || generating,
              placeholder: 'Edit the design…',
            }}
          />
        </Box>
      </Box>
    </PageContent>
  );
}
