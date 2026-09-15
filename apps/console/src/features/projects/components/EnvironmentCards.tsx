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
  productionSentence,
  validationStep,
  type ConnectionLine,
  type DeployHold,
  type PromoteStep,
} from "../lib/deploymentFlow";
import { agoLabel, type EnvironmentRow } from "../lib/deploymentLedger";
import type { ConnectionRow } from "../lib/promotion";
import { AccentPill } from "./AccentPill";
import { ComponentsGroup, ConnectionsGroup } from "./EnvironmentGroups";
import { FlowStep } from "./FlowStep";
import { VerdictBanner } from "./VerdictBanner";

type DeployStage = components["schemas"]["DeployStage"];

const LinkButton = createLink(Button);

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
  /** The header's chip; defaults to the environment's own status. */
  chip?: { label: string; tone: EnvironmentRow["status"]["tone"] };
  /** The header's right-hand fact — "v1 · Milestone #1". */
  aside?: string;
  children: React.ReactNode;
}) {
  const shown = chip ?? { label: row.status.label, tone: row.status.tone };
  const tone = shown.tone;
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
          <StatusChip label={shown.label} tone={shown.tone} appearance="soft" dot />
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
  disabled,
}: {
  projectName: string;
  disabled: boolean;
}) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.75 }}>
      <LinkButton
        variant="contained"
        disabled={disabled}
        to="/projects/$projectName/deployments/$environment"
        params={{ projectName, environment: "development" }}
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
  onPromote,
  onConfigureDevelopment,
  onConfigureProduction,
}: {
  projectName: string;
  development: EnvironmentRow;
  production: EnvironmentRow;
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
        {...(hold ? { chip: { label: "Waiting for configuration", tone: "warning" as const } } : {})}
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
                  environment="development"
                  onConfigure={onConfigureDevelopment}
                />
              )
            )}
            {holdUnknown ? (
              <Skeleton variant="rounded" height={36} width={220} data-testid="try-skeleton" />
            ) : (
              (bound || hold) && (
                <TryItNow projectName={projectName} disabled={Boolean(hold) || !bound} />
              )
            )}
          </FlowStep>

          <FlowStep
            step={2}
            view={pending.validation ? { state: validating.state, title: "Validation" } : validating}
            last={promote === null && !pending.connections}
          >
            {pending.validation ? (
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

      <EnvironmentCard row={production}>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {production.cards.length > 0
            ? `Running · ${production.live} of ${production.total} components live`
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
    </Box>
  );
}
