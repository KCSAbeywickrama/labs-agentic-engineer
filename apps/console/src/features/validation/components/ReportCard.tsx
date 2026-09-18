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
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  CircularProgress,
  Stack,
  Typography,
} from "@wso2/oxygen-ui";
import { ChevronDown } from "@wso2/oxygen-ui-icons-react";
import { AcceptanceView } from "@aep/ui-acceptance-view";
import { GitHubRefChip } from "../../../components/GitHubRefChip";
import { LogSection } from "../../../components/LogSection";
import { StatusChip } from "../../../components/StatusChip";
import type { components } from "../../../generated/aep-api";
import { runStamp } from "../../builds/lib/format";
import { validationChip } from "../lib/chip";
import { verdictSentence } from "../lib/verdict";
import { useValidationSnapshot } from "../api/queries";

type RunCycleView = components["schemas"]["RunCycleView"];

/** One attempt, with the run it belongs to — the page flattens runs into these. */
export interface Attempt {
  cycle: RunCycleView;
  /** The run the attempt belongs to — what the page cancels and copies. */
  runId: string;
  /** Which run, counted from the oldest, or undefined when there is only one. */
  runNumber?: number | undefined;
  /** The cycle's position within its run, counted from the oldest. */
  ordinal: number;
}

/**
 * Every attempt made against this version, newest first, each opening onto the
 * report it produced.
 *
 * The reports are the durable half of the record and the log below is not:
 * run and cycle rows live forever and the report is committed to git, while the
 * agent's feed is a recording pruned at 30 days (ADR-0027). That is why they are
 * two cards rather than one section per attempt holding both — fused, every
 * attempt older than a month would render as a half-empty box.
 *
 * Only the NEWEST attempt's snapshot is fetched with the page; the rest load
 * when their section is opened. A snapshot carries a whole report plus every
 * feature file at that commit, and fetching all of them to render collapsed
 * headers would spend the cost this page was restructured to avoid. Re-opening
 * is free: a merged attempt's evidence is pinned to a commit and cached forever.
 */
export function ReportCard({
  projectName,
  tag,
  attempts,
  state,
  newestSnapshot,
}: {
  projectName: string;
  tag: string;
  /** Newest first. */
  attempts: readonly Attempt[];
  /** The version's lifecycle state, for the newest attempt's sentence. */
  state: string;
  /** The newest attempt's snapshot, already fetched by the page for the card. */
  newestSnapshot: ReturnType<typeof useValidationSnapshot>;
}) {
  // One open section per CARD, not per page. ADR-0017 fixed one-per-page when
  // the log stack was the page's only accordion list; with a report list above
  // it, per-page would mean opening a report collapses the log you opened it to
  // read, and reading the two together is the normal act.
  //
  // Three-valued, like the log's: undefined follows the newest, null is the
  // reader having closed everything, a string is their pick.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const newestId = attempts[0]?.cycle.id ?? null;
  const openId = chosen === undefined ? newestId : chosen;

  const meta =
    attempts.length > 1
      ? `${attempts.length} attempts · last ${runStamp(attempts[0]?.cycle.endedAt) || "in flight"}`
      : undefined;

  return (
    <LogSection
      title="Acceptance report"
      {...(meta ? { meta: <Typography variant="caption" color="text.secondary">{meta}</Typography> } : {})}
    >
      <Stack spacing={0}>
        {attempts.map((attempt, i) => (
          <AttemptSection
            key={attempt.cycle.id}
            projectName={projectName}
            tag={tag}
            attempt={attempt}
            expanded={openId === attempt.cycle.id}
            onToggle={(open) => setChosen(open ? attempt.cycle.id : null)}
            // The newest attempt's sentence is already in the verdict card at
            // the top of the page; repeating it here would say the same thing
            // twice on one screen.
            leadSentence={i > 0}
            state={i === 0 ? state : attempt.cycle.validationVerdict || ""}
            {...(i === 0 ? { snapshot: newestSnapshot } : {})}
          />
        ))}
      </Stack>
    </LogSection>
  );
}

function AttemptSection({
  projectName,
  tag,
  attempt,
  expanded,
  onToggle,
  leadSentence,
  state,
  snapshot,
}: {
  projectName: string;
  tag: string;
  attempt: Attempt;
  expanded: boolean;
  onToggle: (open: boolean) => void;
  leadSentence: boolean;
  state: string;
  /** Supplied for the newest attempt, which the page fetches for its card. */
  snapshot?: ReturnType<typeof useValidationSnapshot>;
}) {
  const { cycle, runNumber, ordinal } = attempt;
  const settled = Boolean(cycle.endedAt);
  // Older attempts fetch on open, following the build page's per-build log.
  // The hook stays unconditional and `enabled` gates it, which is this
  // codebase's rule; what is conditional is only which attempts are asked for.
  const own = useValidationSnapshot(
    projectName,
    tag,
    cycle.id,
    expanded && snapshot === undefined,
    settled,
  );
  const query = snapshot ?? own;

  // ONE string for the heading and for the pull request's accessible name —
  // two runs each hold a "Cycle 1", so the link has to say which box it is in.
  const label =
    runNumber === undefined ? `Cycle ${ordinal}` : `Run ${runNumber} · Cycle ${ordinal}`;
  const chip = validationChip(cycle.validationVerdict || "");

  return (
    <Accordion
      disableGutters
      elevation={0}
      expanded={expanded}
      onChange={(_, open) => {
        onToggle(open);
      }}
      sx={{ "&:before": { display: "none" } }}
    >
      <AccordionSummary expandIcon={<ChevronDown size={16} />}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", width: "100%", pr: 1 }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {label}
          </Typography>
          {chip && (
            <StatusChip
              label={chip.label}
              tone={chip.tone}
              appearance="soft"
              dot
              {...(chip.spokenLabel ? { spokenLabel: chip.spokenLabel } : {})}
            />
          )}
          <Typography variant="caption" color="text.secondary">
            {runStamp(cycle.endedAt) || "in flight"}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          {cycle.prUrl && cycle.prNumber ? (
            <GitHubRefChip
              kind="pull"
              number={cycle.prNumber}
              url={cycle.prUrl}
              name={`${label} pull request`}
              tooltip="Open this attempt's pull request"
              // The summary's whole surface toggles the section — without this,
              // opening the pull request also collapses the report being read.
              onClick={(e) => e.stopPropagation()}
            />
          ) : null}
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <AttemptBody
          query={query}
          cycle={cycle}
          state={state}
          leadSentence={leadSentence}
        />
      </AccordionDetails>
    </Accordion>
  );
}

function AttemptBody({
  query,
  cycle,
  state,
  leadSentence,
}: {
  query: ReturnType<typeof useValidationSnapshot>;
  cycle: RunCycleView;
  state: string;
  leadSentence: boolean;
}) {
  // An attempt that ended without landing has no snapshot to fetch, and the
  // server answers 404 for it. Said here rather than left to the error state,
  // because "this attempt never finished" and "the report could not be read"
  // are different facts a reader acts on differently.
  if (cycle.endedAt && !cycle.mergeSha) {
    return (
      <Typography variant="body2" color="text.secondary">
        This attempt never landed, so it has no report.
      </Typography>
    );
  }
  if (query.isPending) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress size={24} aria-label="Loading the report" />
      </Box>
    );
  }
  if (query.isError) {
    return (
      <Alert severity="info">
        This run produced no report — it reached no usable results.
      </Alert>
    );
  }

  const snapshot = query.data;
  const awaiting = !snapshot?.report;
  return (
    <Stack spacing={1.5}>
      {leadSentence && (
        <Typography variant="body2" color="text.secondary">
          {verdictSentence(cycle.validationVerdict || "", undefined, state)}
        </Typography>
      )}
      <AcceptanceView
        noPadding
        fullWidth
        hideDescription
        features={snapshot?.criteria ?? []}
        awaitingReport={awaiting}
        {...(snapshot?.report ? { report: snapshot.report } : {})}
      />
    </Stack>
  );
}
