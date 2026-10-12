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
import { createLink, useNavigate } from "@tanstack/react-router";
import { Box, ButtonBase, NativeSelect, Typography } from "@wso2/oxygen-ui";
import { PHONE } from "../../shell/layout";
import { soft } from "../../spec/components/Tag";
import type { DesignDependency } from "../api/designModel";
import { COMMENTS_KEY, dependencyKey } from "../model/artifacts";
import type { DesignItem } from "../model/designFiles";
import { changedSinceChecked, commentsOn, isChecked, isWaiting } from "../model/review";
import type { DesignCard } from "../useDesignCard";

// The Design card's rail (L21): Overview, Comments, then the design's files
// in the order Design makes them, each component's artifact under it, then
// the Dependencies (with what blocks a build), Flows and the acceptance tests
// under their headings. An item shows only once its file exists. At phone
// width it gives way to a picker above the pane.

const ItemLink = createLink(ButtonBase);

type Tone = "success" | "warning" | "info";

interface Entry {
  /** `?art=`; none for the Overview. */
  art: string | undefined;
  label: string;
  status: string;
  tone?: Tone | undefined;
  nested?: boolean;
  mono?: boolean;
  /** The heading it sits under, shown before the first entry that has it. */
  section?: string | null;
}

const kicker = {
  fontSize: "0.6875rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 600,
  color: "text.secondary",
} as const;

const SCENARIO = /^\s*(Scenario Outline|Scenario|Example):/gm;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** One short status per item: comments waiting first, then where its check stands. */
function itemStatus(card: DesignCard, item: DesignItem): Pick<Entry, "status" | "tone"> {
  const review = card.review.review;
  const waiting = commentsOn(review, item.path).filter(isWaiting).length;
  if (waiting > 0) return { status: `💬 ${waiting}`, tone: "info" };
  if (item.body.kind === "acceptance") return { status: plural(item.body.content.match(SCENARIO)?.length ?? 0, "scenario") };
  if (!item.checkable) return { status: "" };
  const hash = card.hashes[item.path];
  if (isChecked(review, item.path, hash)) return { status: "checked", tone: "success" };
  if (changedSinceChecked(review, item.path, hash)) return { status: "changed", tone: "warning" };
  return { status: "to check" };
}

/** Every entry the rail lists, in its order. */
function entries(card: DesignCard): Entry[] {
  const waiting = card.waiting.length;
  const all = card.review.review.artifacts.reduce((n, a) => n + (a.comments?.length ?? 0), 0);
  const out: Entry[] = [
    { art: undefined, label: "Overview", status: "" },
    {
      art: COMMENTS_KEY,
      label: "Comments",
      status: waiting > 0 ? `${waiting} pending` : all > 0 ? String(all) : "",
      tone: waiting > 0 ? "info" : undefined,
    },
  ];
  const blocking = (d: DesignDependency): Entry => ({
    art: dependencyKey(d.featureId),
    label: `${d.featureId} waits on ${d.needs}`,
    status: `blocks ${d.featureId}`,
    tone: "warning",
    nested: true,
    section: "Dependencies",
  });
  const files: Entry[] = card.items.map((item) => ({
    art: item.key,
    label: item.label,
    ...itemStatus(card, item),
    nested: item.nested,
    mono: item.mono,
    section: item.section,
  }));
  // What blocks a build goes with the dependencies, after their files: where they are, or would be.
  const lastDependency = card.items.map((i) => i.section).lastIndexOf("Dependencies");
  const afterComponents = card.items.findIndex((i) => i.section === "Flows" || i.section === "Acceptance tests" || i.key === "decisions");
  const at = lastDependency >= 0 ? lastDependency + 1 : afterComponents >= 0 ? afterComponents : files.length;
  files.splice(at, 0, ...card.blocking.map(blocking));
  out.push(...files);
  return out;
}

function RailItem({ projectName, entry, selected }: { projectName: string; entry: Entry; selected: boolean }) {
  return (
    <ItemLink
      to="/projects/$projectName/design"
      params={{ projectName }}
      search={entry.art ? { art: entry.art } : {}}
      aria-current={selected ? "page" : undefined}
      sx={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: 1,
        py: 0.75,
        pr: 1.25,
        pl: entry.nested ? 2.75 : 1.25,
        borderRadius: 1.5,
        fontSize: "0.8125rem",
        textAlign: "start",
        color: selected ? "primary.main" : "text.primary",
        fontWeight: selected ? 600 : 400,
        bgcolor: selected ? soft("primary") : "transparent",
        "&:hover": { bgcolor: selected ? soft("primary") : "action.hover" },
      }}
    >
      <Box component="span" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...(entry.mono ? { fontFamily: "monospace" } : {}) }}>
        {entry.label}
      </Box>
      <Box component="span" sx={{ ml: "auto", fontSize: "0.6875rem", fontWeight: 400, whiteSpace: "nowrap", color: entry.tone ? `${entry.tone}.main` : "text.secondary" }}>
        {entry.status}
      </Box>
    </ItemLink>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <Typography component="h3" sx={{ ...kicker, px: 1.25, pt: 1, pb: 0.25 }}>
      {children}
    </Typography>
  );
}

export function DesignRail({ projectName, card, current }: { projectName: string; card: DesignCard; current: string | undefined }) {
  const list = entries(card);
  return (
    <Box
      component="nav"
      aria-label="Design"
      sx={{
        width: 260,
        flexShrink: 0,
        borderRight: 1,
        borderColor: "divider",
        overflowY: "auto",
        px: 1,
        pt: 1.25,
        pb: 10,
        display: "flex",
        flexDirection: "column",
        gap: 0.125,
        [PHONE]: { display: "none" },
      }}
    >
      {list.map((entry, i) => (
        <Box key={entry.art ?? "overview"} sx={{ display: "contents" }}>
          {entry.section && entry.section !== list[i - 1]?.section && <Heading>{entry.section}</Heading>}
          <RailItem projectName={projectName} entry={entry} selected={entry.art === current} />
        </Box>
      ))}
    </Box>
  );
}

/** At phone width the rail gives way to this picker above the pane. */
export function DesignPicker({ projectName, card, current }: { projectName: string; card: DesignCard; current: string | undefined }) {
  const navigate = useNavigate();
  const list = entries(card);
  return (
    <Box sx={{ display: "none", mb: 2.5, [PHONE]: { display: "flex" } }}>
      <NativeSelect
        value={current ?? ""}
        onChange={(e) =>
          void navigate({ to: "/projects/$projectName/design", params: { projectName }, search: e.target.value ? { art: e.target.value } : {} })
        }
        inputProps={{ "aria-label": "Open" }}
        sx={{ width: "100%" }}
      >
        {list.map((entry) => (
          <option key={entry.art ?? "overview"} value={entry.art ?? ""}>
            {[entry.section, entry.label].filter(Boolean).join(" › ")}
            {entry.status ? ` · ${entry.status}` : ""}
          </option>
        ))}
      </NativeSelect>
    </Box>
  );
}
