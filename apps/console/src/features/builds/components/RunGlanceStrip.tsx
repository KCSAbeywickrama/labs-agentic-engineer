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

import { Box, Stack, Tooltip, Typography, alpha } from "@wso2/oxygen-ui";
import type { StatusTone } from "../../../components/StatusChip";
import type { GlanceStage } from "../lib/runGlance";
import { stageTone } from "../lib/stage";

/**
 * A tone's palette family. `neutral` is not one — it is the theme's own muted
 * text — so it maps to null and every accent below falls back to a divider or
 * a disabled-text colour rather than inventing a palette entry.
 */
type Accent = "info" | "success" | "warning" | "error" | "primary";

const ACCENT: Record<StatusTone, Accent | null> = {
  neutral: null,
  primary: "primary",
  info: "info",
  success: "success",
  warning: "warning",
  error: "error",
};

/**
 * The run's whole flow in one line: cleared stages behind, the current one
 * badged, the rest ahead greyed.
 *
 * Every stage keeps its tooltip, so the strip loses no information the rail
 * carried — it only stops spending vertical space on stages nobody is waiting
 * on. `nowIndex` is the one stage the NOW panel below narrates; badging exactly
 * that one is what keeps the two in agreement.
 */
export function RunGlanceStrip({
  stages,
  nowIndex,
}: {
  stages: GlanceStage[];
  nowIndex: number | null;
}) {
  if (stages.length === 0) return null;

  return (
    <Stack
      direction="row"
      sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}
    >
      {stages.map(({ stage, step }, i) => {
        const isNow = i === nowIndex;
        const accent = ACCENT[stageTone(stage.state)];
        const done = stage.state === "done";
        const accentColor = accent ? `${accent}.main` : "text.disabled";
        return (
          <Box key={stage.id + step} sx={{ display: "contents" }}>
            {i > 0 && (
              <Box
                aria-hidden
                sx={{
                  width: 24,
                  height: 2,
                  borderRadius: 1,
                  flexShrink: 0,
                  bgcolor: (t) =>
                    done || stages[i - 1]?.stage.state === "done"
                      ? alpha(t.palette.success.main, 0.4)
                      : "divider",
                }}
              />
            )}
            <Tooltip title={stage.note || stage.name}>
              <Stack
                direction="row"
                spacing={0.75}
                sx={{
                  alignItems: "center",
                  px: isNow ? 1.25 : 0.5,
                  py: 0.5,
                  borderRadius: 999,
                  ...(isNow && {
                    bgcolor: (t) =>
                      accent ? alpha(t.palette[accent].main, 0.12) : "action.selected",
                    border: "1px solid",
                    borderColor: (t) =>
                      accent ? alpha(t.palette[accent].main, 0.4) : t.palette.divider,
                  }),
                }}
              >
                <StageDot
                  color={accentColor}
                  active={stage.state === "active"}
                  muted={stage.state === "waiting"}
                />
                <Typography
                  variant="body2"
                  sx={{
                    whiteSpace: "nowrap",
                    fontWeight: isNow ? 600 : 400,
                    color: isNow
                      ? accentColor
                      : done
                        ? "text.primary"
                        : "text.disabled",
                  }}
                >
                  {stage.name}
                </Typography>
                {stage.fact && (
                  <Typography
                    variant="caption"
                    sx={{
                      fontFamily: "monospace",
                      color: done ? "success.main" : "text.secondary",
                    }}
                  >
                    {stage.fact}
                  </Typography>
                )}
                {isNow && (
                  <Typography variant="caption" sx={{ color: accentColor }}>
                    now
                  </Typography>
                )}
              </Stack>
            </Tooltip>
          </Box>
        );
      })}
    </Stack>
  );
}

function StageDot({
  color,
  active,
  muted,
}: {
  color: string;
  active: boolean;
  muted: boolean;
}) {
  if (active) {
    return (
      <Box
        aria-hidden
        sx={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          flexShrink: 0,
          boxSizing: "border-box",
          border: "2px solid",
          borderColor: color,
          "@keyframes stagePulse": { "50%": { opacity: 0.35 } },
          animation: "stagePulse 1.8s ease-in-out infinite",
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      />
    );
  }
  return (
    <Box
      aria-hidden
      sx={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        flexShrink: 0,
        bgcolor: muted ? "text.disabled" : color,
        opacity: muted ? 0.5 : 1,
      }}
    />
  );
}
