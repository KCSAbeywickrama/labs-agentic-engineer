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
  productionLiveSentence,
  productionSentence,
  validationStep,
  type ConnectionLine,
  type DeployHold,
  type PromoteStep,
} from "../lib/deploymentFlow";
import { agoLabel, type EnvironmentRow } from "../lib/deploymentLedger";
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

/** The card's frame: outlined, and edged in the environment's own colour only
 *  when it has something to say — green when serving, red when broken, blue
 *  while moving, amber while a person is holding it up. A quiet environment
 *  keeps the plain divider. */
function EnvironmentCard({
  row,
  chip,
  aside,
  children,
}: {
  row: EnvironmentRow;
  /** The header's chip; defaults to the environment's own status. `null`
   *  draws none — the Development card's rail already says where the
   *  version is, and a chip beside the title said it a second time. */
  chip?: { label: string; tone: EnvironmentRow["status"]["tone"] } | null;
  /** The header's right-hand fact — "v1 · Milestone #1". */
  aside?: string;
  children: React.ReactNode;
}) {
  const shown = chip === undefined ? { label: row.status.label, tone: row.status.tone } : chip;
  const tone = (shown ?? row.status).tone;
  return (
    <Card
      variant="outlined"
      // Both cards fill the row's height, so the pair reads as one band
      // whatever either of them has to say. Development is always the taller —
      // it carries the whole flow — and letting Production stop short of it
      // left the board looking half-drawn.
      sx={{
        height: "100%",
        ...(tone !== "neutral" && {
          borderColor: (t) => alpha(t.palette[tone === "primary" ? "primary" : tone].main, 0.35),
        }),
      }}
    >
      <CardContent sx={{ "&:last-child": { pb: 2.25 } }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: "-0.01em" }}>
            {row.label}
          </Typography>
          {shown && <StatusChip label={shown.label} tone={shown.tone} appearance="soft" dot />}
          <Box sx={{ flex: 1 }} />
          {aside ? (
            <Typography variant="caption" color="text.secondary">
              {aside}
            </Typography>
          ) : (
            row.deployedAt && (
              <Typography variant="caption" color="text.secondary">
                {agoLabel(row.deployedAt)}
              </Typography>
            )
          )}
        </Stack>
        {children}
      </CardContent>
    </Card>
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

/**
 * The two environment cards (ADR-0032): Development is the flow — deployed,
 * validated, promoted, as three numbered steps — and Production is the plain
 * summary of what runs there and what a promotion still needs.
 */
export function EnvironmentCards({
  projectName,
  development,
  production,
  deploy,
  validation,
  version,
  milestone,
  hold,
  componentTypes,
  developmentConnections,
  promote,
  pending,
  validationUnavailable = false,
  onPromote,
  onConfigureDevelopment,
  onConfigureProduction,
}: {
  projectName: string;
  development: EnvironmentRow;
  /** The promotion TARGET's row — absent on a single-environment pipeline,
   *  where there is no second card to draw rather than one with no name. */
  production?: EnvironmentRow | undefined;
  deploy?: DeployStage | undefined;
  /** The dev deployment's validation evidence. */
  validation: { verdict: string; repairing: boolean; counts?: ValidationCounts | undefined };
  /** The version the card is about: the deployed one, or the build's while
   *  nothing is deployed yet (a held version still has a name). */
  version: string;
  /** "Milestone #1", when the version ledger knows it. */
  milestone?: string | undefined;
  /** The newest run parked at the deploy gate, if it is. */
  hold: DeployHold | null;
  /** Component name → its type, for the "web app" / "service" captions. */
  componentTypes: Map<string, string>;
  /** The design's connections as they stand in development; null while the
   *  dependencies read is out or failed — then no group and no blockers. */
  developmentConnections: ConnectionLine[] | null;
  /** Step 3, or null once production runs something. */
  promote: PromoteStep | null;
  /** Which of the reads behind the steps are still out. Each step holds a
   *  skeleton for its own rather than painting a state it may take back a
   *  second later — the card used to fill in one section at a time. */
  pending: { connections: boolean; validation: boolean; hold: boolean };
  /** The deployed version's run story could not be read: step 2 says the
   *  verdict is unknown rather than painting one (the page shows the retry). */
  validationUnavailable?: boolean;
  onPromote: () => void;
  onConfigureDevelopment: (row: ConnectionRow) => void;
  onConfigureProduction: (row: ConnectionRow) => void;
}) {
  const deployed = deployStep(development, hold);
  // While the run story is out a green step 1 may still turn into a hold, so
  // its body waits; the header and the components (already read) stay.
  const holdUnknown = pending.hold && !hold;
  const validating = validationStep(deploy?.validation, validation.counts, deployed);
  const bound = development.cards.some((c) => c.deployment);
  const devLines = development.cards.map((c) =>
    componentLine(c, componentTypes.get(c.componentName), hold),
  );
  const aside = version ? (milestone ? `${version} · ${milestone}` : version) : undefined;
  const holdRow =
    hold && developmentConnections
      ? developmentConnections.find((l) => l.state === "missing" && l.configure)?.row
      : undefined;

  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        // stretch, not start: the two cards share a height (see EnvironmentCard).
        alignItems: "stretch",
        gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1.15fr) minmax(0, 1fr)" },
      }}
    >
      <EnvironmentCard
        row={development}
        chip={null}
        {...(aside ? { aside } : {})}
      >
        <Box role="list" aria-label="Deployment flow" sx={{ mt: 2 }}>
          <FlowStep step={1} view={deployed} ringTone="info">
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
                                onClick={() => onConfigureDevelopment(holdRow)}
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
                {deployedSentence(development, deploy?.validation ?? "")}
              </Typography>
            )}
            {!hold && deployed.state === "active" && (
              <Typography variant="body2" color="text.secondary">
                {development.live} of {development.total} components live — the rollout is still converging.
              </Typography>
            )}
            {!hold && deployed.state === "error" && (
              <Typography variant="body2" color="text.secondary">
                A component's release failed — the environment page names which.
              </Typography>
            )}
            {(bound || hold) && (
              <ComponentsGroup
                lines={devLines}
                caption={
                  hold
                    ? `${development.live} of ${development.total} deployed · on hold`
                    : `${development.live} of ${development.total} live`
                }
              />
            )}
            {pending.connections ? (
              <Skeleton variant="rounded" height={88} data-testid="connections-skeleton" />
            ) : (
              developmentConnections &&
              developmentConnections.length > 0 && (
                <ConnectionsGroup
                  lines={developmentConnections}
                  caption={connectionsHeadline(developmentConnections)}
                  onConfigure={onConfigureDevelopment}
                />
              )
            )}
            {holdUnknown ? (
              <Skeleton variant="rounded" height={36} width={220} data-testid="try-skeleton" />
            ) : (
              (bound || hold) && (
                <TryItNow
                  projectName={projectName}
                  environment={development.environment}
                  disabled={Boolean(hold) || !bound}
                />
              )
            )}
          </FlowStep>

          <FlowStep
            step={2}
            view={
              validationUnavailable
                ? {
                    state: "pending",
                    title: "Validation",
                    note: "The run story could not be loaded, so this version's verdict is unknown.",
                  }
                : pending.validation
                  ? { state: validating.state, title: "Validation" }
                  : validating
            }
            last={promote === null}
          >
            {validationUnavailable ? null : pending.validation ? (
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

          {(pending.connections || pending.validation) && promote !== null ? (
            <FlowStep step={3} view={{ state: "pending", title: "Promote to Production" }} last>
              <Skeleton variant="rounded" height={40} width={280} data-testid="promote-skeleton" />
            </FlowStep>
          ) : promote && (
            <FlowStep step={3} view={promote} last>
              {promote.missing.map((row) => (
                <Stack
                  key={row.id}
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
                    {row.name} has no production value
                  </Typography>
                  <AccentPill
                    aria-label={`Configure ${row.name} for production`}
                    onClick={() => onConfigureProduction(row)}
                  >
                    Configure
                  </AccentPill>
                </Stack>
              ))}
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
                {/* A disabled control swallows its title, so the reason lives
                    beside it as a caption the reader always sees. */}
                <Button
                  variant="contained"
                  disabled={!promote.enabled}
                  onClick={onPromote}
                  endIcon={<ArrowRight size={16} aria-hidden />}
                >
                  Promote {version} to production
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {promote.reason}
                </Typography>
              </Stack>
            </FlowStep>
          )}
        </Box>
      </EnvironmentCard>

      {production && (
      <EnvironmentCard row={production}>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {production.cards.length > 0
            ? productionLiveSentence(production)
            : productionSentence(deploy, promote, hold, version)}
        </Typography>
        {/* An EMPTY production stays an empty state — the gate and nothing
            else. What a promotion needs is step 3's business on the
            Development card; listing components that are not there and
            values that are not set drew a card full of dashes. */}
        {production.cards.length > 0 ? (
          <Stack spacing={1.25} sx={{ mt: 1.75 }}>
            <ComponentsGroup
              lines={production.cards.map((c) =>
                componentLine(c, componentTypes.get(c.componentName), null),
              )}
              caption={`${production.live} of ${production.total} live`}
            />
          </Stack>
        ) : (
          <Stack
            direction="row"
            spacing={1.25}
            sx={{
              alignItems: "center",
              mt: 1.75,
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
              Only a version whose validation has passed can be promoted here.
            </Typography>
          </Stack>
        )}
      </EnvironmentCard>
      )}
    </Box>
  );
}

// ── One environment, as one item in the horizontal flow ─────────────────────
//
// NOT RENDERED BY ANY PAGE YET. `EnvironmentFlow` is its only consumer and
// nothing imports that but its test; the LEGACY two-card `EnvironmentCards`
// above is what the Deployments page still draws. Task 9 wires the flow into
// the page and deletes the legacy half — until then, a change to the card a
// reader sees goes above, not here.

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
 * trailing step is pinned to its bottom, so the promote rows line up across
 * the pipeline however tall each card's component list makes it.
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
  const aside = cardVersion
    ? entry && milestone
      ? `${cardVersion} · ${milestone}`
      : cardVersion
    : undefined;
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

  const stepNodes = steps.map((step, i) => {
    const isTrailing = i === steps.length - 1;
    if (step.kind === "deployment") {
      return (
        <FlowStep
          key="deployment"
          step={step.index}
          view={deployedView}
          ringTone="info"
          last={isTrailing}
          pinned={isTrailing && !last}
        >
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
            pinned={isTrailing && !last}
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
          pinned={isTrailing && !last}
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
          pinned={isTrailing}
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
          pinned={isTrailing}
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
          pinned={isTrailing}
        />
      );
    }
    return (
      <FlowStep
        key="promote"
        step={step.index}
        view={{ ...promote, title }}
        last={isTrailing}
        pinned={isTrailing}
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
          {aside ? (
            <Typography variant="caption" color="text.secondary">
              {aside}
            </Typography>
          ) : (
            row.deployedAt && (
              <Typography variant="caption" color="text.secondary">
                {agoLabel(row.deployedAt)}
              </Typography>
            )
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
