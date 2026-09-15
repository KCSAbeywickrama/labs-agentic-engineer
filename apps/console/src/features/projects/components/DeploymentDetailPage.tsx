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
import { Compass, GitHub } from "@wso2/oxygen-ui-icons-react";
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
import {
  useComponentsDeployments,
  useProjectComponents,
  useProjectDependencyReadiness,
  useProjectStatus,
} from "../api/queries";
import { connectionTable, talksTo } from "../lib/deploymentDetail";
import {
  commitUrl,
  environmentLabel,
  environmentRows,
  milestoneFor,
  parseEnvironment,
  shortSha,
  validationCell,
  type EnvironmentRow,
} from "../lib/deploymentLedger";
import { groupDeploymentCards } from "../lib/deploymentRows";
import { connectionRows, type ConnectionRow } from "../lib/promotion";
import { ComponentOpenApiDialog } from "./ComponentOpenApiDialog";
import { ConnectionValuesDialog } from "./ConnectionValuesDialog";
import { ConnectionsTable } from "./ConnectionsTable";
import { TryItOutCard, useTestUsers } from "./TryItOut";

type Component = components["schemas"]["Component"];

const LinkButton = createLink(Button);
const RouterLink = createLink(MuiLink);

/**
 * One environment's deployment (ADR-0027, artboard 1d; ADR-0032, the
 * Deployment Detail design): a summary card, then TRY IT OUT — every
 * component as a panel a person can act on: a web application is visited and
 * carries the test users that sign in to it, a service lists its endpoints
 * off its contract with a curl each — then the connections the environment
 * runs with. The route is keyed by ENVIRONMENT because that is the only
 * deployment identity the platform keeps: a release binding is current state,
 * so there is exactly one deployment per environment to show, and no earlier
 * one to name.
 */
export function DeploymentDetailPage({
  projectName,
  environment: segment,
}: {
  projectName: string;
  environment: string;
}) {
  const environment = parseEnvironment(segment);
  const components = useProjectComponents(projectName);
  const componentNames = (components.data?.items ?? []).map((c) => c.name);
  const deployments = useComponentsDeployments(projectName, componentNames);
  const status = useProjectStatus(projectName);
  const deploy = status.data?.deploy;
  const builds = useBuilds(projectName);

  // The version this environment runs — the aggregate names development's.
  const version =
    environment === "development" && deploy?.version ? deploy.version : undefined;
  // The version's run story, for the commit that shipped it. Tag-scoped and
  // DB-only; the Builds surfaces make the same read, so it is served from cache
  // whenever the reader came from there.
  const runs = useBuildRuns(projectName, version);
  const validation = useValidationEvidence(
    projectName,
    status.data?.build.version ?? "",
    deploy?.validation ?? "",
  );
  // The design's graph and its connections — who talks to whom, and what
  // each dependency is — and whether this environment holds values for them.
  const dependencies = useDesignDependencies(projectName);
  const connections = useMemo(() => connectionRows(dependencies.data), [dependencies.data]);
  const readiness = useProjectDependencyReadiness(
    projectName,
    environment === "development" ? "development" : "",
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

  const [contractComponent, setContractComponent] = useState<string | null>(null);
  const [valuesTarget, setValuesTarget] = useState<ConnectionRow | null>(null);
  const [valuesSaved, setValuesSaved] = useState(false);

  const title = environment
    ? version
      ? `${environmentLabel(environment)} · ${version}`
      : environmentLabel(environment)
    : "Deployment";
  const backTo = {
    link: <Link to="/projects/$projectName/deployments" params={{ projectName }} />,
    label: "Back to Deployments",
  };

  // Everything below needs the board; these are computed before the early
  // returns so the test-users read can be mounted unconditionally (a hook).
  const board = groupDeploymentCards(components.data?.items ?? [], deployments.deployments);
  const row = environment
    ? environmentRows(board, deploy).find((r) => r.environment === environment)
    : undefined;
  const bound = row?.cards.some((c) => c.deployment) ?? false;
  // Test users live with the app they sign in to. Read only for a green
  // development — the roles read stays idle until there is something to sign
  // in to, as it did on the board.
  const green =
    environment === "development" &&
    deploy?.status === "deployed" &&
    (row?.total ?? 0) > 0 &&
    row?.live === row?.total;
  const testUsers = useTestUsers(projectName, Boolean(green));

  if (!environment) {
    // An unknown segment is a dead end with a way out, not a blank page with a
    // title on it.
    return (
      <>
        <PageHeader title={title} backTo={backTo} />
        <EmptyState
          icon={<Compass size={48} />}
          title={`No environment called ${segment}`}
          description="Deployments live in development and production."
          action={
            <LinkButton
              variant="contained"
              to="/projects/$projectName/deployments"
              params={{ projectName }}
            >
              Back to Deployments
            </LinkButton>
          }
        />
      </>
    );
  }

  if (components.isPending || (componentNames.length > 0 && deployments.isPending)) {
    return (
      <>
        <PageHeader title={title} backTo={backTo} />
        <Stack spacing={2} sx={{ mt: 2 }}>
          <Skeleton variant="rounded" height={140} />
          <Skeleton variant="rounded" height={220} />
        </Stack>
      </>
    );
  }

  if (components.isError) {
    return (
      <>
        <PageHeader title={title} backTo={backTo} />
        <Alert
          severity="error"
          action={<Button onClick={() => void components.refetch()}>Retry</Button>}
        >
          Failed to load deployments
          {components.error instanceof Error && components.error.message
            ? `: ${components.error.message}`
            : ""}
        </Alert>
      </>
    );
  }

  if (!row || !bound) {
    // "Nothing is deployed here" is a claim about every component, and a read
    // that FAILED supports no claim at all — so a page that lost some of them
    // says THAT instead (#714 review). The two must not render together: an
    // empty state beside a load warning tells the reader both that the
    // environment is empty and that the page could not find out.
    //
    // The queries keep polling on failure (their interval is the active one
    // while they hold no data), so this state resolves itself and needs no
    // Retry of its own.
    return (
      <>
        <PageHeader title={title} backTo={backTo} />
        {deployments.failedCount > 0 ? (
          <Alert severity="warning">
            Deployments for {deployments.failedCount} component
            {deployments.failedCount === 1 ? "" : "s"} could not be loaded, so
            there is nothing this page can say about {environmentLabel(environment)}{" "}
            yet. It keeps retrying.
          </Alert>
        ) : (
          <EmptyState
            compact
            description={
              environment === "development"
                ? "Nothing deployed here yet — agents deploy to development when a build merges."
                : "Nothing deployed here yet — promote a validated version from development."
            }
          />
        )}
      </>
    );
  }

  const byName = new Map<string, Component>();
  for (const c of components.data?.items ?? []) byName.set(c.name, c);
  const types = new Map<string, string>();
  for (const c of components.data?.items ?? []) if (c.type) types.set(c.name, c.type);
  const merged = mergedCycle(runs.data?.runs);
  const sha = merged?.mergeSha ?? "";
  const commitHref = commitUrl(status.data?.repoUrl, sha);
  const validationView = validationCell(environment, deploy?.validation, validation.counts);
  const table = connectionTable(
    connections,
    dependencies.data,
    readiness.data,
    environment,
    registeredNames,
    catalogUnknown,
  );

  return (
    <>
      {/* No status chip beside the title — the summary card just below
          carries the same chip, and two of one fact in one screenful is one
          too many (review round). */}
      <PageHeader
        title={title}
        backTo={backTo}
        {...(validationView
          ? {
              actions: (
                <StatusChip
                  label={`Validation · ${validationView.label}`}
                  tone={validationView.tone}
                  appearance="soft"
                  dot
                  {...(validationView.spoken ? { spokenLabel: `Validation, ${validationView.spoken}` } : {})}
                />
              ),
            }
          : {})}
      />
      {deployments.failedCount > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Deployments for {deployments.failedCount} component
          {deployments.failedCount === 1 ? "" : "s"} could not be loaded — the
          page shows what did.
        </Alert>
      )}
      <Stack spacing={2}>
        <SummaryCard
          projectName={projectName}
          row={row}
          milestone={milestoneFor(version, builds.data)}
          validation={validationView}
          commit={
            sha
              ? { sha, ...(commitHref ? { href: commitHref } : {}) }
              : runs.isPending && Boolean(version)
                ? "loading"
                : undefined
          }
        />

        <TryItOutCard
          projectName={projectName}
          cards={row.cards}
          types={types}
          talksTo={(name) => talksTo(dependencies.data, name)}
          live={row.live}
          total={row.total}
          testUsers={green ? testUsers : null}
          onTryApi={setContractComponent}
        />

        {/* The connections, once the design read has answered; a failed read
            says so rather than claiming the design declares nothing. */}
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
        ) : (
          !dependencies.isPending && (
            <ConnectionsTable
              projectName={projectName}
              environment={environment}
              rows={table}
              onEdit={setValuesTarget}
            />
          )
        )}
      </Stack>

      <ComponentOpenApiDialog
        projectName={projectName}
        componentName={contractComponent}
        onClose={() => setContractComponent(null)}
      />
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
          environment="development"
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

function SummaryCard({
  projectName,
  row,
  milestone,
  validation,
  commit,
}: {
  projectName: string;
  row: EnvironmentRow;
  milestone: string | undefined;
  validation: ReturnType<typeof validationCell>;
  /** The merge that shipped this version, once the run story has answered. */
  commit: { sha: string; href?: string } | "loading" | undefined;
}) {
  const cells: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Deployed", value: runStamp(row.deployedAt) || "—" },
    { label: "Milestone", value: milestone ?? "—" },
    {
      label: "Validation",
      value: validation ? (
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
    <Card variant="outlined" sx={{ p: 2.5, ...(row.status.live && { borderColor: "info.main" }) }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {row.version ? `${row.label} · ${row.version}` : row.label}
        </Typography>
        <StatusChip label={row.status.label} tone={row.status.tone} appearance="soft" dot />
        <Box sx={{ flex: 1 }} />
        {row.version && (
          <RouterLink
            to="/projects/$projectName/builds/$tag"
            params={{ projectName, tag: row.version }}
            variant="body2"
            sx={{ fontWeight: 500 }}
          >
            View the build that shipped this
          </RouterLink>
        )}
      </Stack>
      <Box
        sx={{
          display: "grid",
          gap: 2.5,
          mt: 2.5,
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(4, minmax(0, 1fr))" },
        }}
      >
        {cells.map((c) => (
          <Box key={c.label} sx={{ minWidth: 0 }}>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ fontWeight: 700, letterSpacing: "0.07em" }}
            >
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
