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
  ListingTable,
  Skeleton,
  Stack,
  Typography,
  alpha,
  type Theme,
} from "@wso2/oxygen-ui";
import { ChevronRight } from "@wso2/oxygen-ui-icons-react";
import { EmptyState } from "../../../components/EmptyState";
import { StatusChip } from "../../../components/StatusChip";
import type { components } from "../../../generated/aep-api";
import { runStamp } from "../../builds/lib/format";
import type { ValidationCounts } from "../../validation/lib/verdict";
import {
  milestoneFor,
  validationCell,
  type ValidationAvailability,
  type LedgerEntry,
} from "../lib/deploymentLedger";

type BuildSummary = components["schemas"]["BuildSummary"];

const COLUMNS = [
  { key: "version", label: "Version", width: 96 },
  { key: "milestone", label: "Milestone" },
  { key: "environment", label: "Environment", width: 130 },
  { key: "status", label: "Status", width: 150 },
  { key: "validation", label: "Validation", width: 160 },
  { key: "built", label: "Built", width: 140 },
  { key: "deployed", label: "Deployed", width: 140 },
  { key: "open", label: "", width: 40 },
];

/**
 * The deployments ledger (ADR-0027, artboard 1c; #779): one row per VERSION an
 * environment has run — development's whole version ledger, newest first, and
 * production's current one — the Builds ledger's own table so the two pages
 * read as one system. The platform keeps no deployment RECORD, so a past
 * row carries what the build story knows (the milestone, when it was built)
 * and claims no rollout stamp of its own; only the live row has one.
 */
export function DeploymentsLedger({
  rows,
  builds,
  validation,
  counts,
  validationAvailability,
  onOpen,
}: {
  rows: LedgerEntry[];
  /** The version ledger, for the Milestone cell; undefined while loading. */
  builds: BuildSummary[] | undefined;
  /** deploy.validation — development's verdict lifecycle. */
  validation: string | undefined;
  counts?: ValidationCounts | undefined;
  /** The deployed version's own run read is out or failed: the cell holds a
   *  skeleton, or says Unavailable, rather than "Not run". */
  validationAvailability?: ValidationAvailability | undefined;
  onOpen: (row: LedgerEntry) => void;
}) {
  return (
    <ListingTable.Container sx={{ width: "100%" }}>
      <Stack
        direction="row"
        spacing={1.25}
        sx={{ alignItems: "center", px: 2.25, py: 1.5, borderBottom: 1, borderColor: "divider" }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Deployments
        </Typography>
        <Typography variant="caption" color="text.secondary">
          every version that reached an environment, newest first
        </Typography>
      </Stack>
      {rows.length === 0 ? (
        <EmptyState
          compact
          description="Nothing deployed yet. Your components run here once they are built — each environment shows what is live and where to reach it."
        />
      ) : (
        <ListingTable density="standard">
          <ListingTable.Head>
            <ListingTable.Row>
              {COLUMNS.map((c) => (
                <ListingTable.Cell
                  key={c.key}
                  {...(c.width ? { sx: { width: c.width } } : {})}
                >
                  {c.label}
                </ListingTable.Cell>
              ))}
            </ListingTable.Row>
          </ListingTable.Head>
          <ListingTable.Body>
            {rows.map((row) => (
              <LedgerRow
                key={row.key}
                row={row}
                milestone={milestoneFor(row.version, builds)}
                // The verdict cell is the LIVE development row's: the
                // aggregate's validation names what runs there. A past
                // version's verdict is its page's business.
                validation={
                  row.current
                    ? validationCell(row.environment, validation, counts, validationAvailability)
                    : row.environment === "development"
                      ? null
                      : validationCell(row.environment, validation, counts, validationAvailability)
                }
                onOpen={() => onOpen(row)}
              />
            ))}
          </ListingTable.Body>
        </ListingTable>
      )}
    </ListingTable.Container>
  );
}

function LedgerRow({
  row,
  milestone,
  validation,
  onOpen,
}: {
  row: LedgerEntry;
  milestone: string | undefined;
  validation: ReturnType<typeof validationCell>;
  onOpen: () => void;
}) {
  const live = row.status.live;
  return (
    <ListingTable.Row
      hover
      clickable
      onClick={onOpen}
      aria-label={`Open ${row.label}${row.version ? ` ${row.version}` : ""} deployment`}
      // A converging row tints so the moving environment is findable without
      // reading every status cell. alpha() over a theme colour, so it holds in
      // both schemes — a hardcoded near-white tint would vanish in dark mode.
      {...(live
        ? { sx: { bgcolor: (t: Theme) => alpha(t.palette.info.main, 0.06) } }
        : {})}
    >
      <ListingTable.Cell>
        <Typography
          variant="subtitle2"
          sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
        >
          {row.version ?? "—"}
        </Typography>
      </ListingTable.Cell>

      <ListingTable.Cell sx={{ minWidth: 0 }}>
        <Typography
          variant="body2"
          color={milestone ? "text.primary" : "text.secondary"}
          sx={{
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {milestone ?? "—"}
        </Typography>
      </ListingTable.Cell>

      <ListingTable.Cell>
        <Typography variant="body2" color="text.secondary">
          {row.label}
        </Typography>
      </ListingTable.Cell>

      <ListingTable.Cell>
        <StatusChip
          label={row.status.label}
          tone={row.status.tone}
          appearance="soft"
          dot
        />
      </ListingTable.Cell>

      <ListingTable.Cell>
        {validation?.pending ? (
          <Skeleton variant="rounded" width={96} height={22} data-testid="validation-cell-skeleton" />
        ) : validation ? (
          <StatusChip
            label={validation.label}
            tone={validation.tone}
            appearance="soft"
            dot
            {...(validation.spoken ? { spokenLabel: validation.spoken } : {})}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            —
          </Typography>
        )}
      </ListingTable.Cell>

      <ListingTable.Cell>
        <Typography variant="body2" color="text.secondary">
          {runStamp(row.builtAt) || "—"}
        </Typography>
      </ListingTable.Cell>

      <ListingTable.Cell>
        <Typography variant="body2" color="text.secondary">
          {runStamp(row.deployedAt) || "—"}
        </Typography>
      </ListingTable.Cell>

      <ListingTable.Cell>
        <Box sx={{ display: "flex", color: "text.secondary" }}>
          <ChevronRight size={16} aria-hidden />
        </Box>
      </ListingTable.Cell>
    </ListingTable.Row>
  );
}
