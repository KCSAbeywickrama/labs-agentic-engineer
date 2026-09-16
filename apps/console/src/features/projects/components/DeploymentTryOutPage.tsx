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
  Button,
  Skeleton,
  Snackbar,
  Stack,
} from "@wso2/oxygen-ui";
import { Compass } from "@wso2/oxygen-ui-icons-react";
import { createLink, Link } from "@tanstack/react-router";
import { EmptyState } from "../../../components/EmptyState";
import { PageHeader } from "../../../components/PageHeader";
import { StatusChip } from "../../../components/StatusChip";
import { useBuildRuns } from "../../builds/api/queries";
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
import { deployedValidationState, } from "../lib/deploymentFlow";
import {
  environmentLabel,
  environmentRows,
  parseEnvironment,
  validationCell,
} from "../lib/deploymentLedger";
import { groupDeploymentCards } from "../lib/deploymentRows";
import { connectionRows, type ConnectionRow } from "../lib/promotion";
import { ComponentOpenApiDialog } from "./ComponentOpenApiDialog";
import { ConnectionValuesDialog } from "./ConnectionValuesDialog";
import { ConnectionsTable } from "./ConnectionsTable";
import { TryItOutCard, useTestUsers } from "./TryItOut";

const LinkButton = createLink(Button);

/**
 * TRY OUT (#779; ADR-0032, the Deployment Detail design) — the environment's
 * live components as things a person can act on: a web application is visited
 * and carries the test users that sign in to it, a service lists its endpoints
 * off its contract with a curl each — then the connections the environment
 * runs with. What a deployment IS (its version, commit, verdict) is the
 * version page's business (`DeploymentVersionPage`), not this one's. Keyed by
 * ENVIRONMENT because a release binding is current state: there is exactly
 * one deployment per environment to try.
 */
export function DeploymentTryOutPage({
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

  // The version this environment runs — the aggregate names development's.
  const version =
    environment === "development" && deploy?.version ? deploy.version : undefined;
  // The version's run story, for the commit that shipped it. Tag-scoped and
  // DB-only; the Builds surfaces make the same read, so it is served from cache
  // whenever the reader came from there.
  const runs = useBuildRuns(projectName, version);
  // The aggregate's validation names the BUILD version; this page names the
  // deployed one, which answers for itself off the run story just read when
  // the two differ (`deployedValidation`).
  const deployedState = deployedValidationState(deploy, status.data?.build.version ?? "", runs);
  const pageDeploy = deploy ? { ...deploy, validation: deployedState.validation } : undefined;
  const validationAvailability = deployedState.pending
    ? ("pending" as const)
    : deployedState.failed
      ? ("failed" as const)
      : undefined;
  const validation = useValidationEvidence(projectName, version ?? "", pageDeploy?.validation ?? "");
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

  const title = "Deployment Try Out";
  const subtitle = environment
    ? `${projectName} · ${environmentLabel(environment)}${version ? ` · ${version}` : ""}`
    : projectName;
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
  // in to, as it did on the board. Green is the row's own word, which folds
  // live bindings under a `none` aggregate to Deployed (deploymentLedger):
  // an app that is serving is one a test user can sign in to, whatever
  // rollout the aggregate is tracking.
  const green =
    environment === "development" &&
    row?.status.label === "Deployed" &&
    (row?.total ?? 0) > 0 &&
    row?.live === row?.total;
  // Whether development holds values is a read of its own; production makes
  // none, so only development can be waiting on it.
  const readinessOut =
    environment === "development" && readiness.isPending && !readiness.isError;
  const testUsers = useTestUsers(projectName, Boolean(green));

  if (!environment) {
    // An unknown segment is a dead end with a way out, not a blank page with a
    // title on it.
    return (
      <>
        <PageHeader title={title} subtitle={subtitle} backTo={backTo} />
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
        <PageHeader title={title} subtitle={subtitle} backTo={backTo} />
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
        <PageHeader title={title} subtitle={subtitle} backTo={backTo} />
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
        <PageHeader title={title} subtitle={subtitle} backTo={backTo} />
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

  const types = new Map<string, string>();
  for (const c of components.data?.items ?? []) if (c.type) types.set(c.name, c.type);
  const validationView = validationCell(
    environment,
    pageDeploy?.validation,
    validation.counts,
    validationAvailability,
  );
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
        subtitle={subtitle}
        backTo={backTo}
        {...(validationView && !validationView.pending
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
      {runs.isError && (
        // When this version is behind the build, its verdict is its own run
        // story's. Without it the chip says so rather than settling on
        // "Not run".
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={<Button onClick={() => void runs.refetch()}>Retry</Button>}
        >
          The version's run story could not be loaded
          {runs.error instanceof Error && runs.error.message ? `: ${runs.error.message}` : ""}
        </Alert>
      )}
      <Stack spacing={2}>
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
                Whether Development holds values for these connections could not be read
                {readiness.error instanceof Error && readiness.error.message
                  ? `: ${readiness.error.message}`
                  : ""}
                {" — each reads Unknown until it is."}
              </Alert>
            )}
            <ConnectionsTable
              projectName={projectName}
              environment={environment}
              rows={table}
              onEdit={setValuesTarget}
            />
          </>
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
