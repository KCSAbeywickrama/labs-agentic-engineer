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

import { Alert, Box, Typography } from "@wso2/oxygen-ui";
import { parseFeatureFile, type AcceptanceStep } from "@aep/ui-acceptance-view";
import { soft } from "../../../spec/components/Tag";

// A feature's acceptance tests as the Design card lists them (D14, L25): the
// real .feature file, rule by rule, each band with the requirement it proves
// (`@story-F2.5`), then its scenarios, each one's Given/When/Then in a closed
// <details>, which the browser's find still reaches and opens. Reference
// only: no search, filters, tags, outcomes or source links (that is the
// Validation report's AcceptanceView).

const mono = { fontFamily: "monospace", fontSize: "0.8125rem" } as const;
const STORY_TAG = /^@story-(\S+)$/;

function Steps({ steps }: { steps: readonly AcceptanceStep[] }) {
  return (
    <Box sx={{ pl: 3, py: 0.5 }}>
      {steps.map((st) => (
        <Typography key={st.line} variant="body2" sx={{ ...mono, py: 0.125 }}>
          <Box component="span" sx={{ fontWeight: 700, color: "primary.main", display: "inline-block", minWidth: 48 }}>
            {st.keyword}
          </Box>{" "}
          {st.text}
        </Typography>
      ))}
    </Box>
  );
}

export function AcceptanceList({ path, content }: { path: string; content: string }) {
  const feature = parseFeatureFile(path, content);
  if (!feature) return <Alert severity="warning">This file has no Feature line, so it holds no acceptance tests.</Alert>;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Typography variant="body2" sx={{ ...mono, fontWeight: 600 }}>
        Feature: {feature.name}
      </Typography>
      {feature.background.length > 0 && (
        <Box component="details" sx={{ "& > summary": { cursor: "pointer" } }}>
          <Box component="summary">
            <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
              Background
            </Typography>
          </Box>
          <Steps steps={feature.background} />
        </Box>
      )}
      {feature.rules.map((rule, i) => {
        const requirement = rule.tags.flatMap((t) => STORY_TAG.exec(t)?.[1] ?? []).join(", ");
        return (
          <Box key={`${i}:${rule.text}`} component="section" aria-label={rule.text ? `Rule: ${rule.text}` : "Scenarios"}>
            {rule.text && (
              <Box sx={{ px: 1.5, py: 0.75, borderRadius: 1, bgcolor: soft("primary"), display: "flex", gap: 1.5, alignItems: "baseline" }}>
                {requirement && (
                  <Typography variant="body2" sx={{ ...mono, fontWeight: 700, color: "primary.main" }}>
                    {requirement}
                  </Typography>
                )}
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Rule: {rule.text}
                </Typography>
              </Box>
            )}
            {rule.scenarios.map((sc) => (
              <Box key={sc.line} component="details" sx={{ pl: 1.5, py: 0.5, "& > summary": { cursor: "pointer", py: 0.25 } }}>
                <Box component="summary">
                  <Typography component="span" variant="body2">
                    <b>{sc.kind}:</b> {sc.name}
                  </Typography>
                </Box>
                <Steps steps={sc.steps} />
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}
