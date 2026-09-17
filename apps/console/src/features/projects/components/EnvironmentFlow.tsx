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

import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { Box, Skeleton, Stack } from "@wso2/oxygen-ui";
import { ArrowRight } from "@wso2/oxygen-ui-icons-react";
import type { EnvironmentRow } from "../lib/deploymentLedger";
import { findEnvironment, labelOf, type EnvironmentInfo } from "../lib/environments";
import {
  EnvironmentFlowCard,
  type EnvironmentFlowDetail,
  type FlowTarget,
} from "./EnvironmentCards";
import type { ConnectionRow } from "../lib/promotion";
import type { PromotionSource } from "../lib/deploymentFlow";

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
 *  rather than squeezing six environments into a viewport. Wide enough that a
 *  component's name, its kind and its status sit on one line without wrapping,
 *  and that a promote button and its reason caption share a row rather than
 *  stacking — the row is scrollable, so width costs nothing but a scroll. */
const CARD_WIDTH = 600;

/** The row never shrinks below this, however little room the page leaves it.
 *  Past this point a card's steps are more scrollbar than content, and a page
 *  that scrolls is the better of two bad answers. */
const MIN_ROW_HEIGHT = 320;

/** The element that would scroll if this page overflowed. The console's pages
 *  sit inside Oxygen's `PageContent`, which is itself height-bounded and owns
 *  the scroll — but this walks the chain rather than naming it, so the flow
 *  keeps working if a page ever mounts it somewhere else. */
function scrollContainerOf(el: HTMLElement): HTMLElement {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    const overflowY = getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return document.documentElement;
}

/**
 * The row's height budget: everything its scroll container has left after
 * what sits above the row (the page header, a banner) and below it (the
 * content container's own padding). Bounding the row here is what keeps the
 * PAGE from scrolling — a card taller than the budget scrolls inside itself
 * instead of growing the document.
 *
 * Measured, never declared. A `calc(100vh - …)` would have to know the
 * shell's header, its footer, `PageContent`'s padding and whether the
 * project's repo-error banner is showing, and would be silently wrong the day
 * any of them changed.
 *
 * The answer does not depend on the height it sets, which is what keeps this
 * from oscillating: shrinking the row shrinks `scrollHeight` by exactly the
 * same amount, so `below` — and therefore the budget — comes out identical on
 * the next pass.
 */
function useRowHeight(ref: React.RefObject<HTMLDivElement | null>) {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = scrollContainerOf(el);
    const measure = () => {
      const rect = el.getBoundingClientRect();
      // Scroll-space coordinates, so an already-scrolled container measures
      // the same as one at rest.
      const top = rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const below = scroller.scrollHeight - (top + rect.height);
      setHeight(Math.max(MIN_ROW_HEIGHT, Math.round(scroller.clientHeight - top - below)));
    };
    measure();
    // The budget changes when the viewport does, and when the shell gives the
    // page a different pane (the sidebar collapsing, the agent chat opening).
    // Observing the scroller catches all three; jsdom has no ResizeObserver
    // and no layout either, so there is nothing to observe there.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}

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

/** The promotion target as its own row describes it — `null` on the last
 *  environment, and on a `promotesTo` the served list does not name (which is
 *  a pipeline the console cannot follow, not an empty environment). */
function flowTarget(
  environments: EnvironmentInfo[],
  rows: EnvironmentRow[],
  promotesTo: string | undefined,
): FlowTarget | null {
  if (!promotesTo) return null;
  const env = findEnvironment(environments, promotesTo);
  const row = rows.find((r) => r.environment === promotesTo);
  if (!row) return null;
  return {
    label: labelOf(env, promotesTo),
    // A binding is not a running version: a failed, converging or undeployed
    // target is populated too (see `productionLiveSentence`).
    state: !row.cards.some((c) => c.deployment)
      ? "empty"
      : row.status.tone === "success"
        ? "running"
        : "populated",
    statusLabel: row.status.label,
  };
}

/** The environment that promotes INTO `name`, and the version it runs — read
 *  off the served list and the rows, never off position: the source is the
 *  environment whose own `promotesTo` names this one. Null when nothing does
 *  (the pipeline's entry), which is what keeps an entry card from claiming a
 *  promotion would fill it. */
function promotionSource(
  environments: EnvironmentInfo[],
  rows: EnvironmentRow[],
  name: string,
): PromotionSource | null {
  const from = environments.find((e) => e.promotesTo === name);
  if (!from) return null;
  const row = rows.find((r) => r.environment === from.name);
  return { label: labelOf(from, from.name), version: row?.version ?? "" };
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
  const rowRef = useRef<HTMLDivElement>(null);
  const rowHeight = useRowHeight(rowRef);
  // No rows is not "no environments" — it is equally the shape of a read that
  // has not landed or did not come back. The flow refuses to say which, and
  // draws the same shimmer the page draws while it waits.
  if (rows.length === 0) return <EnvironmentFlowSkeleton />;

  return (
    <Stack
      ref={rowRef}
      data-testid="environment-flow"
      direction="row"
      spacing={0}
      sx={{
        // stretch: every card takes the row's height, so the pinned trailing
        // steps land on one line across the pipeline.
        alignItems: "stretch",
        overflowX: "auto",
        // The row is capped at what the page has left, and each card scrolls
        // its own steps rather than growing the document. `maxHeight`, not
        // `height`: a pipeline whose cards all fit takes only the room it
        // needs instead of stretching one short card down the viewport.
        ...(rowHeight !== null && { maxHeight: rowHeight }),
        // Nothing may scroll vertically HERE — the cards are stretched to
        // this row's height, so there is never anything to scroll to, and an
        // `overflowX: auto` alone would compute the Y axis to `auto` too.
        overflowY: "hidden",
        // Room for the cards' shadow and the scrollbar.
        pb: 1.5,
      }}
    >
      {rows.map((row, index) => {
        const env = findEnvironment(environments, row.environment);
        // A row whose environment the list does not describe has no steps to
        // derive — `stepsFor` is the platform's answer, not a guess.
        if (!env) return null;
        // The target is the environment `promotesTo` NAMES — not the next row
        // along. They agree on a linear pipeline, but this file's whole
        // contract is never assuming which environment is which, and a
        // positional neighbour would let the card name one environment and
        // report another's occupancy.
        const target = flowTarget(environments, rows, env.promotesTo);
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
            <Box
              sx={{
                display: "flex",
                flex: "0 0 auto",
                width: CARD_WIDTH,
                maxWidth: "100%",
                // The card is bounded by the row, not by its own content —
                // without this the flex item's automatic minimum size lets a
                // tall card push past the cap it was given.
                minHeight: 0,
              }}
            >
              <EnvironmentFlowCard
                projectName={projectName}
                env={env}
                row={row}
                // The ENTRY environment is `position === 0` — the same test
                // `deploymentLedger` uses to decide which row the deploy
                // aggregate answers for. Two definitions of "entry" would let
                // a card read the aggregate's version under a heading that
                // says a different environment.
                entry={env.position === 0}
                target={target}
                source={promotionSource(environments, rows, row.environment)}
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
