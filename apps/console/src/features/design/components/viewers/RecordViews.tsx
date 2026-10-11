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

import { Box, Typography } from "@wso2/oxygen-ui";
import { Check, Minus } from "@wso2/oxygen-ui-icons-react";
import type { ArtifactSource } from "../../api/designModel";

// The design's plain artifacts, drawn by this app from security.json: who can
// do what (roles), and how each permission is enforced (security).

type Source<K extends ArtifactSource["kind"]> = Extract<ArtifactSource, { kind: K }>;

const cellSx = { borderTop: 1, borderColor: "divider", py: 0.875, px: 1.25, fontSize: "0.8125rem" } as const;

/** Who can do what: an action per row, a role per column. */
export function RolesView({ source }: { source: Source<"roles"> }) {
  return (
    <Box>
      <Box sx={{ overflowX: "auto" }}>
        <Box component="table" sx={{ borderCollapse: "collapse", minWidth: 420 }}>
          <thead>
            <tr>
              <Box component="th" />
              {source.roles.map((r) => (
                <Box
                  component="th"
                  key={r}
                  data-anchor={r}
                  sx={{ fontSize: "0.6875rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "text.secondary", fontWeight: 600, px: 1.25, pb: 1 }}
                >
                  {r}
                </Box>
              ))}
            </tr>
          </thead>
          <tbody>
            {source.rows.map((row) => (
              <tr key={row.action}>
                <Box component="th" data-anchor={row.action} sx={{ ...cellSx, textAlign: "start", fontWeight: 500, pl: 0 }}>
                  {row.action}
                </Box>
                {row.grants.map((granted, k) => {
                  const role = source.roles[k] ?? "";
                  return (
                    <Box
                      component="td"
                      key={role}
                      data-anchor={`${role} · ${row.action}`}
                      aria-label={`${role} ${granted ? "can" : "cannot"} ${row.action.toLowerCase()}`}
                      sx={{ ...cellSx, textAlign: "center", color: granted ? "success.main" : "text.disabled" }}
                    >
                      {granted ? <Check size={16} /> : <Minus size={16} />}
                    </Box>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.25 }}>
        {source.note}
      </Typography>
    </Box>
  );
}

/** Who signs in how, and what each grant allows. */
export function SecurityView({ source }: { source: Source<"security"> }) {
  return (
    <Box component="table" sx={{ borderCollapse: "collapse", width: "100%", maxWidth: "72ch" }}>
      <tbody>
        {source.rows.map((row) => (
          <Box component="tr" key={row.subject} data-anchor={row.subject}>
            <Box component="th" sx={{ ...cellSx, pl: 0, textAlign: "start", fontWeight: 600, width: 150, verticalAlign: "top" }}>
              {row.subject}
            </Box>
            <Box component="td" sx={cellSx}>
              {row.rule}
            </Box>
          </Box>
        ))}
      </tbody>
    </Box>
  );
}
