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

import { useId } from "react";
import {
  Alert,
  Box,
  Button,
  Link as MuiLink,
  ListingTable,
  Skeleton,
  Typography,
  alpha,
  type Theme,
} from "@wso2/oxygen-ui";
import { ArrowUpRight } from "@wso2/oxygen-ui-icons-react";
import { StatusChip } from "../../../components/StatusChip";
import { runStamp } from "../../builds/lib/format";
import { milestoneUrl, type ValidationCell } from "../lib/deploymentLedger";
import type { HistoryRow, HistoryView } from "../lib/environmentHistory";
import { PageSection } from "./PageSection";

/** Why Roll back is drawn but cannot be pressed. Spoken, not only hovered:
 *  `title` alone is a mouse-only explanation (§10 — the write is deferred). */
const ROLLBACK_REASON =
  "Not supported yet — re-pinning an environment to an earlier version is not built.";

const COLUMNS = [
  { key: "version", label: "Version", width: 96 },
  { key: "milestone", label: "Milestone", width: 130 },
  { key: "validation", label: "Validation", width: 170 },
  { key: "deployed", label: "Deployed", width: 150 },
  { key: "until", label: "Until", width: 150 },
  { key: "rollback", label: "", width: 120 },
];

export interface PastDeploymentsProps {
  /** What to call the environment on screen — the pipeline's display name. */
  environmentLabel: string;
  view: HistoryView;
  /** The project's clone URL, for the milestone links. */
  repoUrl?: string | undefined;
  /** The verdict of the version running NOW, as `validationCell` built it.
   *  null where this environment has no verdict of its own to read. */
  validation?: ValidationCell | null | undefined;
  /** The read behind the rows failed, with this message. */
  failed?: string | undefined;
  onRetry?: (() => void) | undefined;
}

/**
 * Section 4 — PAST DEPLOYMENTS. One row per version this environment has run,
 * newest first, the live one marked *Running now* and every row carrying a
 * Roll back that does not work yet.
 *
 * This is where the design's honesty about a platform that records no history
 * lives (§4.3). The entry environment's rows are real: every completed build
 * auto-deploys there, so the version ledger IS its history. Every other
 * environment can only show what runs now, and says so in a sentence rather
 * than borrowing the entry environment's past. An empty table is never drawn
 * over a read that is still out or that failed — both say so instead, because
 * "nothing ever ran here" is a claim, and neither state supports it.
 */
export function PastDeployments({
  environmentLabel: label,
  view,
  repoUrl,
  validation,
  failed,
  onRetry,
}: PastDeploymentsProps) {
  const reasonId = useId();
  const { rows, unrecorded, pending } = view;

  let body: React.ReactNode;
  if (failed) {
    body = (
      <Box sx={{ px: 2.25, py: 1.5 }}>
        <Alert
          severity="warning"
          {...(onRetry ? { action: <Button onClick={onRetry}>Retry</Button> } : {})}
        >
          The version ledger could not be read: {failed} — what ran on {label} cannot be listed
          until it is.
        </Alert>
      </Box>
    );
  } else if (pending) {
    body = (
      <Box sx={{ px: 2.25, py: 1.5 }}>
        <Skeleton variant="rounded" height={120} data-testid="past-deployments-skeleton" />
      </Box>
    );
  } else if (rows.length === 0) {
    body = (
      <Typography variant="body2" color="text.secondary" sx={{ px: 2.25, py: 1.5 }}>
        {unrecorded
          ? "No earlier deployments are recorded for this environment."
          : "Nothing has run here yet."}
      </Typography>
    );
  } else {
    body = (
      <>
        <ListingTable density="standard">
          <ListingTable.Head>
            <ListingTable.Row>
              {COLUMNS.map((c) => (
                <ListingTable.Cell key={c.key} sx={{ width: c.width }}>
                  {c.label}
                </ListingTable.Cell>
              ))}
            </ListingTable.Row>
          </ListingTable.Head>
          <ListingTable.Body>
            {rows.map((row) => (
              <HistoryTableRow
                key={row.key}
                row={row}
                repoUrl={repoUrl}
                validation={row.current ? validation : null}
                reasonId={reasonId}
              />
            ))}
          </ListingTable.Body>
        </ListingTable>
        {unrecorded && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ px: 2.25, py: 1.5, borderTop: 1, borderColor: "divider" }}
          >
            No earlier deployments are recorded for this environment.
          </Typography>
        )}
        {!unrecorded && (
          <Typography
            variant="caption"
            color="text.secondary"
            component="div"
            sx={{ px: 2.25, py: 1.25, borderTop: 1, borderColor: "divider" }}
          >
            Every version built lands here, so these rows come from the version ledger — the
            platform keeps no deployment record of its own.
          </Typography>
        )}
      </>
    );
  }

  return (
    <PageSection
      title="Past deployments"
      caption={
        unrecorded
          ? `what runs on ${label} now`
          : `every version that ran on ${label}, newest first`
      }
      index="04"
      flush
    >
      {body}
      {/* The one description every Roll back points at. Off-screen rather
          than absent: the reason has to reach a reader who never hovers. */}
      <Box id={reasonId} sx={visuallyHidden}>
        {ROLLBACK_REASON}
      </Box>
    </PageSection>
  );
}

const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

function HistoryTableRow({
  row,
  repoUrl,
  validation,
  reasonId,
}: {
  row: HistoryRow;
  repoUrl: string | undefined;
  validation: ValidationCell | null | undefined;
  reasonId: string;
}) {
  const milestoneHref = milestoneUrl(repoUrl, row.milestoneNumber);
  return (
    <ListingTable.Row
      {...(row.current
        ? { sx: { bgcolor: (t: Theme) => alpha(t.palette.success.main, 0.06) } }
        : {})}
    >
      <ListingTable.Cell>
        <Typography
          data-testid="history-version"
          variant="subtitle2"
          sx={{ fontWeight: row.current ? 700 : 600, fontVariantNumeric: "tabular-nums" }}
        >
          {row.version ?? "Unknown"}
        </Typography>
      </ListingTable.Cell>

      <ListingTable.Cell>
        {row.milestoneNumber ? (
          milestoneHref ? (
            <MuiLink
              href={milestoneHref}
              target="_blank"
              rel="noreferrer"
              aria-label={`Milestone #${row.milestoneNumber}`}
              variant="body2"
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}
            >
              #{row.milestoneNumber}
              <Box component={ArrowUpRight} size={13} aria-hidden sx={{ flexShrink: 0 }} />
            </MuiLink>
          ) : (
            <Typography variant="body2">#{row.milestoneNumber}</Typography>
          )
        ) : (
          <Dash />
        )}
      </ListingTable.Cell>

      <ListingTable.Cell>
        {validation?.pending ? (
          <Skeleton
            variant="rounded"
            width={96}
            height={22}
            data-testid="validation-cell-skeleton"
          />
        ) : validation ? (
          <StatusChip
            label={validation.label}
            tone={validation.tone}
            appearance="soft"
            dot
            {...(validation.spoken ? { spokenLabel: validation.spoken } : {})}
          />
        ) : (
          // A superseded version's verdict is not something the console reads:
          // the deploy aggregate names the version running NOW, and nothing
          // else records a past one's. "Not recorded" is that, said plainly —
          // a green tick borrowed from the live row would be a lie.
          <Typography variant="body2" color="text.secondary">
            Not recorded
          </Typography>
        )}
      </ListingTable.Cell>

      <ListingTable.Cell>
        <Typography variant="body2" color="text.secondary">
          {runStamp(row.deployedAt) || "—"}
        </Typography>
      </ListingTable.Cell>

      <ListingTable.Cell>
        {row.current ? (
          <StatusChip label="Running now" tone="success" appearance="soft" dot />
        ) : (
          <Typography data-testid="history-until" variant="body2" color="text.secondary">
            {runStamp(row.until) || "—"}
          </Typography>
        )}
      </ListingTable.Cell>

      <ListingTable.Cell>
        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            disabled
            title={ROLLBACK_REASON}
            aria-describedby={reasonId}
          >
            Roll back
          </Button>
        </Box>
      </ListingTable.Cell>
    </ListingTable.Row>
  );
}

function Dash() {
  return (
    <Typography variant="body2" color="text.secondary">
      —
    </Typography>
  );
}
