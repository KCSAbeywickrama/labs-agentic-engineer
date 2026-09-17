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

import { Fragment } from "react";
import { Box, Skeleton, Stack } from "@wso2/oxygen-ui";
import { ArrowRight } from "@wso2/oxygen-ui-icons-react";
import type { EnvironmentRow } from "../lib/deploymentLedger";
import { findEnvironment, labelOf, type EnvironmentInfo } from "../lib/environments";
import { EnvironmentFlowCard, type EnvironmentFlowDetail } from "./EnvironmentCards";
import type { ConnectionRow } from "../lib/promotion";

// The Deployments board as the PIPELINE it actually is: one full-detail card
// per environment, left to right in the platform's promotion order, with an
// arrow between them. However many environments the pipeline has — one, two,
// six — the row is the same shape, because nothing here counts them.
//
// The order is the order `environmentRows` handed over. This file never
// sorts, never reads `position` to re-derive it, and never assumes which
// environment is which: every fact a card states comes off its own
// `EnvironmentInfo` and its own row.

/** A fixed card width, so the cards are the same shape and the row scrolls
 *  rather than squeezing six environments into a viewport. */
const CARD_WIDTH = 384;

/**
 * The flow while the pipeline is not known. It states NOTHING — not "no
 * environments", not "nothing deployed": the environments list is a network
 * read, and a shimmer is the only honest thing to draw before it lands or
 * when it failed. The page above owns the error alert and the retry.
 */
export function EnvironmentFlowSkeleton() {
  return (
    <Box data-testid="environment-flow-skeleton" aria-label="Loading the deployment pipeline">
      <Skeleton variant="rounded" height={320} />
    </Box>
  );
}

export interface EnvironmentFlowProps extends EnvironmentFlowDetail {
  projectName: string;
  /** The pipeline's environments, in promotion order, exactly as served. */
  environments: EnvironmentInfo[];
  /** One row per environment, in the same order (`environmentRows`). */
  rows: EnvironmentRow[];
  /** Open an environment's page — the whole card is this control. */
  onTryOut: (environment: string) => void;
  onPromote: () => void;
  onConfigureConnection: (row: ConnectionRow) => void;
  onConfigurePromoteTarget: (row: ConnectionRow) => void;
}

export function EnvironmentFlow({
  projectName,
  environments,
  rows,
  onTryOut,
  onPromote,
  onConfigureConnection,
  onConfigurePromoteTarget,
  ...detail
}: EnvironmentFlowProps) {
  // No rows is not "no environments" — it is equally the shape of a read that
  // has not landed or did not come back. The flow refuses to say which, and
  // draws the same shimmer the page draws while it waits.
  if (rows.length === 0) return <EnvironmentFlowSkeleton />;

  return (
    <Stack
      data-testid="environment-flow"
      direction="row"
      spacing={0}
      sx={{
        // stretch: every card takes the tallest card's height, so the pinned
        // trailing steps land on one line across the pipeline.
        alignItems: "stretch",
        overflowX: "auto",
        // Room for the cards' shadow and the scrollbar.
        pb: 1.5,
      }}
    >
      {rows.map((row, index) => {
        const env = findEnvironment(environments, row.environment);
        // A row whose environment the list does not describe has no steps to
        // derive — `stepsFor` is the platform's answer, not a guess.
        if (!env) return null;
        const target = env.promotesTo;
        const next = rows[index + 1];
        return (
          <Fragment key={row.environment}>
            {index > 0 && (
              <Stack
                aria-hidden
                sx={{ alignSelf: "center", justifyContent: "center", px: 1, flexShrink: 0 }}
              >
                <Box component={ArrowRight} size={20} sx={{ color: "text.disabled" }} />
              </Stack>
            )}
            <Box sx={{ display: "flex", flex: "0 0 auto", width: CARD_WIDTH, maxWidth: "100%" }}>
              <EnvironmentFlowCard
                projectName={projectName}
                env={env}
                row={row}
                entry={index === 0}
                targetLabel={
                  target ? labelOf(findEnvironment(environments, target), target) : ""
                }
                targetRunning={Boolean(next?.cards.some((c) => c.deployment))}
                detail={detail}
                onOpen={onTryOut}
                onPromote={onPromote}
                onConfigureConnection={onConfigureConnection}
                onConfigurePromoteTarget={onConfigurePromoteTarget}
              />
            </Box>
          </Fragment>
        );
      })}
    </Stack>
  );
}
