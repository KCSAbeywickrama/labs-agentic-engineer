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
  Box,
  ButtonBase,
  Card,
  CardContent,
  Chip,
  Collapse,
  Divider,
  LinearProgress,
  Stack,
  Typography,
} from "@wso2/oxygen-ui";
import { ChevronRight } from "@wso2/oxygen-ui-icons-react";
import { Link as RouterLink } from "@tanstack/react-router";
import type { components } from "../../../generated/aep-api";
import { gateSubject } from "../../tasks/lib/issueRows";
import { gateDrive } from "../lib/runView";

type TaskView = components["schemas"]["TaskView"];

/**
 * The milestone beside the run: how much of this version is left.
 *
 * The run card answers "what is happening"; this answers "how much is done".
 * Open work is listed in full because that is what a reader plans against;
 * closed work collapses to a count, because it only needs to be findable.
 *
 * Both populations are WHOLE, closed members included — a version's record is
 * what it did, not only what it has left.
 */
export function MilestonePanel({
  projectName,
  tag,
  work,
  gates,
}: {
  projectName: string;
  tag: string;
  /** The milestone's agent work, open and closed. */
  work: TaskView[];
  /** Every connection gate, resolved ones included. */
  gates: TaskView[];
}) {
  const closed = work.filter((t) => t.derivedStatus === "deployed");
  const failed = work.filter((t) =>
    ["failed", "rejected", "abandoned"].includes(t.derivedStatus),
  );
  const open = work.filter((t) =>
    ["pending", "on_hold"].includes(t.derivedStatus),
  );
  const inProgress = work.filter(
    (t) =>
      !closed.includes(t) && !failed.includes(t) && !open.includes(t),
  );

  const delivered = work.length > 0 && closed.length === work.length;
  const percent = work.length === 0 ? 0 : (closed.length / work.length) * 100;

  const scope = [
    `${work.length} issue${work.length === 1 ? "" : "s"}`,
    ...(gates.length > 0
      ? [`${gates.length} connection${gates.length === 1 ? "" : "s"}`]
      : []),
  ].join(" + ");

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: delivered ? "success.main" : "text.secondary",
          }}
        >
          {delivered ? "MILESTONE · DELIVERED" : "MILESTONE"}
        </Typography>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 0.5 }}>
          {tag}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {scope}
        </Typography>

        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mt: 1.5 }}>
          <LinearProgress
            variant="determinate"
            value={percent}
            aria-label={`${closed.length} of ${work.length} issues closed`}
            sx={{
              flexGrow: 1,
              height: 6,
              borderRadius: 3,
              // MUI tints the track with the bar's colour, which reads as "all
              // done" at 0% — keep the track neutral, colour only the fill.
              bgcolor: "action.selected",
              "& .MuiLinearProgress-bar": { bgcolor: "success.main", borderRadius: 3 },
            }}
          />
          <Typography
            variant="caption"
            sx={{
              color: delivered ? "success.main" : "text.secondary",
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {closed.length} / {work.length} closed
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap", rowGap: 1 }}>
          {inProgress.length > 0 && (
            <Chip size="small" color="info" variant="outlined" label={`${inProgress.length} in progress`} />
          )}
          {open.length > 0 && (
            <Chip size="small" variant="outlined" label={`${open.length} open`} />
          )}
          {closed.length > 0 && (
            <Chip size="small" color="success" variant="outlined" label={`${closed.length} closed`} />
          )}
          {failed.length > 0 && (
            <Chip size="small" color="error" variant="outlined" label={`${failed.length} failed`} />
          )}
        </Stack>

        {/* Failures first: the only bucket that needs a human. */}
        <IssueGroup title="Needs attention" projectName={projectName} issues={failed} tone="error.main" />
        <IssueGroup title="In progress" projectName={projectName} issues={inProgress} tone="info.main" />
        <IssueGroup
          title="Open"
          projectName={projectName}
          issues={open}
          tone="text.disabled"
          note={(t) =>
            t.derivedStatus === "on_hold" && t.blockedBy?.length
              ? `Waiting for ${t.blockedBy.join(", ")}`
              : undefined
          }
        />
        <ClosedGroup title="Closed" projectName={projectName} issues={closed} />

        {gates.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Divider sx={{ mb: 1.5 }} />
            <GroupLabel title="Connections" count={gates.length} />
            <Stack spacing={1} sx={{ mt: 1 }}>
              {gates.map((gate) => (
                <Stack key={gate.issueNumber} direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
                  <Dot color={gateDrive(gate) === "failed" ? "error.main" : gate.derivedStatus === "pending" ? "info.main" : "success.main"} />
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
                    #{gate.issueNumber}
                  </Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    {gateSubject(gate.title)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <Box
      aria-hidden
      sx={{ width: 6, height: 6, mt: 0.75, borderRadius: "50%", flexShrink: 0, bgcolor: color }}
    />
  );
}

function GroupLabel({ title, count }: { title: string; count: number }) {
  return (
    <Typography
      variant="caption"
      sx={{ fontWeight: 700, letterSpacing: "0.08em", color: "text.secondary" }}
    >
      {title.toUpperCase()} · {count}
    </Typography>
  );
}

function IssueRow({
  projectName,
  issue,
  tone,
  note,
}: {
  projectName: string;
  issue: TaskView;
  tone: string;
  note?: string;
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", minWidth: 0 }}>
      <Dot color={tone} />
      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace", flexShrink: 0 }}>
        #{issue.issueNumber}
      </Typography>
      <Box sx={{ minWidth: 0 }}>
        {/* The router's own Link, styled by a Typography child: MUI's
            `component` prop cannot carry TanStack's typed `params`. */}
        <RouterLink
          to="/projects/$projectName/builds/$issueNumber"
          params={{ projectName, issueNumber: issue.issueNumber }}
          style={{ textDecoration: "none" }}
        >
          <Typography
            variant="body2"
            sx={{ color: "text.primary", "&:hover": { textDecoration: "underline" } }}
          >
            {issue.title}
          </Typography>
        </RouterLink>
        {note && (
          <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
            {note}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

function IssueGroup({
  title,
  projectName,
  issues,
  tone,
  note,
}: {
  title: string;
  projectName: string;
  issues: TaskView[];
  tone: string;
  note?: (issue: TaskView) => string | undefined;
}) {
  if (issues.length === 0) return null;
  return (
    <Box sx={{ mt: 2 }}>
      <GroupLabel title={title} count={issues.length} />
      <Stack spacing={1} sx={{ mt: 1 }}>
        {issues.map((issue) => {
          const detail = note?.(issue);
          return (
            <IssueRow
              key={issue.issueNumber}
              projectName={projectName}
              issue={issue}
              tone={tone}
              {...(detail ? { note: detail } : {})}
            />
          );
        })}
      </Stack>
    </Box>
  );
}

/** Closed work: a count by default, the list on demand. */
function ClosedGroup({
  title,
  projectName,
  issues,
}: {
  title: string;
  projectName: string;
  issues: TaskView[];
}) {
  const [open, setOpen] = useState(false);
  if (issues.length === 0) return null;

  return (
    <Box sx={{ mt: 2 }}>
      <Divider sx={{ mb: 1 }} />
      <ButtonBase
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} the ${issues.length} closed issues`}
        sx={{ width: "100%", justifyContent: "flex-start", gap: 1, py: 0.5 }}
      >
        <ChevronRight
          size={13}
          style={{
            flexShrink: 0,
            transition: "transform 0.15s",
            transform: open ? "rotate(90deg)" : "none",
          }}
        />
        <GroupLabel title={title} count={issues.length} />
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        <Stack spacing={1} sx={{ mt: 1 }}>
          {issues.map((issue) => (
            <IssueRow
              key={issue.issueNumber}
              projectName={projectName}
              issue={issue}
              tone="success.main"
            />
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}
