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

import { Fragment, useMemo, useState } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
} from "@wso2/oxygen-ui";
import { Copy, Ellipsis, GitHub, Play, X } from "@wso2/oxygen-ui-icons-react";
import { Link } from "@tanstack/react-router";
import {
  isReportParseError,
  parseAcceptanceReport,
  tallyOutcomes,
  tallySentence,
} from "@aep/ui-acceptance-view";
import { EmptyState } from "../../../components/EmptyState";
import { LogSection } from "../../../components/LogSection";
import { PageHeader } from "../../../components/PageHeader";
import { SectionCaption } from "../../../components/SectionCaption";
import type { components } from "../../../generated/aep-api";
import { useCancelRun } from "../../builds/api/queries";
import { RunFeed } from "../../builds/components/RunFeed";
import { useTicker } from "../../builds/hooks/useTicker";
import { useProjectStatus } from "../../projects/api/queries";
import { useTask } from "../../tasks/api/queries";
import { statusLine } from "../../tasks/lib/statusLine";
import { useStartValidation, useValidation, useValidationSnapshot } from "../api/queries";
import { validationChip } from "../lib/chip";
import { countsFromScenarios } from "../lib/verdict";
import { ReportCard, type Attempt } from "./ReportCard";
import { ValidationSummaryCard } from "./ValidationSummaryCard";

type ValidationDetail = components["schemas"]["ValidationDetail"];
type MilestoneRunView = components["schemas"]["MilestoneRunView"];

/** Only validation cycles reach this page; the server filtered the rest. */
const VALIDATION_CYCLE = ["validation"] as const;

/**
 * One version's validation: what it concluded, every attempt's report, and the
 * agent's feed.
 *
 * Shaped after the build detail page, because the two answer the same question
 * about the same version and a reader moves between them. What differs is the
 * ordering argument: here the REPORT sits above the log, where builds puts its
 * Tasks. The report is the durable record — committed to git, kept forever —
 * while the feed behind the log is a recording pruned at 30 days (ADR-0027), so
 * on an older version the log has nothing to say and the report still does.
 */
export function ValidationMilestonePage({
  projectName,
  tag,
}: {
  projectName: string;
  tag: string;
}) {
  const detail = useValidation(projectName, tag);
  const data = detail.data;

  // Attempts, newest first, flattened out of the runs. The ordinals count from
  // the OLDEST within each run and the run numbers from the oldest run, so the
  // numbers descend down the page (ADR-0017) — the same rule the log below
  // follows, which is what lets the two lists be read as one history.
  const attempts = useMemo(() => flattenAttempts(data?.runs ?? []), [data?.runs]);
  const newest = attempts[0];

  // The newest attempt's evidence is the page's, not the section's: the verdict
  // card needs its counts whether or not anything is expanded.
  const newestSnapshot = useValidationSnapshot(
    projectName,
    tag,
    newest?.cycle.id ?? "",
    Boolean(newest),
    Boolean(newest?.cycle.endedAt),
  );

  const counts = useMemo(() => {
    const raw = newestSnapshot.data?.report;
    if (!raw) return undefined;
    const parsed = parseAcceptanceReport(raw);
    return isReportParseError(parsed) ? undefined : countsFromScenarios(parsed.scenarios);
  }, [newestSnapshot.data?.report]);

  const countsLine = useMemo(() => {
    const raw = newestSnapshot.data?.report;
    if (!raw) return "";
    const parsed = parseAcceptanceReport(raw);
    return isReportParseError(parsed) ? "" : tallySentence(tallyOutcomes(parsed.scenarios));
  }, [newestSnapshot.data?.report]);

  const state = data?.state ?? "";
  // VALIDATION itself is running, not merely the loop: under `awaiting-fix` the
  // cycle in flight is coding, so the issue's newest comment would be a
  // finished attempt's last words.
  const validating = state === "running";
  const issueNumber = newest?.cycle.validationIssue ?? 0;
  const issue = useTask(projectName, issueNumber, { live: validating });
  // A comment outlives its run, so this is gated: ungated, a closing summary
  // sat under a settled verdict forever.
  const note = validating && issue.data ? statusLine(issue.data) : null;

  // One clock for the page, so every counting surface moves together.
  useTicker(Boolean(newest?.cycle.createdAt) && !newest?.cycle.endedAt);

  const [actionError, setActionError] = useState<string | null>(null);

  const backTo = {
    link: <Link to="/projects/$projectName/validation" params={{ projectName }} />,
    label: "Back to Validation",
  };
  const chip = validationChip(state);

  const header = (actions?: React.ReactNode) => (
    <>
      <PageHeader
        title={`Validation ${tag}`}
        backTo={backTo}
        {...(chip ? { status: { ...chip, variant: "filled" as const } } : {})}
        {...(actions ? { actions } : {})}
      />
      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}
    </>
  );

  if (detail.isPending) {
    return (
      <>
        {header()}
        <Stack sx={{ alignItems: "center", p: 6 }}>
          <CircularProgress size={24} aria-label="Loading validation" />
        </Stack>
      </>
    );
  }

  if (detail.isError || !data) {
    return (
      <>
        {header()}
        <Alert
          severity="error"
          action={<Button onClick={() => void detail.refetch()}>Retry</Button>}
        >
          Failed to load this version's validation
          {detail.error instanceof Error && detail.error.message
            ? `: ${detail.error.message}`
            : ""}
        </Alert>
      </>
    );
  }

  const actions = (
    <ValidationActions
      projectName={projectName}
      tag={tag}
      detail={data}
      hasVerdict={attempts.some((a) => Boolean(a.cycle.validationVerdict))}
      issueUrl={issue.data?.issueUrl}
      runId={newest?.runId}
      onError={setActionError}
    />
  );

  // No attempt has ever been made against this version. Three sentences rather
  // than one, because the reader's next move differs: wait, act, or neither.
  if (attempts.length === 0) {
    return (
      <>
        {header(actions)}
        <EmptyState compact description={emptyReason(state, data.live)} />
      </>
    );
  }

  const live = state === "running" || state === "awaiting-fix";
  // Newest first, so the log's runs match the report's ordering above it.
  const feedRuns = [...data.runs];

  return (
    <>
      {header(actions)}
      <Stack spacing={2}>
        <ValidationSummaryCard
          state={state}
          verdict={newest?.cycle.validationVerdict ?? ""}
          counts={counts}
          countsLine={countsLine}
          startedAt={newest?.cycle.createdAt}
          endedAt={newest?.cycle.endedAt}
          live={live}
          repairing={state === "awaiting-fix"}
          note={note}
        />

        <ReportCard
          projectName={projectName}
          tag={tag}
          attempts={attempts}
          state={state}
          newestSnapshot={newestSnapshot}
        />

        {/* Open while something is running, collapsed once the version has
            settled. LogSection unmounts its children when closed, so a settled
            version opens no SSE connection until the reader asks for one —
            which matters most on an old version, whose recording is likely
            gone anyway. */}
        <LogSection title="Validation log" defaultOpen={live}>
          <Stack spacing={2}>
            {feedRuns.map((run, i) => (
              <Fragment key={run.id}>
                {i === 1 && <SectionCaption>EARLIER VALIDATION RUNS</SectionCaption>}
                <RunFeed
                  projectName={projectName}
                  runId={run.id}
                  cycleKinds={VALIDATION_CYCLE}
                  {...(feedRuns.length > 1 ? { runNumber: feedRuns.length - i } : {})}
                  expandNewest={i === 0}
                />
              </Fragment>
            ))}
          </Stack>
        </LogSection>
      </Stack>
    </>
  );
}

/**
 * Why there is nothing here, and whether the reader should do something.
 *
 * The split on `live` is the same boolean that enables the trigger, so the
 * sentence and the control cannot contradict each other: a version mid-build
 * would otherwise read as one where the reader must act, beside a disabled
 * menu item.
 */
function emptyReason(state: string, live: boolean): string {
  if (state === "skipped") {
    return "This version has no acceptance criteria, so there is nothing to validate against.";
  }
  if (live) {
    return "Nothing validated yet. After a deployment, the deployed system is validated against the acceptance criteria in your spec. Results appear here.";
  }
  return "Nothing validated yet. Run validation to check this version against its acceptance criteria.";
}

/** One attempt per validation cycle, newest first, numbered from the oldest. */
function flattenAttempts(runs: readonly MilestoneRunView[]): Attempt[] {
  const multiRun = runs.length > 1;
  const out: Attempt[] = [];
  runs.forEach((run, runIndex) => {
    const cycles = run.cycles ?? [];
    cycles.forEach((cycle, i) => {
      out.push({
        cycle,
        // Runs arrive newest first; the number counts from the oldest.
        ...(multiRun ? { runNumber: runs.length - runIndex } : {}),
        ordinal: i + 1,
        runId: run.id,
      });
    });
  });
  // Newest attempt first, across runs: a version's attempts can span several.
  return out.reverse();
}

function ValidationActions({
  projectName,
  tag,
  detail,
  hasVerdict,
  issueUrl,
  runId,
  onError,
}: {
  projectName: string;
  tag: string;
  detail: ValidationDetail;
  /** Has any attempt on this version ever produced a verdict? */
  hasVerdict: boolean;
  issueUrl: string | undefined;
  runId: string | undefined;
  onError: (message: string) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const start = useStartValidation(projectName, tag);
  const cancel = useCancelRun(projectName, tag);
  const status = useProjectStatus(projectName);
  const close = () => setAnchor(null);

  // ONE condition the console checks. The endpoint refuses three things — a
  // live run, open work on the version, and a version with no criteria — and
  // only the first is something the console knows for certain. Gating on the
  // verdict too would be inventing a rule the API does not have: re-asking a
  // passed version is exactly what this endpoint is for.
  const blocked = detail.live || start.isPending;
  // "again" only once something has actually answered. It reads wrong on a
  // version that has never been validated, which is a state this page now
  // reaches routinely.
  const startLabel = hasVerdict ? "Run validation again" : "Run validation";
  // ADR-0016 decision 7: cancel follows the LIFECYCLE, not run liveness.
  const cancellable = detail.state === "running" || detail.state === "awaiting-fix";

  return (
    <>
      <IconButton
        aria-label="Validation actions"
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ border: 1, borderColor: "divider" }}
      >
        <Ellipsis size={16} />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close}>
        <Tooltip title={detail.live ? "A run is already working this version." : ""}>
          {/* A span, because a disabled MenuItem swallows the hover the tooltip
              needs — and a disabled item with no reason is a dead control. */}
          <span>
            <MenuItem
              disabled={blocked}
              onClick={() => {
                // Guarded as well as disabled: MUI renders a disabled MenuItem
                // as an `li` with `aria-disabled` and blocks the click through
                // `pointer-events: none`, so the handler is one stylesheet away
                // from firing on a version that already has a run working it.
                if (blocked) return;
                start.mutate(undefined, {
                  onError: (e) => onError(e instanceof Error ? e.message : String(e)),
                });
                close();
              }}
            >
              <Play size={15} style={{ marginRight: 10 }} />
              {startLabel}
            </MenuItem>
          </span>
        </Tooltip>

        <MenuItem
          disabled={!cancellable || !runId || cancel.isPending}
          onClick={() => {
            if (!cancellable || cancel.isPending) return;
            if (runId) {
              cancel.mutate(runId, {
                onError: (e) => onError(e instanceof Error ? e.message : String(e)),
              });
            }
            close();
          }}
        >
          <X size={15} style={{ marginRight: 10 }} />
          Cancel run
        </MenuItem>

        <Divider />

        <MenuItem
          disabled={!issueUrl}
          onClick={() => {
            if (issueUrl) window.open(issueUrl, "_blank", "noopener,noreferrer");
            close();
          }}
        >
          <GitHub size={15} style={{ marginRight: 10 }} />
          View validation issue on GitHub
        </MenuItem>

        <MenuItem
          disabled={!runId}
          onClick={() => {
            if (runId) void navigator.clipboard?.writeText(runId);
            close();
          }}
        >
          <Copy size={15} style={{ marginRight: 10 }} />
          Copy run ID
        </MenuItem>
      </Menu>
      {status.isError && null}
    </>
  );
}
