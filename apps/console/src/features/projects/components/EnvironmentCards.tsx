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

import {
  Box,
  Button,
  Card,
  CardContent,
  Link as UiLink,
  Skeleton,
  Stack,
  Typography,
  alpha,
} from "@wso2/oxygen-ui";
import { ArrowRight, CircleAlert, Lock } from "@wso2/oxygen-ui-icons-react";
import { createLink } from "@tanstack/react-router";
import { StatusChip } from "../../../components/StatusChip";
import type { components } from "../../../generated/aep-api";
import { RunHoldNotice } from "../../builds/components/RunHoldNotice";
import type { ValidationCounts } from "../../validation/lib/verdict";
import {
  componentLine,
  connectionsHeadline,
  deployStep,
  deployedSentence,
  holdNotice,
  holdSentence,
  validationStep,
  type ConnectionLine,
  type DeployHold,
  type PromoteStep,
} from "../lib/deploymentFlow";
import { agoLabel, shortSha, type EnvironmentRow } from "../lib/deploymentLedger";
import {
  isLast,
  stepsFor,
  type EnvironmentInfo,
} from "../lib/environments";
import type { ConnectionRow } from "../lib/promotion";
import { AccentPill } from "./AccentPill";
import { ComponentsGroup, ConnectionsGroup } from "./EnvironmentGroups";
import { FlowStep } from "./FlowStep";
import { VerdictBanner } from "./VerdictBanner";

type DeployStage = components["schemas"]["DeployStage"];

const LinkButton = createLink(Button);
/** The environment name as a real link: keyboard reachable, and openable
 *  in a new tab, which a click handler on the card alone is not. */
const NameLink = createLink(UiLink);

/**
 * The version the Deployment step is about, and where it came from — the
 * card's most prominent fact, in a tinted block directly under the step's
 * title (the header used to carry it as small grey text beside the name).
 *
 * Nothing here is ever stated as fact when it is not known. An unsettled read
 * draws a skeleton; a settled read that names no version says so in words —
 * "Version unknown" — and the second line is omitted outright when neither
 * the build's stamp nor its commit came back, rather than printing a dash
 * where a date or a sha should be.
 */
function VersionBlock({
  version,
  milestone,
  milestoneHref,
  builtAt,
  commit,
  pending,
}: {
  /** The version this card runs; empty when the read settled without one. */
  version: string;
  milestone?: string | undefined;
  /** The entry version's milestone page on the project's repository; absent
   *  when the repo URL or the milestone number is not known. */
  milestoneHref?: string | undefined;
  /** When the entry version's build finished, already formatted for display;
   *  absent when the ledger has no stamp for it. */
  builtAt?: string | undefined;
  /** The commit the entry version shipped. `"loading"` while the run story is
   *  still out; absent when it named none. */
  commit?: { sha: string; href?: string | undefined } | "loading" | undefined;
  /** The read that names the version is still out (or failed). */
  pending: boolean;
}) {
  if (pending) {
    return <Skeleton variant="rounded" height={56} data-testid="version-block-skeleton" />;
  }
  // "loading" is not a commit — the run story is still out, so the line stays
  // silent about it rather than printing a placeholder sha.
  const sha = commit && commit !== "loading" ? commit : undefined;
  const stop = (event: React.MouseEvent) => event.stopPropagation();
  return (
    <Box
      data-testid="version-block"
      sx={(theme) => ({
        px: 1.5,
        py: 1,
        borderRadius: 1,
        bgcolor: alpha(theme.palette.text.primary, 0.04),
      })}
    >
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline", flexWrap: "wrap" }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {version ? `Version ${version}` : "Version unknown"}
        </Typography>
        {milestone && (
          <Typography variant="body2" color="text.secondary">
            ·{" "}
            {milestoneHref ? (
              <UiLink href={milestoneHref} target="_blank" rel="noreferrer" onClick={stop}>
                {milestone}
              </UiLink>
            ) : (
              milestone
            )}
          </Typography>
        )}
      </Stack>
      {(builtAt || sha) && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
          {builtAt && `Built ${builtAt}`}
          {builtAt && sha && " · "}
          {sha && (
            <>
              {"commit "}
              {sha.href ? (
                <UiLink href={sha.href} target="_blank" rel="noreferrer" onClick={stop}>
                  {shortSha(sha.sha)}
                </UiLink>
              ) : (
                <Box component="span" sx={{ fontFamily: "monospace" }}>
                  {shortSha(sha.sha)}
                </Box>
              )}
            </>
          )}
        </Typography>
      )}
    </Box>
  );
}

/** "Try it now →" — the one primary action on the card, into the environment
 *  page where the app, the endpoints and the test users are. */
function TryItNow({
  projectName,
  environment,
  disabled,
  variant = "contained",
}: {
  projectName: string;
  /** The card's OWN environment name. Never a constant: a pipeline whose
   *  entry environment is called `qa` must not be sent to `development`,
   *  which on that platform is a dead-end page. */
  environment: string;
  disabled: boolean;
  /** `outlined` when something further along the card outranks it — the card
   *  carries exactly one primary action. */
  variant?: "contained" | "outlined";
}) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.75 }}>
      <LinkButton
        variant={variant}
        disabled={disabled}
        to="/projects/$projectName/deployments/$environment/try-out"
        params={{ projectName, environment }}
        onClick={(event: React.MouseEvent) => event.stopPropagation()}
        endIcon={<ArrowRight size={16} aria-hidden />}
      >
        Try it now
      </LinkButton>
      <Typography variant="caption" color="text.secondary">
        Opens the deployment view: app, endpoints, test users
      </Typography>
    </Stack>
  );
}

// ── One environment, as one item in the horizontal flow ─────────────────────
//
// This is the card the Deployments page draws, through `EnvironmentFlow`.

/**
 * The reads the Deployments page makes once and the cards divide between
 * them. Everything here answers for the pipeline's ENTRY environment — the
 * deploy aggregate tracks the rollout of a completed build, which lands there
 * and nowhere else — so a later environment's card says what its own bindings
 * say and stays silent about the rest rather than borrowing the entry
 * environment's facts under its own name.
 */
export interface EnvironmentFlowDetail {
  deploy?: DeployStage | undefined;
  /** The version the ENTRY card is about: deployed, or building. */
  version: string;
  milestone?: string | undefined;
  /** The entry version's milestone page on the project's repository; absent
   *  when the repo URL or the milestone number is not known. */
  milestoneHref?: string | undefined;
  /** When the entry version's build finished, already formatted for display;
   *  absent when the ledger has no stamp for it. */
  builtAt?: string | undefined;
  /** The commit the entry version shipped. `"loading"` while the run story is
   *  still out; absent when it named none. */
  commit?: { sha: string; href?: string | undefined } | "loading" | undefined;
  validation: { verdict: string; repairing: boolean; counts?: ValidationCounts | undefined };
  hold: DeployHold | null;
  componentTypes: Map<string, string>;
  /** The entry environment's connections; null while the read is out or failed. */
  connections: ConnectionLine[] | null;
  /** The entry environment's promote step; null when there is nothing to
   *  promote (no version yet, or the target already runs one). */
  promote: PromoteStep | null;
  /** Which of the reads behind the steps are still out — or failed, which
   *  supports no claim either. `deploy` is the status poll that names
   *  `version`: while it is unsettled the card knows of no version, and a
   *  step that reasoned from its absence would deny a live deployment. */
  pending: { deploy: boolean; connections: boolean; validation: boolean; hold: boolean };
  validationUnavailable?: boolean | undefined;
}

/**
 * The environment this card promotes INTO, as its own row describes it.
 *
 * `state` is deliberately not "a binding exists": a target whose components
 * all failed, or were undeployed, is populated too, and calling that "runs a
 * version" is the same mistake `productionLiveSentence` documents — a settled
 * claim the fold does not support. Only a `success` fold is RUNNING.
 */
export interface FlowTarget {
  /** What to call it on screen — its displayName, never a console constant. */
  label: string;
  /** empty: nothing is bound there. running: its fold is green. populated:
   *  something is bound but the fold is not green (failed, converging,
   *  undeployed) — there is something there, but not a running version. */
  state: "empty" | "running" | "populated";
  /** Its own status word, for the populated-but-not-running sentence. */
  statusLabel: string;
}

export interface EnvironmentFlowCardProps {
  projectName: string;
  /** The environment as the PLATFORM describes it — the source of every step
   *  this card draws. */
  env: EnvironmentInfo;
  /** Its row, as `environmentRows` built it. */
  row: EnvironmentRow;
  /** This is the pipeline's entry environment: the one the deploy aggregate,
   *  the validation evidence, the connections read and the hold speak for. */
  entry: boolean;
  /** The environment `env.promotesTo` names; null on the last environment. */
  target: FlowTarget | null;
  detail: EnvironmentFlowDetail;
  /** Open this environment's page. */
  onOpen: (environment: string) => void;
  onPromote: () => void;
  onConfigureConnection: (row: ConnectionRow) => void;
  onConfigurePromoteTarget: (row: ConnectionRow) => void;
}

/**
 * One environment's card. Its steps are `stepsFor(env)` and nothing else:
 * Deployment always, Validation only where the platform says this environment
 * validates, Promote only where something follows. The card carries exactly
 * ONE primary action — the furthest-along thing actually possible — and the
 * trailing step sits on the card's bottom — the step above it absorbs the
 * spare height and draws its rail through it — so the promote rows land on
 * the pipeline's bottom edge however tall each card's component list makes it.
 */
export function EnvironmentFlowCard({
  projectName,
  env,
  row,
  entry,
  target,
  detail,
  onOpen,
  onPromote,
  onConfigureConnection,
  onConfigurePromoteTarget,
}: EnvironmentFlowCardProps) {
  const { deploy, version, milestone, validation, componentTypes, connections, promote, pending } =
    detail;
  // A hold, the deploy aggregate's validation and the connections read all
  // answer for the entry environment. A later card must not repeat them.
  const hold = entry ? detail.hold : null;
  const deployed = deployStep(row, hold);
  const holdUnknown = entry && pending.hold && !detail.hold;
  const bound = row.cards.some((c) => c.deployment);
  const lines = row.cards.map((c) => componentLine(c, componentTypes.get(c.componentName), hold));
  const steps = stepsFor(env);
  const last = isLast(env);
  // The one-primary rule: Promote takes it the moment it is legal; until then
  // Try it now holds it. Only the entry environment has a promote control at
  // all, so a deployed final environment keeps Try it now primary.
  const promoteReady = entry && Boolean(promote?.enabled);
  const cardVersion = entry ? version : (row.version ?? "");
  const holdRow =
    hold && connections
      ? connections.find((l) => l.state === "missing" && l.configure)?.row
      : undefined;
  const tone = row.status.tone;

  // `deployStep`'s pending note speaks for the environment a BUILD lands in.
  // Nothing is built into a later environment — a version is promoted there —
  // so the note is the card's own or it is false.
  const deployedView =
    deployed.state === "pending" && !entry && row.status.label !== "Undeployed"
      ? { ...deployed, note: `Deploys when a version is promoted to ${row.label}.` }
      : deployed;

  // The trailing step sits on the card's bottom whenever something follows
  // this environment; the step BEFORE it absorbs the spare height, so the
  // rail is drawn continuously down into it.
  const growIndex = last ? -1 : steps.length - 2;
  const stepNodes = steps.map((step, i) => {
    const isTrailing = i === steps.length - 1;
    const grow = i === growIndex;
    if (step.kind === "deployment") {
      return (
        <FlowStep
          key="deployment"
          step={step.index}
          view={deployedView}
          ringTone="info"
          last={isTrailing}
          grow={grow}
        >
          {(bound || hold) && (
            <VersionBlock
              version={cardVersion}
              // The milestone, the build stamp and the commit answer for the
              // version the deploy aggregate names — the ENTRY environment's.
              // A later card states its own version and nothing more.
              {...(entry
                ? {
                    ...(milestone ? { milestone } : {}),
                    ...(detail.milestoneHref ? { milestoneHref: detail.milestoneHref } : {}),
                    ...(detail.builtAt ? { builtAt: detail.builtAt } : {}),
                    ...(detail.commit ? { commit: detail.commit } : {}),
                  }
                : {})}
              pending={entry && pending.deploy}
            />
          )}
          {hold && (
            <>
              {(() => {
                const notice = holdNotice(hold);
                return (
                  <RunHoldNotice
                    tone="warning"
                    title={notice.title}
                    body={notice.body}
                    {...(holdRow
                      ? {
                          action: (
                            <Button
                              variant="contained"
                              size="small"
                              onClick={(event) => {
                                event.stopPropagation();
                                onConfigureConnection(holdRow);
                              }}
                            >
                              Configure
                            </Button>
                          ),
                        }
                      : {})}
                  />
                );
              })()}
              <Typography variant="body2" color="text.secondary">
                {holdSentence(hold)}
              </Typography>
            </>
          )}
          {!hold && deployed.state === "done" && (
            <Typography variant="body2" color="text.secondary">
              {deployedSentence(row, entry ? (deploy?.validation ?? "") : "")}
            </Typography>
          )}
          {!hold && deployed.state === "active" && (
            <Typography variant="body2" color="text.secondary">
              {row.live} of {row.total} components live — the rollout is still converging.
            </Typography>
          )}
          {!hold && deployed.state === "error" && (
            <Typography variant="body2" color="text.secondary">
              A component's release failed — the environment page names which.
            </Typography>
          )}
          {(bound || hold) && (
            <ComponentsGroup
              lines={lines}
              caption={
                hold
                  ? `${row.live} of ${row.total} deployed · on hold`
                  : `${row.live} of ${row.total} live`
              }
            />
          )}
          {entry &&
            (pending.connections ? (
              <Skeleton variant="rounded" height={88} data-testid="connections-skeleton" />
            ) : (
              connections &&
              connections.length > 0 && (
                <ConnectionsGroup
                  lines={connections}
                  caption={connectionsHeadline(connections)}
                  onConfigure={onConfigureConnection}
                />
              )
            ))}
          {holdUnknown ? (
            <Skeleton variant="rounded" height={36} width={220} data-testid="try-skeleton" />
          ) : (
            (bound || hold) && (
              <TryItNow
                projectName={projectName}
                environment={row.environment}
                disabled={Boolean(hold) || !bound}
                variant={promoteReady ? "outlined" : "contained"}
              />
            )
          )}
        </FlowStep>
      );
    }

    if (step.kind === "validation") {
      // Only the entry environment has a verdict to read: the aggregate
      // judges the run against the deployment a build lands in, and names no
      // other environment. Saying anything else here would be inventing one.
      if (!entry) {
        return (
          <FlowStep
            key="validation"
            step={step.index}
            view={{
              state: "pending",
              title: "Validation",
              note: `${row.label} validates. The console reads a verdict only for the environment a build lands in.`,
            }}
            last={isTrailing}
            grow={grow}
          />
        );
      }
      const validating = validationStep(deploy?.validation, validation.counts, deployed);
      return (
        <FlowStep
          key="validation"
          step={step.index}
          view={
            detail.validationUnavailable
              ? {
                  state: "pending",
                  title: "Validation",
                  note: "The run story could not be loaded, so this version's verdict is unknown.",
                }
              : pending.validation
                ? { state: validating.state, title: "Validation" }
                : validating
          }
          last={isTrailing}
          grow={grow}
        >
          {detail.validationUnavailable ? null : pending.validation ? (
            <Skeleton variant="rounded" height={52} data-testid="validation-skeleton" />
          ) : (
            deploy &&
            validating.state !== "pending" && (
              <VerdictBanner
                projectName={projectName}
                validation={deploy.validation}
                verdict={validation.verdict}
                repairing={validation.repairing}
                {...(validation.counts ? { counts: validation.counts } : {})}
              />
            )
          )}
        </FlowStep>
      );
    }

    // Promote. The step's TITLE names the platform's next environment, never
    // a word the console chose.
    const targetLabel = target?.label ?? "";
    const title = `Promote to ${targetLabel}`;
    if (!entry) {
      return (
        <FlowStep
          key="promote"
          step={step.index}
          view={{
            state: "pending",
            title,
            note: `Promotion out of ${row.label} is not available in the console yet.`,
          }}
          last={isTrailing}
          grow={grow}
        />
      );
    }
    // `pending.deploy` belongs here as much as the other two: `promote` is
    // null while the card has no VERSION, and the version comes off the status
    // poll. Without this gate an unsettled poll turned a null promote into
    // "Available once a version is deployed to Development." directly beneath
    // "1 of 1 components live" — the board denying a deployment it had just
    // drawn.
    if (pending.deploy || pending.connections || pending.validation) {
      return (
        <FlowStep
          key="promote"
          step={step.index}
          view={{ state: "pending", title }}
          last={isTrailing}
          grow={grow}
        >
          <Skeleton variant="rounded" height={40} width={280} data-testid="promote-skeleton" />
        </FlowStep>
      );
    }
    if (!promote) {
      // Nothing to promote, for one of two settled reasons. Both are read off
      // rows the page already has — neither is a guess, and the version read
      // behind the second has settled by the time this line is reached.
      const state = target?.state ?? "empty";
      return (
        <FlowStep
          key="promote"
          step={step.index}
          view={{
            state: state === "empty" ? "pending" : "settled",
            title,
            note:
              state === "running"
                ? `${targetLabel} runs a version of its own.`
                : state === "populated"
                  ? `${targetLabel} has a deployment of its own — ${target?.statusLabel}.`
                  : `Available once a version is deployed to ${row.label}.`,
          }}
          last={isTrailing}
          grow={grow}
        />
      );
    }
    return (
      <FlowStep
        key="promote"
        step={step.index}
        view={{ ...promote, title }}
        last={isTrailing}
        grow={grow}
      >
        {promote.missing.map((missing) => (
          <Stack
            key={missing.id}
            direction="row"
            spacing={1.25}
            sx={(theme) => ({
              alignItems: "center",
              px: 1.5,
              py: 1,
              borderRadius: 1,
              border: `1px solid ${alpha(theme.palette.warning.main, 0.35)}`,
              bgcolor: alpha(theme.palette.warning.main, 0.06),
            })}
          >
            <Box component={CircleAlert} size={16} aria-hidden sx={{ color: "warning.main", flexShrink: 0 }} />
            <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }}>
              {missing.name} has no {targetLabel} value
            </Typography>
            <AccentPill
              aria-label={`Configure ${missing.name} for ${targetLabel}`}
              onClick={(event) => {
                event.stopPropagation();
                onConfigurePromoteTarget(missing);
              }}
            >
              Configure
            </AccentPill>
          </Stack>
        ))}
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
          {/* A disabled control swallows its title, so the reason lives beside
              it as a caption the reader always sees. */}
          <Button
            variant="contained"
            disabled={!promote.enabled}
            onClick={(event) => {
              event.stopPropagation();
              onPromote();
            }}
            endIcon={<ArrowRight size={16} aria-hidden />}
          >
            Promote {cardVersion} to {targetLabel}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {promote.reason}
          </Typography>
        </Stack>
      </FlowStep>
    );
  });

  return (
    <Card
      variant="outlined"
      data-testid={`environment-card-${env.name}`}
      // The WHOLE card opens the environment — but not through an <a>
      // wrapper: the card holds buttons, and a button inside an anchor is
      // invalid HTML that browsers re-parent. The controls this card owns
      // stop the click themselves; `closest` covers the shared children whose
      // handlers it does not own (the verdict banner's link, a connection's
      // gear), so no inner control can ever navigate the card by accident.
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a,button")) return;
        onOpen(env.name);
      }}
      sx={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        cursor: "pointer",
        ...(tone !== "neutral" && {
          borderColor: (t) => alpha(t.palette[tone === "primary" ? "primary" : tone].main, 0.35),
        }),
      }}
    >
      <CardContent
        sx={{ display: "flex", flexDirection: "column", flexGrow: 1, "&:last-child": { pb: 2.25 } }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}>
          {/* The name leads at full weight, with the word Environment small
              and muted beside it. A real link, so the card is reachable by
              keyboard and openable in a new tab. */}
          <Typography
            data-testid="environment-card-name"
            variant="h6"
            sx={{ fontWeight: 700, letterSpacing: "-0.01em", minWidth: 0 }}
          >
            <NameLink
              to="/projects/$projectName/deployments/$environment/try-out"
              params={{ projectName, environment: env.name }}
              onClick={(event: React.MouseEvent) => event.stopPropagation()}
              color="inherit"
              underline="hover"
            >
              {row.label}
            </NameLink>
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Environment
          </Typography>
          <StatusChip label={row.status.label} tone={row.status.tone} appearance="soft" dot />
          <Box sx={{ flex: 1 }} />
          {/* The version and its milestone used to sit here as small grey
              text. They lead the Deployment step now (`VersionBlock`), so the
              header carries only how long ago this environment last changed. */}
          {row.deployedAt && (
            <Typography variant="caption" color="text.secondary">
              {agoLabel(row.deployedAt)}
            </Typography>
          )}
        </Stack>
        <Box
          role="list"
          aria-label={`${row.label} flow`}
          sx={{ mt: 2, display: "flex", flexDirection: "column", flexGrow: 1 }}
        >
          {stepNodes}
        </Box>
        {last && (
          <Stack
            direction="row"
            spacing={1.25}
            sx={{
              alignItems: "center",
              mt: 2,
              px: 1.5,
              py: 1.25,
              border: 1,
              borderStyle: "dashed",
              borderColor: "divider",
              borderRadius: 1,
              bgcolor: "action.hover",
            }}
          >
            <Box component={Lock} size={14} aria-hidden sx={{ color: "text.secondary", flexShrink: 0 }} />
            <Typography variant="body2" color="text.secondary">
              Last environment in the pipeline — nothing to promote to.
            </Typography>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
