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

import type { ReactNode } from "react";
import {
  Box,
  CircularProgress,
  Link as MuiLink,
  Skeleton,
  Stack,
  Typography,
} from "@wso2/oxygen-ui";
import { ArrowUpRight } from "@wso2/oxygen-ui-icons-react";
import { StatusChip } from "../../../components/StatusChip";
import type { ValidationCounts } from "../../validation/lib/verdict";
import { shortSha, type ValidationCell } from "../lib/deploymentLedger";

export interface EnvironmentDeploymentSummaryProps {
  /** The version running here; absent when the read settled without one. */
  version?: string | undefined;
  /** Something is bound to this environment. */
  bound: boolean;
  /** The read that names the version is still out — claim nothing yet. */
  pending: boolean;
  /** The milestone this version's work lived in; only the entry environment
   *  can resolve it, so it is absent everywhere else. */
  milestoneNumber?: number | undefined;
  milestoneHref?: string | undefined;
  /** The commit this version shipped. `"loading"` while the run story is out;
   *  absent when nothing names one. */
  commit?: { sha: string; href?: string | undefined } | "loading" | undefined;
  /** The verdict cell, as `validationCell` built it; null where this
   *  environment has no verdict of its own to show. */
  validation?: ValidationCell | null | undefined;
  /** The criteria/report join, when it resolved — shown beside the word. */
  counts?: ValidationCounts | undefined;
  /** When the version's build finished, already formatted. */
  builtAt?: string | undefined;
  /** When this environment last changed, already formatted. */
  deployedAt?: string | undefined;
  live: number;
  total: number;
}

/**
 * Section 1 of the environment page — WHAT RUNS HERE NOW, and where it came
 * from: the version, the milestone it was built for, the commit it shipped,
 * how it validated, then the stamps and the live count on one line beneath.
 *
 * Every cell is omitted rather than dashed when this environment cannot
 * resolve it. Only the pipeline's entry environment has a milestone, a commit
 * and a verdict the console can read; a later environment states its own
 * version and its own stamps and stays silent about the rest, because the
 * entry environment's facts under a later environment's heading are a lie
 * about which deployment the reader is looking at.
 */
export function EnvironmentDeploymentSummary({
  version,
  bound,
  pending,
  milestoneNumber,
  milestoneHref,
  commit,
  validation,
  counts,
  builtAt,
  deployedAt,
  live,
  total,
}: EnvironmentDeploymentSummaryProps) {
  if (pending) {
    return <Skeleton variant="rounded" height={86} data-testid="deployment-summary-skeleton" />;
  }
  if (!bound) {
    return (
      <Typography variant="body2" color="text.secondary">
        Nothing running yet.
      </Typography>
    );
  }

  const cells: Array<{ label: string; value: ReactNode }> = [
    {
      label: "Version",
      value: (
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {version || "Version unknown"}
        </Typography>
      ),
    },
  ];

  if (milestoneNumber) {
    cells.push({
      label: "Milestone",
      value: milestoneHref ? (
        <MuiLink
          href={milestoneHref}
          target="_blank"
          rel="noreferrer"
          aria-label={`Milestone #${milestoneNumber}`}
          variant="subtitle2"
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, fontWeight: 600 }}
        >
          #{milestoneNumber}
          <Box component={ArrowUpRight} size={13} aria-hidden sx={{ flexShrink: 0 }} />
        </MuiLink>
      ) : (
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          #{milestoneNumber}
        </Typography>
      ),
    });
  }

  if (commit) {
    cells.push({
      label: "Commit",
      value:
        commit === "loading" ? (
          <CircularProgress size={14} aria-label="Loading the commit" />
        ) : commit.href ? (
          <MuiLink
            href={commit.href}
            target="_blank"
            rel="noreferrer"
            variant="subtitle2"
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.25,
              fontFamily: "monospace",
              fontWeight: 600,
            }}
          >
            {shortSha(commit.sha)}
            <Box component={ArrowUpRight} size={13} aria-hidden sx={{ flexShrink: 0 }} />
          </MuiLink>
        ) : (
          <Typography variant="subtitle2" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
            {shortSha(commit.sha)}
          </Typography>
        ),
    });
  }

  if (validation) {
    cells.push({
      label: "Validation",
      value: validation.pending ? (
        <Skeleton variant="rounded" width={96} height={22} data-testid="validation-cell-skeleton" />
      ) : (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <StatusChip
            label={validation.label}
            tone={validation.tone}
            appearance="soft"
            dot
            {...(validation.spoken ? { spokenLabel: validation.spoken } : {})}
          />
          {counts && (
            <Typography variant="caption" color="text.secondary">
              {counts.passed}/{counts.total}
            </Typography>
          )}
        </Stack>
      ),
    });
  }

  // Only the facts that answered. A line of "Built —" over an environment
  // whose build stamp nothing recorded says less than saying nothing.
  const stamps: string[] = [];
  if (builtAt) stamps.push(`Built ${builtAt}`);
  if (deployedAt) stamps.push(`Deployed ${deployedAt}`);

  return (
    <Stack spacing={1.5}>
      <Box
        sx={{
          display: "grid",
          gap: 2.5,
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(4, minmax(0, 1fr))" },
        }}
      >
        {cells.map((cell) => (
          <Box key={cell.label} sx={{ minWidth: 0 }}>
            <Typography
              variant="overline"
              color="text.secondary"
              component="div"
              sx={{ fontWeight: 700, letterSpacing: "0.1em" }}
            >
              {cell.label}
            </Typography>
            <Box sx={{ mt: 0.25 }}>{cell.value}</Box>
          </Box>
        ))}
      </Box>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}
      >
        {stamps.map((stamp) => (
          <Typography key={stamp} variant="caption" color="text.secondary">
            {stamp} ·
          </Typography>
        ))}
        <Typography
          variant="caption"
          sx={{ color: live === total && total > 0 ? "success.main" : "text.secondary" }}
        >
          {live} of {total} components live
        </Typography>
      </Stack>
    </Stack>
  );
}
