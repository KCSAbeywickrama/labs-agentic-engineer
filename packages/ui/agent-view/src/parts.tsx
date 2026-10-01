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

// The building blocks the three tabs share. Visual vocabulary mirrors
// @aep/ui-design-view's DesignView so the two component-level artifacts
// (Design Overview, Agent spec) read as one family in the spec workspace.

import type { ReactNode } from "react";
import { Box, Typography } from "@wso2/oxygen-ui";

export const mono = { fontFamily: "monospace", fontSize: "0.875rem" } as const;

/** A bordered card; the overline title is optional. */
export function Panel({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2, bgcolor: "background.paper" }}>
      {title || action ? (
        <Box sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
          {title ? (
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ display: "block", fontWeight: 700, letterSpacing: "0.08em" }}
            >
              {title}
            </Typography>
          ) : null}
          <Box sx={{ flexGrow: 1 }} />
          {action}
        </Box>
      ) : null}
      {children}
    </Box>
  );
}

/** A labelled row: label on the left, the value and an optional note on the right. */
export function Row({ label, value, note }: { label: string; value: ReactNode; note?: string | undefined }) {
  return (
    <Box sx={{ display: "flex", gap: 2, alignItems: "baseline", py: 0.75 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 110, flexShrink: 0 }}>
        {label}
      </Typography>
      <Box>
        <Typography component="div" variant="body2">
          {value}
        </Typography>
        {note ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {note}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}
