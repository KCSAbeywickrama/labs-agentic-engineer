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

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Link as MuiLink,
  Skeleton,
  Snackbar,
  Stack,
  Typography,
} from "@wso2/oxygen-ui";
import { ArrowRight, Compass, ExternalLink, GitHub } from "@wso2/oxygen-ui-icons-react";
import { createLink, Link } from "@tanstack/react-router";
import { EmptyState } from "../../../components/EmptyState";
import { PageHeader } from "../../../components/PageHeader";
import { StatusChip } from "../../../components/StatusChip";
import type { components } from "../../../generated/aep-api";
import { useBuildRuns, useBuilds } from "../../builds/api/queries";
import { runStamp } from "../../builds/lib/format";
import { mergedCycle } from "../../builds/lib/runView";
import { isRegisteredExternal } from "../../marketplace/kind";
import { useExternalResources } from "../../settings/api/queries";
import { useDesignDependencies } from "../../spec/api/queries";
import { useValidationEvidence } from "../../validation/api/counts";
import { answeredRun } from "../../validation/lib/runs";
import {
  useComponentsDeployments,
  useEnvironments,
  useProjectComponents,
  useProjectDependencyReadiness,
  useProjectStatus,
} from "../api/queries";
import { connectionTable } from "../lib/deploymentDetail";
import {
  commitUrl,
  environmentLabel,
  environmentRows,
  shortSha,
  validationCell,
  type ValidationAvailability,
} from "../lib/deploymentLedger";
import { findEnvironment } from "../lib/environments";
import { groupDeploymentCards, type DeploymentCard } from "../lib/deploymentRows";
import { connectionRows, type ConnectionRow } from "../lib/promotion";
import { ConnectionValuesDialog } from "./ConnectionValuesDialog";
import { ConnectionsTable } from "./ConnectionsTable";

type BuildSummary = components["schemas"]["BuildSummary"];

const LinkButton = createLink(Button);
const RouterLink = createLink(MuiLink);

/**
 * ONE DEPLOYED VERSION in an environment (#779): what the build story knows
 * about it — the milestone, when it was built, the commit that shipped it,
 * how it validated — and what it runs there now when it is the environment's
 * live version. Everything is a read the console already makes: the version
 * ledger for the row, the version's run story for the commit and verdict, the
 * component/binding join for what is live. There is no deployment record
 * behind this (ADR-0027 decision 4), so a superseded version says it was
 * superseded and by what, and claims no rollout dates of its own. The
 * environment's connections — what the design depends on and whether this
 * environment holds values for it — sit here too, since they are a fact
 * about the deployment, not about trying it (#779 review).
 */
export function DeploymentVersionPage({
  projectName,
  environment: segment,
  version,
}: {
  projectName: string;
  environment: string;
  version: string;
}) {
  // The environment is whatever the pipeline calls it; the environments list
  // is the only authority on which names exist. While it loads the segment is
  // taken at its word rather than called a dead end.
  const environments = useEnvironments();
  const environmentList = environments.data ?? [];
  const envInfo = findEnvironment(environmentList, segment);
  const environment = envInfo || environments.isPending ? segment : null;
  const builds = useBuilds(projectName);
  const runs = useBuildRuns(projectName, version);
  const status = useProjectStatus(projectName);
  const deploy = status.data?.deploy;
  const components = useProjectComponents(projectName);
  const componentNames = (components.data?.items ?? []).map((c) => c.name);
  const deployments = useComponentsDeployments(projectName, componentNames);

  // The version's own verdict: the run that last judged it. Read as the
  // evidence hook wants it — a settled word, never the aggregate's, which
  // names the build version.
  const judged = answeredRun(runs.data?.runs ?? []);
  const verdict = judged?.validation?.verdict ?? "";
  const validation = useValidationEvidence(projectName, version, verdict);
  // The design's connections, and whether this environment holds values for
  // them. Production makes no readiness read — nothing collects values there.
  const dependencies = useDesignDependencies(projectName);
  const connections = useMemo(() => connectionRows(dependencies.data), [dependencies.data]);
  // Values are collected where they are first needed — the environment a
  // build lands in. Anywhere else the read stays idle.
  const readiness = useProjectDependencyReadiness(
    projectName,
    envInfo?.position === 0 ? segment : "",
  );
  const externalCatalog = useExternalResources();
  const catalogUnknown = externalCatalog.isPending || externalCatalog.isError;
  const registeredNames = useMemo(() => {
    const names = new Set<string>();
    for (const resource of externalCatalog.data ?? []) {
      if (isRegisteredExternal(resource)) names.add(resource.name);
    }
    return names;
  }, [externalCatalog.data]);
  const [valuesTarget, setValuesTarget] = useState<ConnectionRow | null>(null);
  const [valuesSaved, setValuesSaved] = useState(false);

  // "Deployment · v1" — the page is the deployment; the environment is where
  // it ran, and reads in the subtitle (#779 review).
  const title = environment ? `Deployment · ${version}` : "Deployment";
  const backTo = {
    link: <Link to="/projects/$projectName/deployments" params={{ projectName }} />,
    label: "Back to Deployments",
  };

  if (!environment) {
    return (
      <>
        <PageHeader title={title} backTo={backTo} />
        <EmptyState
          icon={<Compass size={48} />}
          title={`No environment called ${segment}`}
          description={
            environmentList.length > 0
              ? `Deployments live in ${environmentList.map((e) => e.displayName || e.name).join(", ")}.`
              : "That environment is not one this platform deploys to."
          }
          action={
            <LinkButton variant="contained" to="/projects/$projectName/deployments" params={{ projectName }}>
              Back to Deployments
            </LinkButton>
          }
        />
      </>
    );
  }

  const envLabel = environmentLabel(envInfo, segment);
  const build = builds.data?.find((b) => b.tag === version);

  if (builds.isPending) {
    return (
      <>
        <PageHeader title={title} backTo={backTo} />
        <Stack spacing={2} sx={{ mt: 2 }}>
          <Skeleton variant="rounded" height={140} />
          <Skeleton variant="rounded" height={160} />
        </Stack>
      </>
    );
  }

  if (builds.isError) {
    return (
      <>
        <PageHeader title={title} backTo={backTo} />
        <Alert severity="error" action={<Button onClick={() => void builds.refetch()}>Retry</Button>}>
          Failed to load the version ledger
          {builds.error instanceof Error && builds.error.message ? `: ${builds.error.message}` : ""}
        </Alert>
      </>
    );
  }

  // The ledger is the record of what was built; a tag it does not list is a
  // dead end with a way out, not a page of dashes.
  if (!build) {
    return (
      <>
        <PageHeader title={title} backTo={backTo} />
        <EmptyState
          icon={<Compass size={48} />}
          title={`No version called ${version}`}
          description="The version ledger lists every version this project built."
          action={
            <LinkButton variant="contained" to="/projects/$projectName/deployments" params={{ projectName }}>
              Back to Deployments
            </LinkButton>
          }
        />
      </>
    );
  }

  const board = groupDeploymentCards(
    components.data?.items ?? [],
    deployments.deployments,
    environmentList[0]?.name ?? "",
  );
  const row = environmentRows(board, environmentList, deploy).find(
    (r) => r.environment === environment,
  );
  const bound = row?.cards.some((c) => c.deployment) ?? false;
  // Whether THIS version is what the environment runs now. The aggregate
  // names only the version a build rolled out, in the first environment;
  // every later one names none, so it can only be "current" when it is the
  // board's own row for it.
  const liveVersion = envInfo?.position === 0 ? deploy?.version || undefined : row?.version;
  // The aggregate's word for the first environment; a later one has only its
  // bindings.
  // Either way it takes a binding to run: a version the aggregate names but
  // nothing is bound to is not what the environment runs, and the page says
  // so rather than offering Try Out over nothing.
  const current = bound && liveVersion === version;

  const merged = mergedCycle(runs.data?.runs);
  const sha = merged?.mergeSha ?? "";
  const commitHref = commitUrl(status.data?.repoUrl, sha);
  const availability: ValidationAvailability | undefined = runs.isError
    ? "failed"
    : runs.isPending
      ? "pending"
      : undefined;
  const validationView = validationCell(envInfo, verdict || undefined, validation.counts, availability);
  const chip = current && row ? row.status : versionStatus(build);
  const readinessOut = envInfo?.position === 0 && readiness.isPending && !readiness.isError;
  const table = connectionTable(
    connections,
    dependencies.data,
    readiness.data,
    envInfo,
    registeredNames,
    catalogUnknown,
  );

  return (
    <>
      <PageHeader
        title={title}
        subtitle={`${projectName} · ${envLabel}`}
        backTo={backTo}
        actions={
          current ? (
            <LinkButton
              variant="contained"
              to="/projects/$projectName/deployments/$environment/try-out"
              params={{ projectName, environment }}
              endIcon={<ArrowRight size={16} aria-hidden />}
            >
              Try out
            </LinkButton>
          ) : undefined
        }
      />
      {runs.isError && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={<Button onClick={() => void runs.refetch()}>Retry</Button>}
        >
          The version's run story could not be loaded
          {runs.error instanceof Error && runs.error.message ? `: ${runs.error.message}` : ""}
        </Alert>
      )}
      {deployments.failedCount > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Deployments for {deployments.failedCount} component
          {deployments.failedCount === 1 ? "" : "s"} could not be loaded — the page shows what did.
        </Alert>
      )}
      <Stack spacing={2}>
        <SummaryCard
          projectName={projectName}
          environmentLabel={envLabel}
          version={version}
          build={build}
          chip={chip}
          validation={validationView}
          commit={sha ? { sha, ...(commitHref ? { href: commitHref } : {}) } : runs.isPending ? "loading" : undefined}
          {...(current && row?.deployedAt ? { deployedAt: row.deployedAt } : {})}
        />

        {current && row ? (
          <Card variant="outlined">
            <Stack
              direction="row"
              spacing={1.25}
              sx={{ alignItems: "baseline", px: 2.25, py: 1.5, borderBottom: 1, borderColor: "divider" }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Running here now
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {row.live} of {row.total} components live
              </Typography>
            </Stack>
            <Stack spacing={1} sx={{ p: 2 }}>
              {row.cards.map((card) => (
                <ComponentLine key={card.componentName} card={card} />
              ))}
            </Stack>
          </Card>
        ) : (
          <Card variant="outlined" sx={{ p: 2.25 }}>
            <Typography variant="body2" color="text.secondary">
              {notRunningSentence(envLabel, build, liveVersion, bound)}
              {liveVersion && liveVersion !== version && (
                <>
                  {" "}
                  <RouterLink
                    to="/projects/$projectName/deployments/$environment/$version"
                    params={{ projectName, environment, version: liveVersion }}
                    variant="body2"
                  >
                    Open {liveVersion}
                  </RouterLink>
                </>
              )}
            </Typography>
          </Card>
        )}

        {/* The connections, once the design read has answered; a failed read
            says so rather than claiming the design declares nothing. The
            readiness read holds the table too — drawn before it answers,
            every external read Unknown as if that were settled — and a
            failed one says so over the table, since Unknown is then the
            honest word. */}
        {dependencies.isError ? (
          <Alert
            severity="warning"
            action={<Button onClick={() => void dependencies.refetch()}>Retry</Button>}
          >
            The design's connections could not be loaded
            {dependencies.error instanceof Error && dependencies.error.message
              ? `: ${dependencies.error.message}`
              : ""}
          </Alert>
        ) : dependencies.isPending || readinessOut ? (
          <Skeleton variant="rounded" height={160} data-testid="connections-skeleton" />
        ) : (
          <>
            {readiness.isError && (
              <Alert
                severity="warning"
                action={<Button onClick={() => void readiness.refetch()}>Retry</Button>}
              >
                Whether {envLabel} holds values for these connections could not be read
                {readiness.error instanceof Error && readiness.error.message
                  ? `: ${readiness.error.message}`
                  : ""}
                {" — each reads Unknown until it is."}
              </Alert>
            )}
            <ConnectionsTable environmentLabel={envLabel} rows={table} onEdit={setValuesTarget} />
          </>
        )}
      </Stack>

      {valuesTarget && (
        <ConnectionValuesDialog
          open
          onClose={() => setValuesTarget(null)}
          onSaved={() => {
            setValuesTarget(null);
            setValuesSaved(true);
          }}
          projectName={projectName}
          connection={valuesTarget}
          environment={environmentList[0]?.name ?? ""}
        />
      )}
      <Snackbar
        open={valuesSaved}
        autoHideDuration={6000}
        onClose={() => setValuesSaved(false)}
      >
        <Alert severity="success" onClose={() => setValuesSaved(false)}>
          Values saved — the connection re-provisions with them.
        </Alert>
      </Snackbar>
    </>
  );
}

/** A version that is not the live one, as its build reads. */
function versionStatus(build: BuildSummary): { label: string; tone: "info" | "error" | "neutral" | "success"; live: boolean } {
  switch (build.status) {
    case "started":
    case "in_progress":
      return { label: "Building", tone: "info", live: true };
    case "failed":
      return { label: "Build failed", tone: "error", live: false };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral", live: false };
    default:
      return { label: "Superseded", tone: "neutral", live: false };
  }
}

function notRunningSentence(
  env: string,
  build: BuildSummary,
  liveVersion: string | undefined,
  bound: boolean,
): string {
  switch (build.status) {
    case "started":
    case "in_progress":
      return `${build.tag} is still building — it deploys to ${env} when its work merges.`;
    case "failed":
      return `${build.tag}'s build failed, so it never reached ${env}.`;
    case "cancelled":
      return `${build.tag}'s build was cancelled, so it never reached ${env}.`;
    default:
      if (!bound) return `Nothing runs in ${env} now.`;
      return liveVersion
        ? `${build.tag} was superseded — ${liveVersion} runs in ${env} now.`
        : `${build.tag} is not what ${env} runs now.`;
  }
}

function SummaryCard({
  projectName,
  environmentLabel: envLabel,
  version,
  build,
  chip,
  validation,
  commit,
  deployedAt,
}: {
  projectName: string;
  /** What to call the environment on screen — the pipeline's display name. */
  environmentLabel: string;
  version: string;
  build: BuildSummary;
  chip: { label: string; tone: "info" | "error" | "neutral" | "success" | "warning" | "primary"; live: boolean };
  validation: ReturnType<typeof validationCell>;
  commit: { sha: string; href?: string } | "loading" | undefined;
  /** The binding's stamp — the live version only. */
  deployedAt?: string;
}) {
  const cells: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Milestone", value: `Milestone #${build.milestoneNumber}` },
    { label: "Built", value: runStamp(build.completedAt) || (build.startedAt ? `started ${runStamp(build.startedAt)}` : "—") },
    {
      label: "Deployed",
      // Only the live version has a stamp the platform recorded; a past one's
      // rollout is history nothing kept (ADR-0027 decision 4).
      value: deployedAt ? runStamp(deployedAt) : "—",
    },
    {
      label: "Validation",
      value: validation?.pending ? (
        <Skeleton variant="rounded" width={96} height={22} data-testid="validation-cell-skeleton" />
      ) : validation ? (
        <StatusChip
          label={validation.label}
          tone={validation.tone}
          appearance="soft"
          dot
          {...(validation.spoken ? { spokenLabel: validation.spoken } : {})}
        />
      ) : (
        "—"
      ),
    },
    {
      label: "Commit",
      value:
        commit === "loading" ? (
          <CircularProgress size={14} aria-label="Loading the commit" />
        ) : commit ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Box component="span" sx={{ fontFamily: "monospace" }}>
              {shortSha(commit.sha)}
            </Box>
            {commit.href && (
              <MuiLink
                href={commit.href}
                target="_blank"
                rel="noreferrer"
                variant="body2"
                sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
              >
                <GitHub size={13} aria-hidden /> GitHub
              </MuiLink>
            )}
          </Stack>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <Card variant="outlined" sx={{ p: 2.5, ...(chip.live && { borderColor: "info.main" }) }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {envLabel} · {version}
        </Typography>
        <StatusChip label={chip.label} tone={chip.tone} appearance="soft" dot />
        <Box sx={{ flex: 1 }} />
        <RouterLink
          to="/projects/$projectName/builds/$tag"
          params={{ projectName, tag: version }}
          variant="body2"
          sx={{ fontWeight: 500 }}
        >
          View the build
        </RouterLink>
      </Stack>
      <Box
        sx={{
          display: "grid",
          gap: 2.5,
          mt: 2.5,
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(5, minmax(0, 1fr))" },
        }}
      >
        {cells.map((c) => (
          <Box key={c.label} sx={{ minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: "0.07em" }}>
              {c.label}
            </Typography>
            <Typography component="div" variant="body2" sx={{ mt: 0.5, fontWeight: 500 }}>
              {c.value}
            </Typography>
          </Box>
        ))}
      </Box>
    </Card>
  );
}

/** One live component: its name, release, state and URL — the Try Out page
 *  is where it is acted on; this only says it is there. */
/**
 * One running component: its name and status on the first line, then the
 * release and the URL each on a labelled line of their own — the same shape
 * for every component, however long its URL (#779 review).
 */
function ComponentLine({ card }: { card: DeploymentCard }) {
  const d = card.deployment;
  const facts: Array<{ label: string; value: React.ReactNode }> = [];
  if (d?.releaseName) {
    facts.push({
      label: "Release",
      value: (
        <Typography variant="body2" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
          {d.releaseName}
        </Typography>
      ),
    });
  }
  if (d?.endpointUrl) {
    facts.push({
      label: "URL",
      value: (
        <MuiLink
          href={d.endpointUrl}
          target="_blank"
          rel="noreferrer"
          variant="body2"
          sx={{ fontFamily: "monospace", display: "inline-flex", alignItems: "center", gap: 0.5, wordBreak: "break-all" }}
        >
          {d.endpointUrl} <ExternalLink size={13} aria-hidden />
        </MuiLink>
      ),
    });
  }
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", justifyContent: "space-between", px: 2, py: 1.25, borderBottom: facts.length ? 1 : 0, borderColor: "divider" }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {card.displayName}
        </Typography>
        <StatusChip label={d?.status ?? "Not deployed"} tone={card.kind === "success" ? "success" : card.kind === "error" ? "error" : "neutral"} />
      </Stack>
      {facts.map((fact) => (
        <Stack key={fact.label} direction="row" spacing={2} sx={{ alignItems: "baseline", px: 2, py: 0.75 }}>
          <Typography variant="overline" color="text.secondary" sx={{ width: 64, flexShrink: 0 }}>
            {fact.label}
          </Typography>
          {fact.value}
        </Stack>
      ))}
    </Box>
  );
}
