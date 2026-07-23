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
import { Box, Chip, Popover, Tooltip } from "@wso2/oxygen-ui";
import { Coins } from "@wso2/oxygen-ui-icons-react";
import {
  formatTokens,
  formatUsd,
  totalTokens,
  type PhaseUsage,
  type Usage,
} from "../lib/format";
import { UsageBreakdown } from "./UsageBreakdown";

// The folded cost figure (#245/#291): USD is the ONLY primary value — the token
// detail is a technical view that lives behind an explicit expand (click),
// never in the chip label. A stamped costUsd (incl. $0 for an idle project)
// shows as USD; a null cost (captured usage the platform could not price)
// degrades to tokens. On the Usage page every project cards, idle ones as $0,
// so the chip never hides.
export function UsageChip({
  usage,
  phases,
  label,
  context,
}: {
  usage: Usage;
  /** The per-phase split (#291), shown as a small section in the expand. */
  phases?: PhaseUsage;
  label?: string;
  /** Names what the figure covers in the expanded breakdown, e.g. "Agent spend — build v1". */
  context?: string;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const tokens = totalTokens(usage);

  const figures =
    usage.costUsd !== null
      ? formatUsd(usage.costUsd)
      : `${formatTokens(tokens)} tok`;

  return (
    <>
      <Tooltip title={context ? `${context} — click for token detail` : "Click for token detail"}>
        <Chip
          size="small"
          variant="outlined"
          icon={<Coins size={14} />}
          label={label ? `${label} ${figures}` : figures}
          onClick={(e) => {
            e.stopPropagation();
            setAnchorEl(e.currentTarget);
          }}
        />
      </Tooltip>
      <Popover
        open={anchorEl !== null}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box sx={{ p: 1.5, minWidth: 220 }}>
          <UsageBreakdown usage={usage} phases={phases} context={context} />
        </Box>
      </Popover>
    </>
  );
}
