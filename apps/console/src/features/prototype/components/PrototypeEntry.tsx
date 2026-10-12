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

import { Box, Button, Chip, CircularProgress, Tooltip, Typography } from "@wso2/oxygen-ui";
import { AppWindow } from "@wso2/oxygen-ui-icons-react";
import type { AppPrototype, PrototypeStatus } from "../model/prototypes";

const STATUS: Record<PrototypeStatus, { label: string; color: "default" | "success" | "error" | "info" }> = {
  none: { label: "No prototype", color: "default" },
  ready: { label: "Ready", color: "success" },
  invalid: { label: "Invalid", color: "error" },
  revising: { label: "Revising…", color: "info" },
};

/** The app icon's tile: a spinner while the agent works on the prototype. */
function AppTile({ busy }: { busy: boolean }) {
  return (
    <Box sx={{ width: 56, height: 56, flexShrink: 0, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "action.hover", color: "primary.main" }}>
      {busy ? <CircularProgress size={26} aria-label="Working on the prototype" /> : <AppWindow size={26} aria-hidden />}
    </Box>
  );
}

/**
 * One web application's prototype in the Design card's rail item (L24): its
 * name, status and Review, which opens the full-screen review (#891). It is
 * used there and commented on there; the comments queued in it are Pending
 * drafts on the prototype, sent with Address comments on the Overview.
 */
export function PrototypeEntry({ prototype, primary, onReview }: { prototype: AppPrototype; primary: boolean; onReview: () => void }) {
  const busy = prototype.status === "revising";
  const status = STATUS[prototype.status];
  const name = prototype.files?.manifest.name;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 1, py: 4, border: 1, borderColor: "divider", borderRadius: 3 }}>
      <AppTile busy={busy} />
      <Box sx={{ minWidth: 0, maxWidth: "100%" }}>
        <Typography component="h3" sx={{ fontWeight: 600, fontSize: "1.375rem" }}>
          {name ?? prototype.component}
        </Typography>
        {name && (
          <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace" }}>
            {prototype.component}
          </Typography>
        )}
      </Box>
      <Chip size="small" label={status.label} color={status.color} variant={prototype.status === "none" ? "outlined" : "filled"} />
      {/* Mid-run, a half-written prototype is not a broken one. */}
      {prototype.problem && !busy && (
        <Tooltip title={prototype.problem}>
          <Typography variant="body2" color="error.main">
            The last prototype couldn't be rendered.
          </Typography>
        </Tooltip>
      )}
      {prototype.files ? (
        <Box sx={{ mt: 2 }}>
          <Button variant={primary ? "contained" : "outlined"} onClick={onReview}>
            Review
          </Button>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {busy ? "The agent is writing it." : "There is nothing to review yet."}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: "52ch", px: 2 }}>
        Try it the way its users will. Comment on anything with Comment in the review: your comments stay Pending until you address them from the Overview.
      </Typography>
    </Box>
  );
}
