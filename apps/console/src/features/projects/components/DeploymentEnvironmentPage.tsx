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

import { useState } from "react";
import {
  Alert,
  Button,
  Skeleton,
  Stack,
  Typography,
} from "@wso2/oxygen-ui";
import { Compass } from "@wso2/oxygen-ui-icons-react";
import { createLink, Link } from "@tanstack/react-router";
import { EmptyState } from "../../../components/EmptyState";
import { PageHeader } from "../../../components/PageHeader";
import { useBuildRuns, useBuilds } from "../../builds/api/queries";
import { runStamp } from "../../builds/lib/format";
import { mergedCycle } from "../../builds/lib/runView";
import { useDesignDependencies } from "../../spec/api/queries";
import { useValidationEvidence } from "../../validation/api/counts";
import {
  useComponentsDeployments,
  useEnvironments,
  useProjectComponents,
  useProjectStatus,
} from "../api/queries";
import { talksTo } from "../lib/deploymentDetail";
import { deployedValidationState, } from "../lib/deploymentFlow";
import {
  buildFor,
  commitUrl,
  environmentLabel,
  environmentRows,
  milestoneUrl,
  validationCell,
} from "../lib/deploymentLedger";
import { findEnvironment } from "../lib/environments";
import { groupDeploymentCards } from "../lib/deploymentRows";
import { ComponentOpenApiDialog } from "./ComponentOpenApiDialog";
import { EnvironmentDeploymentSummary } from "./EnvironmentDeploymentSummary";
import { PageSection } from "./PageSection";
import { TryItOutCard, useTestUsers } from "./TryItOut";

const LinkButton = createLink(Button);

/**
 * TRY OUT (#779; ADR-0032, the Deployment Detail design) — the environment's
 * live components as things a person can act on: a web application is visited
 * and carries the test users that sign in to it, a service lists its endpoints
 * off its contract with a curl each. The connections the environment runs
 * with are the version page's (#779 review). What a deployment IS (its version, commit, verdict) is the
 * version page's business (`DeploymentVersionPage`), not this one's. Keyed by
 * ENVIRONMENT because a release binding is current state: there is exactly
 * one deployment per environment to try.
 */
export function DeploymentEnvironmentPage({
  projectName,
  environment: segment,
}: {
  projectName: string;
  environment: string;
}) {
  // The environment is whatever the pipeline calls it; the list is the only
  // authority on which names exist. While it is still loading the segment is
  // taken at its word — a page that flashed "no such environment" on every
  // load would be lying about what it knows.
  const environments = useEnvironments();
  const environmentList = environments.data ?? [];
  const envInfo = findEnvironment(environmentList, segment);
  const environment = envInfo || environments.isPending ? segment : null;
  const components = useProjectComponents(projectName);
  const componentNames = (components.data?.items ?? []).map((c) => c.name);
  const deployments = useComponentsDeployments(projectName, componentNames);
  const status = useProjectStatus(projectName);
  const deploy = status.data?.deploy;

  // The version this environment runs — the aggregate names only the one a
  // build lands in, the first of the pipeline.
  const version =
    envInfo?.position === 0 && deploy?.version ? deploy.version : undefined;
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
  // The design's graph — who talks to whom. Its connections are the version
  // page's business (#779 review).
  const dependencies = useDesignDependencies(projectName);

  const [contractComponent, setContractComponent] = useState<string | null>(null);

  const envLabel = environmentLabel(envInfo, segment);
  // "Staging Environment" — the environment's own name is the page's title,
  // the word Environment small beside it (the approved design, §6).
  const title = (
    <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
      <span>{envLabel}</span>
      <Typography variant="body2" color="text.secondary">
        Environment
      </Typography>
    </Stack>
  );
  const backTo = {
    link: <Link to="/projects/$projectName/deployments" params={{ projectName }} />,
    label: "Back to Deployments",
  };

  // Everything below needs the board; these are computed before the early
  // returns so the test-users read can be mounted unconditionally (a hook).
  const board = groupDeploymentCards(
    components.data?.items ?? [],
    deployments.deployments,
    environmentList[0]?.name ?? "",
  );
  const row = environment
    ? environmentRows(board, environmentList, deploy).find((r) => r.environment === environment)
    : undefined;
  const bound = row?.cards.some((c) => c.deployment) ?? false;
  // The version ledger — the milestone this version's work lived in, and the
  // stamps its build recorded. It speaks for the environment a build LANDS
  // in and no other, so a later environment reads none of it.
  const builds = useBuilds(projectName);
  const build = buildFor(version, builds.data);
  const mergeSha = mergedCycle(runs.data?.runs)?.mergeSha ?? "";
  const commitHref = commitUrl(status.data?.repoUrl, mergeSha);
  const commit: { sha: string; href?: string } | "loading" | undefined = !version
    ? undefined
    : runs.isPending
      ? "loading"
      : mergeSha
        ? { sha: mergeSha, ...(commitHref ? { href: commitHref } : {}) }
        : undefined;
  const milestoneHref = milestoneUrl(status.data?.repoUrl, build?.milestoneNumber);
  // The status poll is what names the version. While it is out — or failed —
  // the entry environment knows of no version, and "Version unknown" would be
  // a settled claim it cannot make.
  const statusUnsettled = Boolean(status.isPending || status.isError);
  const deployedStamp = runStamp(row?.deployedAt);
  const builtAt = runStamp(build?.completedAt);
  const subtitle = environment
    ? [
        projectName,
        version && deployedStamp
          ? `running ${version} since ${deployedStamp}`
          : version
            ? `running ${version}`
            : deployedStamp
              ? `running since ${deployedStamp}`
              : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : projectName;
  // Test users live with the app they sign in to. Read only for a green first
  // environment — the roles read stays idle until there is something to sign
  // in to, as it did on the board. Green is the row's own word, which folds
  // live bindings under a `none` aggregate to Deployed (deploymentLedger):
  // an app that is serving is one a test user can sign in to, whatever
  // rollout the aggregate is tracking.
  // Behaviour preserved: the roles read stays where it has always been, the
  // first environment of the pipeline. Whether that is because the test users
  // belong to the deployment a build lands in, or because credentials are
  // deliberately not offered downstream of it, the code does not say — both
  // read as position 0 today (see task 6 report).
  const green =
    envInfo?.position === 0 &&
    row?.status.label === "Deployed" &&
    (row?.total ?? 0) > 0 &&
    row?.live === row?.total;
  const testUsers = useTestUsers(projectName, Boolean(green));

  // A failed read is not a verdict on the segment. Without this the page would
  // tell the user there is no such environment — a permanent-sounding fact —
  // when all that happened is that a request failed.
  if (environments.isError) {
    return (
      <>
        <PageHeader title={title} subtitle={subtitle} backTo={backTo} />
        <Alert
          severity="warning"
          action={<Button onClick={() => void environments.refetch()}>Retry</Button>}
        >
          The platform's environments could not be read
          {environments.error instanceof Error && environments.error.message
            ? `: ${environments.error.message}`
            : ""}
          {" — this page cannot say what runs in "}
          {segment} until they load.
        </Alert>
      </>
    );
  }

  if (!environment) {
    // An unknown segment is a dead end with a way out, not a blank page with a
    // title on it.
    return (
      <>
        <PageHeader title={title} subtitle={subtitle} backTo={backTo} />
        <EmptyState
          icon={<Compass size={48} />}
          title={`No environment called ${segment}`}
          description={
            environmentList.length > 0
              ? `Deployments live in ${environmentList.map((e) => e.displayName || e.name).join(", ")}.`
              : "That environment is not one this platform deploys to."
          }
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

  // The board is one row per environment the pipeline names, so a row for
  // THIS one cannot be drawn — or honestly called empty — until that list is
  // in. Without this the page would assert "Nothing deployed here yet" over
  // a deployed environment for as long as the environments read takes.
  if (
    components.isPending ||
    environments.isPending ||
    (componentNames.length > 0 && deployments.isPending)
  ) {
    return (
      <>
        <PageHeader title={title} subtitle={subtitle} backTo={backTo} />
        <Stack spacing={2} sx={{ mt: 2 }} aria-label="Loading deployments">
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
            there is nothing this page can say about {envLabel}{" "}
            yet. It keeps retrying.
          </Alert>
        ) : (
          <EmptyState
            compact
            description={
              envInfo?.position === 0
                ? `Nothing deployed here yet — agents deploy to ${envLabel} when a build merges.`
                : "Nothing deployed here yet — promote a validated version from the environment before this one."
            }
          />
        )}
      </>
    );
  }

  const types = new Map<string, string>();
  for (const c of components.data?.items ?? []) if (c.type) types.set(c.name, c.type);
  // The WORD, not the counts: section 1 shows the verdict and its counts as
  // two things (the approved design), so the cell is asked for its label
  // alone and the counts ride beside it.
  const validationView = validationCell(
    envInfo,
    pageDeploy?.validation,
    undefined,
    validationAvailability,
  );

  return (
    <>
      {/* No status chip beside the title — section 1 below carries the
          verdict, and two of one fact in one screenful is one too many
          (review round). */}
      <PageHeader title={title} subtitle={subtitle} backTo={backTo} />
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
        <PageSection title="Deployment" caption="what runs here now" index="01">
          <EnvironmentDeploymentSummary
            {...(version ? { version } : {})}
            bound={bound}
            pending={envInfo?.position === 0 && statusUnsettled}
            {...(build?.milestoneNumber ? { milestoneNumber: build.milestoneNumber } : {})}
            {...(milestoneHref ? { milestoneHref } : {})}
            {...(commit ? { commit } : {})}
            validation={validationView}
            {...(validation.counts ? { counts: validation.counts } : {})}
            {...(builtAt ? { builtAt } : {})}
            {...(deployedStamp ? { deployedAt: deployedStamp } : {})}
            live={row.live}
            total={row.total}
          />
        </PageSection>

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

      </Stack>

      <ComponentOpenApiDialog
        projectName={projectName}
        componentName={contractComponent}
        onClose={() => setContractComponent(null)}
      />
    </>
  );
}
