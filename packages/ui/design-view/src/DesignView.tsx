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
import { Alert, Box, Button, Chip, Link, Stack, Typography } from "@wso2/oxygen-ui";
import { Lock } from "@wso2/oxygen-ui-icons-react";
import {
  parseComponentDesign,
  type ComponentDesign,
  type Dependency,
  type DependencyCandidate,
  type DesignConfigEntry,
} from "./parse.js";

// #252 Task 9: read-time resolution status for ONE dependency, keyed by name
// in DesignViewProps.dependencyStatus. `status`/`reason` are the two fields
// parse.ts deliberately never parses from the raw design.json (see its
// file-header comment) — this is their ONLY source. Kept as raw strings
// (not a closed union) so an unrecognized value still renders instead of
// widening this package's dependency on the server's exact enum.
export interface DependencyStatusInfo {
  /** "resolved" | "ambiguous" | "unresolved" | "blocked". */
  status?: string | undefined;
  /** "needs-spec" | "needs-input" | "not-found" | "access-required". */
  reason?: string | undefined;
}

const STATUS_COLOR: Record<string, "success" | "warning" | "error"> = {
  resolved: "success",
  ambiguous: "warning",
  unresolved: "error",
  blocked: "error",
};
const STATUS_LABEL: Record<string, string> = {
  resolved: "Resolved",
  ambiguous: "Ambiguous",
  unresolved: "Unresolved",
  blocked: "Blocked",
};
const REASON_LABEL: Record<string, string> = {
  "needs-spec": "needs a spec",
  "needs-input": "needs input",
  "not-found": "not found",
  "access-required": "access required",
};

// Solid background per component type / dependency kind. Text color is
// computed for contrast (getContrastText), so labels stay readable in both
// themes — the same approach as the OpenAPI viewer's method badges.
const TYPE_COLOR: Record<string, string> = {
  service: "#1976d2",
  "web-application": "#7b1fa2",
  "scheduled-task": "#ed6c02",
  worker: "#2e7d32",
};
const KIND_COLOR: Record<string, string> = {
  component: "#1976d2",
  "org-service": "#7b1fa2",
  external: "#ed6c02",
  "platform-resource": "#0288d1",
};
const KIND_LABEL: Record<string, string> = {
  component: "component",
  "org-service": "org service",
  external: "external",
  "platform-resource": "platform",
};
const FALLBACK = "#616161";

function SolidBadge({ label, color }: { label: string; color: string }) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        px: 1,
        py: 0.5,
        borderRadius: 1,
        flexShrink: 0,
        fontFamily: "monospace",
        fontSize: "0.6875rem",
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        bgcolor: color,
        color: theme.palette.getContrastText(color),
      })}
    >
      {label}
    </Box>
  );
}

const mono = { fontFamily: "monospace", fontSize: "0.875rem" } as const;

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: "flex", gap: 2, alignItems: "baseline" }}>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ minWidth: 96, flexShrink: 0 }}
      >
        {label}
      </Typography>
      <Typography component="span" sx={mono}>
        {value}
      </Typography>
    </Box>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="overline"
      color="text.secondary"
      sx={{ display: "block", mt: 3, mb: 1, fontWeight: 700, letterSpacing: "0.08em" }}
    >
      {children}
    </Typography>
  );
}

function CandidateRow({ candidate }: { candidate: DependencyCandidate }) {
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Typography component="span" sx={{ ...mono, fontWeight: 600 }}>
          {candidate.name}
        </Typography>
        {candidate.style && (
          <Chip size="small" variant="outlined" label={candidate.style} />
        )}
      </Box>
      {candidate.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {candidate.description}
        </Typography>
      )}
      {candidate.package && (
        <Typography component="span" sx={{ ...mono, display: "block", mt: 0.5 }}>
          {candidate.package}
        </Typography>
      )}
      {(candidate.docsUrl || candidate.specUrl) && (
        <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
          {candidate.docsUrl && (
            <Link href={candidate.docsUrl} target="_blank" rel="noopener noreferrer" variant="body2">
              Docs
            </Link>
          )}
          {candidate.specUrl && (
            <Link href={candidate.specUrl} target="_blank" rel="noopener noreferrer" variant="body2">
              Spec
            </Link>
          )}
        </Stack>
      )}
    </Box>
  );
}

function ConfigChip({ entry }: { entry: DesignConfigEntry }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={entry.key}
      color={entry.secret ? "warning" : "default"}
      {...(entry.secret
        ? { icon: <Lock size={14} data-testid="secret-icon" /> }
        : {})}
    />
  );
}

// A dependency reads as: what kind it is (the badge), its name, an optional
// read-time status chip (#252 Task 9 — from DesignViewProps.dependencyStatus,
// NEVER computed here), and a one-line description, followed by its intent
// (sources/candidates/config) and, for a non-resolved dependency, the reason
// plus a "Resolve in chat" button.
function DependencyCard({
  dep,
  status,
  onResolve,
}: {
  dep: Dependency;
  status?: DependencyStatusInfo | undefined;
  onResolve?: (() => void) | undefined;
}) {
  const color = KIND_COLOR[dep.kind] ?? FALLBACK;
  const kindLabel = KIND_LABEL[dep.kind] ?? dep.kind;
  const resolutionStatus = status?.status;
  const isResolved = resolutionStatus === "resolved";
  const showResolution = Boolean(resolutionStatus) && !isResolved;

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 1.5,
        mb: 1,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <SolidBadge label={kindLabel} color={color} />
        <Typography component="span" sx={{ ...mono, fontWeight: 600 }}>
          {dep.name}
        </Typography>
        {resolutionStatus && (
          <Chip
            size="small"
            color={STATUS_COLOR[resolutionStatus] ?? "default"}
            label={STATUS_LABEL[resolutionStatus] ?? resolutionStatus}
          />
        )}
      </Box>
      {dep.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {dep.description}
        </Typography>
      )}

      {dep.sources && dep.sources.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            Sources
          </Typography>
          <Stack spacing={0.5} sx={{ mt: 0.5 }}>
            {dep.sources.map((src) => (
              <Link
                key={src}
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                variant="body2"
                sx={{ wordBreak: "break-all" }}
              >
                {src}
              </Link>
            ))}
          </Stack>
        </Box>
      )}

      {dep.candidates && dep.candidates.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            Candidates
          </Typography>
          <Stack spacing={1} sx={{ mt: 0.5 }}>
            {dep.candidates.map((candidate) => (
              <CandidateRow key={candidate.name} candidate={candidate} />
            ))}
          </Stack>
        </Box>
      )}

      {dep.config && dep.config.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            Config
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
            {dep.config.map((entry) => (
              <ConfigChip key={entry.key} entry={entry} />
            ))}
          </Box>
        </Box>
      )}

      {showResolution && (
        <Box sx={{ mt: 1, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          {status?.reason && (
            <Typography variant="caption" color="error">
              {REASON_LABEL[status.reason] ?? status.reason}
            </Typography>
          )}
          {onResolve && (
            <Button size="small" variant="outlined" onClick={onResolve}>
              Resolve in chat
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
}

function DesignBody({
  design,
  dependencyStatus,
  onResolveDependency,
}: {
  design: ComponentDesign;
  dependencyStatus?: Record<string, DependencyStatusInfo> | undefined;
  onResolveDependency?: ((dependencyName: string) => void) | undefined;
}) {
  const typeColor = TYPE_COLOR[design.type] ?? FALLBACK;
  return (
    <Box sx={{ height: "100%", overflow: "auto", p: 3 }}>
      <Box sx={{ maxWidth: 960, mx: "auto" }}>
        {/* Header bar — type + version sit above the name as an eyebrow row */}
        {(design.type || design.version) && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            {design.type && <SolidBadge label={design.type} color={typeColor} />}
            {design.version && (
              <Chip label={`v${design.version}`} size="small" variant="outlined" />
            )}
          </Box>
        )}
        <Typography variant="h4" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
          {design.name || "component"}
        </Typography>

        {/* Facts — each labeled so a bare value like "docker" isn't ambiguous */}
        <Box sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 0.5 }}>
          {design.language && <Fact label="Language" value={design.language} />}
          {design.buildpack && <Fact label="Buildpack" value={design.buildpack} />}
          {design.exposure && <Fact label="Exposure" value={design.exposure} />}
          {design.appPath && <Fact label="App path" value={design.appPath} />}
          {design.entrypoint && <Fact label="Entrypoint" value={design.entrypoint} />}
          {design.endpoint && <Fact label="Endpoint" value={design.endpoint.name} />}
        </Box>

        {/* Description */}
        {design.description && (
          <>
            <SectionHeading>Description</SectionHeading>
            <Typography variant="body1" color="text.secondary">
              {design.description}
            </Typography>
          </>
        )}

        {/* Dependencies */}
        <SectionHeading>Dependencies</SectionHeading>
        {design.dependencies.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No dependencies.
          </Typography>
        ) : (
          design.dependencies.map((dep, i) => (
            <DependencyCard
              key={`${dep.kind}:${dep.name}:${i}`}
              dep={dep}
              status={dependencyStatus?.[dep.name]}
              onResolve={
                onResolveDependency ? () => onResolveDependency(dep.name) : undefined
              }
            />
          ))
        )}
      </Box>
    </Box>
  );
}

export interface DesignViewProps {
  /** Raw component design.json text. */
  design: string;
  /**
   * OPTIONAL read-time resolution status per dependency name, from #252
   * Task 2's `GET /projects/{p}/design/dependencies` endpoint — the ONLY
   * source of `status`/`reason`. parse.ts deliberately does not parse these
   * two fields from the raw design.json (see its file-header comment): they
   * are computed server-side on every read (models.ComputeDependencyStatus)
   * and never authored/persisted, so recomputing them here — e.g. from
   * `candidates.length` — would drift from that single resolution authority.
   * Optional and keyed defensively (a missing entry just renders without a
   * status chip) so existing callers that don't fetch this endpoint are
   * unaffected.
   */
  dependencyStatus?: Record<string, DependencyStatusInfo> | undefined;
  /**
   * Called with a dependency's `name` when the user clicks "Resolve in
   * chat" on a non-resolved card (only rendered when `dependencyStatus`
   * marks that dependency non-resolved). This package has no chat/collab
   * knowledge of its own — the caller (console's SpecView) looks up that
   * dependency's full endpoint entry and seeds the existing conversation via
   * #252 Task 5's `useResolveDependencyViaChat`. Optional, like
   * `dependencyStatus` above.
   */
  onResolveDependency?: ((dependencyName: string) => void) | undefined;
}

export function DesignView({
  design,
  dependencyStatus,
  onResolveDependency,
}: DesignViewProps) {
  const parsed = useMemo(() => parseComponentDesign(design), [design]);
  if ("kind" in parsed) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Couldn't parse this component's design.json: {parsed.message}
        </Alert>
      </Box>
    );
  }
  return (
    <DesignBody
      design={parsed}
      dependencyStatus={dependencyStatus}
      onResolveDependency={onResolveDependency}
    />
  );
}
