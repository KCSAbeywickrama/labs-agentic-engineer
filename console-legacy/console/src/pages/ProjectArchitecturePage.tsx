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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  PageContent,
  Stack,
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
import { api } from '../services/api';
import type { ArtifactVersion, Design, DesignComponent } from '../services/api';
import { newConversationId, runTurn } from '../services/api/turns';
import type { TurnFailure } from '../services/api/turns';
import { readTree } from '../services/api/files';
import {
  clearSpecDraft,
  deleteDraftFile,
  getSpecDraft,
  hasDraftChanges,
  patchDraftFile,
  publishDraft,
  PUBLISH_CONFLICT_MESSAGE,
  setDraftFiles,
  subscribeSpecDraft,
  syncBase,
} from '../services/specDraftSession';
import type { SpecDraftKey, SpecDraftState } from '../services/specDraftSession';
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

/** Shown when a generate turn hits the output-token limit; partial content kept. */
const TRUNCATED_MESSAGE =
  'Generation was cut off at the length limit. The partial result was kept — refine or regenerate to complete it.';

// The design tree lives under `specs/design/` in the repo. The Files API and
// the draft session speak FULL `specs/…` path keys; the design bundle and the
// Explorer speak paths RELATIVE to `specs/design/` (e.g. `design.md`,
// `components/x/design.json`). This one pair of helpers bridges the two spaces.
const DESIGN_PREFIX = 'specs/design/';
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
// derived paths. Used after a generate fold AND before a manual-edit Publish, so a
// hand-edited `design.json`/`.dsl` source never commits alongside a stale view.
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

// A pre-stream turn failure → an actionable banner message.
function messageForTurnFailure(failure: TurnFailure): string {
  switch (failure.code) {
    case 'requirements_not_approved':
      return 'Approve the requirements first — design generation needs a saved (tagged) requirements version.';
    case 'missing_org_key':
      return 'No Anthropic API key is configured for this organization. Add one under the org Anthropic settings, then try again.';
    case 'turn_in_progress':
      return 'A generation is already running for this design. Wait for it to finish, then try again.';
    default:
      // stream_error / upstream / anything else — surface the server's text.
      return failure.message || 'Design generation failed.';
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProjectArchitecturePage() {
  const navigate = useNavigate();
  const { orgId, projectId } = useParams();
  const routeOrgId = orgId ?? 'default';

  // The FE-owned working copy (draft + folds + manual edits) lives in the shared
  // spec-draft session, keyed by org/project/kind. It is the single source of
  // truth for the file tree/editor; committed truth (GitHub HEAD) is the base.
  const key = useMemo<SpecDraftKey>(
    () => ({ orgId: routeOrgId, projectId: projectId ?? '', kind: 'design' }),
    [routeOrgId, projectId],
  );
  const [session, setSession] = useState<SpecDraftState>(() => getSpecDraft(key));
  useEffect(() => {
    setSession(getSpecDraft(key));
    return subscribeSpecDraft(key, () => setSession(getSpecDraft(key)));
  }, [key]);
  const draft = session.draft;

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

  // Transient live-fold preview populated from the turn stream while
  // `generating` (full-path keys); the file tree shows a spinner on every path
  // touched so far. Both reset on finish; the committed draft is only replaced
  // once the turn succeeds.
  const [livePreview, setLivePreview] = useState<Record<string, string> | null>(null);
  const [pendingArtifacts, setPendingArtifacts] = useState<Set<string>>(() => new Set());

  const editorRef = useRef<ExplorerRef>(null);
  // Live-stream diagram projection memory (reset at each Generate).
  const liveDesignRef = useRef(createLiveDesignState());

  // Refresh only the bundle-derived projection (cell-diagram components,
  // versions, unsaved flag). The draft/base are never touched here.
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

  // Initial load: seed the draft base from the Files API at HEAD, and project
  // the cell diagram / versions from the design bundle.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      if (projectId) {
        try {
          const tree = await readTree(projectId, DESIGN_PREFIX);
          if (!cancelled) syncBase(key, tree);
        } catch {
          // No design directory yet (fresh project) — start from an empty base.
          if (!cancelled) syncBase(key, { files: {}, shas: {} });
        }
        await refreshBundle();
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, key, refreshBundle]);

  // Manual edit → draft patch (no network; committed only on Publish).
  const handleFileChange = useCallback(
    (rel: string, content: string) => {
      if (viewingHistorical || generating) return;
      patchDraftFile(key, toFullPath(rel), content);
    },
    [key, viewingHistorical, generating],
  );

  const handleDelete = useCallback(
    (rel: string) => {
      if (viewingHistorical || generating) return;
      // Refuse the root design.md.
      if (designDocumentTypeForPath(rel)?.protected) return;
      const compName = componentNameFromPath(rel);
      if (compName && COMPONENT_ROOT_RE.test(rel)) {
        // Deleting a component's design doc retires the whole component: drop
        // every draft path under components/<name>/.
        const prefix = `${DESIGN_PREFIX}components/${compName}/`;
        for (const full of Object.keys(getSpecDraft(key).draft)) {
          if (full.startsWith(prefix)) deleteDraftFile(key, full);
        }
      } else {
        deleteDraftFile(key, toFullPath(rel));
      }
      if (activePath === rel) setActivePath(CELL_DIAGRAM_VIEW_ID);
    },
    [key, viewingHistorical, generating, activePath],
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
    setPendingArtifacts(new Set());
    // Fresh per-generation projection memory (last-good design.json contents +
    // last stable diagram) — see liveDesignOverlay.ts.
    liveDesignRef.current = createLiveDesignState();
    // Seed the live preview with the current draft so the tree/editor stay put
    // until the first folded snapshot arrives. Pull the user onto the cell
    // diagram so the design lands in front of them.
    setLivePreview({ ...getSpecDraft(key).draft });
    setActivePath(CELL_DIAGRAM_VIEW_ID);

    const conversationId = newConversationId();
    try {
      const result = await runTurn(
        projectId,
        conversationId,
        {
          useCase: 'design-generate',
          instruction:
            'Generate the system design and component designs from the approved requirements.',
          // The BFF injects the approved requirements bundle server-side; we
          // only send the current design draft (derived artifacts are stripped
          // inside runTurn).
          files: getSpecDraft(key).draft,
        },
        {
          onSnapshot: (files) => setLivePreview(files),
          onBusyPaths: (paths) => {
            const rel = new Set<string>();
            for (const p of paths) rel.add(toRelPath(p));
            setPendingArtifacts(rel);
          },
        },
      );

      if (result.ok) {
        // Fold succeeded → recompute derived views over the agent-authored
        // files and adopt the merged snapshot as the new draft, pruning any
        // stale derived paths.
        setDraftFiles(key, withDerivedArtifacts(projectId, result.files));
        await refreshBundle();
        if (result.truncated) setPublishError(TRUNCATED_MESSAGE);
      } else {
        setPublishError(messageForTurnFailure(result));
      }
    } finally {
      setGenerating(false);
      setLivePreview(null);
      setPendingArtifacts(new Set());
    }
  }, [projectId, generating, key, refreshBundle]);

  const handlePublish = useCallback(async () => {
    if (!projectId || publishing) return;
    setPublishing(true);
    setPublishError(null);
    try {
      // Recompute derived views first: a hand-edited design.json/.dsl source must
      // commit with fresh `*.excalidraw` / `cell-diagram.gen.json`, not the stale
      // ones from the last generate.
      setDraftFiles(key, withDerivedArtifacts(projectId, getSpecDraft(key).draft));

      // 1. Commit the draft delta to `main` (atomic; all-or-nothing).
      let outcome;
      try {
        outcome = await publishDraft(projectId, key, () => readTree(projectId, DESIGN_PREFIX));
      } catch (err) {
        // 400 path/size, 404 project, 5xx — surface the server message.
        setPublishError(
          err instanceof Error && err.message ? err.message : 'Failed to apply design changes.',
        );
        return;
      }
      if (outcome.status === 'conflict') {
        // 409 — a stale baseSha; nothing was applied. The draft was re-based
        // onto HEAD (keeps your edits) so a re-publish overwrites; no merge UI.
        setPublishError(PUBLISH_CONFLICT_MESSAGE);
        return;
      }

      // 2. Cut the design tag (hard semantic validation happens here).
      try {
        await api.saveAndProceedDesign(projectId);
      } catch (err) {
        // A 422 arrives with joined validation errors already in `.message`.
        setPublishError(
          err instanceof Error && err.message ? err.message : 'Failed to save the design.',
        );
        await refreshBundle();
        return;
      }
      navigate(projectTasksPath(routeOrgId, projectId));
    } finally {
      setPublishing(false);
    }
  }, [projectId, publishing, key, routeOrgId, navigate, refreshBundle]);

  const handleDiscard = useCallback(async () => {
    if (!projectId) return;
    await api.discardDesignChanges(projectId);
    clearSpecDraft(key);
    try {
      syncBase(key, await readTree(projectId, DESIGN_PREFIX));
    } catch {
      syncBase(key, { files: {}, shas: {} });
    }
    await refreshBundle();
  }, [projectId, key, refreshBundle]);

  // The files to display, keyed relative to `specs/design/`. Historical view
  // shows the version snapshot (already rel-keyed); otherwise the live fold
  // preview while generating, else the committed draft.
  const displayFilesRel = useMemo<Record<string, string>>(() => {
    if (viewingHistorical && historical) return historical.files;
    const source = generating && livePreview ? livePreview : draft;
    const out: Record<string, string> = {};
    for (const [full, content] of Object.entries(source)) out[toRelPath(full)] = content;
    return out;
  }, [viewingHistorical, historical, generating, livePreview, draft]);

  // The cell diagram reads projected components: the historical snapshot when
  // viewing history, otherwise the current bundle projection. The fallback must
  // be identity-STABLE: `?? []` would mint a fresh array per render, defeating
  // CellDiagramView's memo — and the diagram lib fully redraws (zoom-to-fit
  // included) on every re-render, so a broken memo means a visible diagram
  // refresh on every stream snapshot.
  const effectiveComponents =
    viewingHistorical && historical ? historical.components : design?.components ?? NO_COMPONENTS;

  // Project the cell diagram from the SAME files the tree shows (historical
  // snapshot, live stream preview, or the working draft) through the exact
  // pipeline that derives the committed `cell-diagram.gen.json`. Without this the
  // diagram would render only `design.components` (the committed-HEAD bundle),
  // so it stayed empty all through a generate and until Publish — the design
  // page's "nothing streaming" symptom.
  //
  // The strict projection is a pure function of the component design.json
  // files (buildProjectDesign lists components off them, and
  // toCellDiagramProject consumes only fields sourced from them), so the memo
  // below keys on that subset with identity stabilised across re-renders:
  // a keystroke in design.md or openapi.yaml mints a new draft object but no
  // new design.json string, and must NOT re-project (a new project object
  // means a full diagram re-layout).
  const strictDesignSourceRef = useRef<Record<string, string> | null>(null);
  const strictDesignSource = useMemo<Record<string, string>>(() => {
    const sourceFull: Record<string, string> =
      viewingHistorical && historical
        ? Object.fromEntries(
            Object.entries(historical.files).map(([rel, c]) => [toFullPath(rel), c]),
          )
        : draft;
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
  }, [viewingHistorical, historical, draft]);

  // While a generate STREAMS, the snapshot contains one design.json that is
  // mid-write, so the strict projection is wrong for it: it degraded streaming
  // components to default boxes and re-projected a brand-new object per
  // snapshot (a full diagram re-layout up to ~12×/s — the flicker). The live
  // branch therefore goes through `projectLiveDesign` (tolerant partial-JSON
  // repair + last-good + identity-stable output); the draft/historical
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

  // Publish/Discard are enabled while the draft diverges from HEAD, or while the
  // bundle still reports uncommitted (untagged) work to tag.
  const dirty = hasDraftChanges(key) || hasUnsavedChanges;

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
            <Button
              variant="contained"
              size="small"
              startIcon={publishing ? <CircularProgress size={14} color="inherit" /> : <Rocket size={16} />}
              onClick={handlePublish}
              disabled={!dirty || publishing}
            >
              {publishing ? 'Publishing…' : 'Publish'}
            </Button>
          </>
        )}
      </Box>

      {publishError && (
        <Box sx={{ px: 3, py: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
          <Typography variant="body2" color="error">
            {publishError}
          </Typography>
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
