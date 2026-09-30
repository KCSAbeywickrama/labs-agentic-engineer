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

import { useState, type ReactNode } from "react";
import { Box, ButtonBase, Typography } from "@wso2/oxygen-ui";
import { StoryRef } from "../../design/components/viewers/StoryRef";
import { Tag } from "../../spec/components/Tag";
import type { FeatureResults, ScenarioResult } from "../model/validation";
import { LogTail, StepIcon } from "./RunParts";

// Validation, grouped by feature: a box per feature with its tally, a row per
// scenario tagged with the story it proves. A row opens for its evidence; a
// failing one says what it expected and what it got, and carries the build's
// next step (its fix) right there.

function groupTag(group: FeatureResults, settled: boolean): { tone: "success" | "warning" | "primary" | null; text: string } {
  const total = group.scenarios.length;
  if (!settled) return { tone: "primary", text: group.judged ? `${group.passed} of ${total} so far` : `${total} to run` };
  return group.passed === total
    ? { tone: "success", text: `${group.passed}/${total} passing` }
    : { tone: "warning", text: `${group.passed}/${total} passing` };
}

function ScenarioRow({
  projectName,
  scenario,
  actions,
}: {
  projectName: string;
  scenario: ScenarioResult;
  actions: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const judged = scenario.outcome !== "pending";
  const failed = judged && scenario.outcome !== "passed";
  return (
    <Box sx={{ borderTop: 1, borderColor: "divider" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1.5 }}>
        <ButtonBase
          disabled={!judged}
          aria-expanded={judged ? open : undefined}
          onClick={() => setOpen((v) => !v)}
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            justifyContent: "flex-start",
            alignItems: "flex-start",
            gap: 1.25,
            px: 1.5,
            py: 1,
            textAlign: "start",
            "&:hover": judged ? { bgcolor: "action.hover" } : {},
          }}
        >
          <StepIcon
            state={!judged ? "queued" : failed ? "failed" : "done"}
            label={!judged ? "Not run yet" : failed ? "Failed" : "Passed"}
          />
          <Box component="span" sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <Typography component="span" variant="body2" color={judged ? "text.primary" : "text.secondary"}>
              {scenario.name}
            </Typography>
            {failed && scenario.expected && (
              <Typography component="span" variant="caption" color="error.main">
                Expected {scenario.expected}, got {scenario.got ?? "something else"}
              </Typography>
            )}
          </Box>
        </ButtonBase>
        {scenario.story && <StoryRef projectName={projectName} id={scenario.story} tag />}
      </Box>
      {open && judged && (
        <Box sx={{ pl: 5.25, pr: 1.5, pb: 1.5, display: "flex", flexDirection: "column", gap: 0.75 }}>
          {failed ? (
            <>
              <Typography variant="body2">
                <b>Expected</b> {scenario.expected}
              </Typography>
              <Typography variant="body2">
                <b>Got</b> {scenario.got}
              </Typography>
            </>
          ) : (
            <Typography variant="caption" color="text.secondary">
              {scenario.story ? `Proves ${scenario.story}. ` : ""}
              {scenario.excerpt.filter((l) => !l.startsWith(" ")).length} steps passed.
            </Typography>
          )}
          <LogTail lines={scenario.excerpt} bordered />
          {failed && actions}
        </Box>
      )}
    </Box>
  );
}

export function ValidationByFeature({
  projectName,
  groups,
  settled,
  failingActions,
}: {
  projectName: string;
  groups: FeatureResults[];
  settled: boolean;
  /** The build's next steps, shown under a failing scenario's evidence. */
  failingActions: ReactNode;
}) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {groups.map((group) => {
        const tag = groupTag(group, settled);
        return (
          <Box
            key={group.id}
            component="section"
            aria-label={`${group.name} validation`}
            sx={{ border: 1, borderColor: "divider", borderRadius: 2.5, overflow: "hidden" }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1.125, bgcolor: "background.default" }}>
              <Typography component="span" sx={{ fontFamily: "monospace", fontSize: "0.75rem", color: "text.secondary" }}>
                {group.id}
              </Typography>
              <Typography component="h4" variant="body2" sx={{ fontWeight: 600 }}>
                {group.name}
              </Typography>
              <Box sx={{ ml: "auto" }}>
                <Tag tone={tag.tone}>{tag.text}</Tag>
              </Box>
            </Box>
            {group.scenarios.map((s, i) => (
              <ScenarioRow key={`${s.name}-${i}`} projectName={projectName} scenario={s} actions={failingActions} />
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

/** Before validation runs: what it will run. */
export function ValidationToCome({ features }: { features: string[] }) {
  return (
    <Box sx={{ border: 1, borderStyle: "dashed", borderColor: "divider", borderRadius: 2.5, px: 2, py: 1.5 }}>
      <Typography variant="body2" color="text.secondary">
        Runs when the code is done: every scenario of {features.join(" and ") || "the features built"}, each tagged
        with the story it proves.
      </Typography>
    </Box>
  );
}
