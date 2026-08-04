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

import { Box, Button, CircularProgress, alpha } from "@wso2/oxygen-ui";
import { ArrowRight, Check, Minus, X } from "@wso2/oxygen-ui-icons-react";
import { createLink } from "@tanstack/react-router";
import { validationView, type StageTone } from "../lib/pipeline";

// The deployments board's validation control. It keeps the name the codebase,
// the tests and the copy docs all use — "the validation chip" — but it renders
// as a pill BUTTON-LINK rather than a Chip, and that is the whole point of the
// component existing: as a chip it sat between the card count and the spec
// version, two inert pills of identical size, weight and variant, so nothing
// said that this one navigates. A leading status mark, a semibold label and a
// trailing arrow make it out-rank its neighbours; the arrow is the affordance.
//
// Button rather than Chip because Chip has NO trailing-icon slot: the
// alternatives are `deleteIcon` + `onDelete` (which nests button semantics in a
// link) or a composed label node plus `& .MuiChip-icon` margin patches. Button
// gives startIcon/endIcon, hover and ripple, and `createLink(Button)` is already
// the console's "go to this page" pattern
// (features/builds/components/DeploymentStage.tsx).
const LinkButton = createLink(Button);

// The palette family each tinted tone reads from. `ghost` and `neutral` have
// none and fall back to text.secondary below. Named rather than inlined so the
// console's tone vocabulary stays separable from MUI's palette — the same shape
// StatusChip's TONE_PALETTE has.
const TONE_PALETTE = {
  info: "info",
  warning: "warning",
  success: "success",
  error: "error",
} as const satisfies Partial<Record<StageTone, string>>;

type TintedTone = keyof typeof TONE_PALETTE;

function isTinted(tone: StageTone): tone is TintedTone {
  return tone in TONE_PALETTE;
}

type Glyph = "spinner" | "check" | "cross" | "dash";

// The leading status mark, keyed on the raw validation value rather than on the
// tone: `running` and `partial` are both `info` and must not read the same.
//
// The rule is MOVING SPINS, SETTLED GETS A DISC. The two spinners are the states
// with a cycle actually in flight — validation running, and the coding cycle
// repairing what validation found.
//
// Three glyphs cover six settled states, and a collision inside one tone is
// deliberate: at 11px a glyph carries valence, the label carries identity.
// `failed` and `unreported` are both a red cross and read apart by their labels.
const GLYPH: Record<string, Glyph> = {
  running: "spinner",
  "awaiting-fix": "spinner",
  passed: "check",
  partial: "check",
  failed: "cross",
  unreported: "cross",
  inconclusive: "dash",
  skipped: "dash",
};

const GLYPH_ICON = { check: Check, cross: X, dash: Minus } as const;

// StatusMark is a tone-filled disc with a bare glyph inside — composed rather
// than taken from lucide's circle family because those are outlines: rendering
// CircleCheck with fill="currentColor" fills its check path too and the glyph
// disappears, and patching it per-icon with `& circle` / `& path` selectors
// breaks on icons that carry a second <circle> (CircleHelp's dot). Composing it
// is the same move StatusChip's `dot` makes, one size up with a glyph in it.
//
// Decorative in every branch: the label already names the state, so the mark is
// hidden from the accessible name. DeploymentsPage.test.tsx asserts that name is
// exactly "Validated", which is what pins this.
function StatusMark({ tone, glyph }: { tone: StageTone; glyph: Glyph }) {
  const family = isTinted(tone) ? TONE_PALETTE[tone] : null;

  if (glyph === "spinner") {
    return (
      <CircularProgress
        size={14}
        thickness={5}
        color={family ?? "inherit"}
        aria-hidden
        data-testid="validation-status-mark"
      />
    );
  }

  const Icon = GLYPH_ICON[glyph];
  return (
    <Box
      aria-hidden
      data-testid="validation-status-mark"
      sx={(theme) => ({
        width: 18,
        height: 18,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        bgcolor: family
          ? theme.palette[family].main
          : theme.palette.text.secondary,
        // The glyph strokes in currentColor, so the disc sets it.
        color: family
          ? theme.palette[family].contrastText
          : theme.palette.background.paper,
      })}
    >
      <Icon size={11} strokeWidth={3} />
    </Box>
  );
}

/**
 * ValidationChip renders the whole-project validation state as a link to the
 * Validation page, which owns the report, the run's validation feed and the
 * issue/PR links across every lifecycle state — so the chip needs no external
 * URL and opens the same place in every state.
 *
 * It takes the RAW `deploy.validation` value, not a pre-computed view, for two
 * reasons: the glyph cannot be derived from the tone (see GLYPH), and "there is
 * nothing to show" then has exactly one owner — this component returns null
 * wherever validationView does.
 */
export function ValidationChip({
  projectName,
  validation,
}: {
  projectName: string;
  validation: string;
}) {
  const view = validationView(validation);
  if (!view) return null;

  // The shared labels are lowercase so they read mid-sentence in the overview
  // deploy line; leading a control, this one is capitalized — the same
  // conversion VerdictTile makes for its headline.
  const label = view.label.charAt(0).toUpperCase() + view.label.slice(1);
  const glyph = GLYPH[validation];

  return (
    <LinkButton
      to="/projects/$projectName/validation"
      params={{ projectName }}
      title="Open validation"
      size="small"
      color="inherit"
      disableElevation
      {...(glyph ? { startIcon: <StatusMark tone={view.tone} glyph={glyph} /> } : {})}
      endIcon={<ArrowRight size={14} aria-hidden />}
      sx={(theme) => {
        const main = isTinted(view.tone)
          ? theme.palette[TONE_PALETTE[view.tone]].main
          : theme.palette.text.secondary;
        return {
          borderRadius: 999,
          minWidth: 0,
          px: 1.25,
          py: 0.25,
          fontWeight: 600,
          // body2 keeps the pill from growing the column-header row it shares
          // with two size="small" chips.
          fontSize: theme.typography.body2.fontSize,
          lineHeight: 1.6,
          color: main,
          border: `1px solid ${alpha(main, 0.3)}`,
          // The same soft tint StatusChip's `soft` appearance uses, so a tinted
          // status pill and this tinted control share one palette. One formula
          // covers `neutral` too: alpha over text.secondary lands where
          // action.hover does, without a second branch.
          bgcolor: alpha(main, 0.14),
          // Deepening the tint and the border is the console's whole hover
          // vocabulary (ComponentsList, SpecQuestionForm, TurnBlock), down to the
          // 120ms. Nothing in the app moves on hover, so the arrow stays put —
          // it is the affordance standing still.
          transition: "background-color 120ms, border-color 120ms",
          "&:hover, &.Mui-focusVisible": {
            bgcolor: alpha(main, 0.24),
            borderColor: alpha(main, 0.5),
          },
          // An explicit ring, because the tinted background above overrides the
          // one MUI's text variant would otherwise show on focus — without this
          // a keyboard user tabs onto the pill with nothing to see.
          "&.Mui-focusVisible": {
            outline: `2px solid ${alpha(main, 0.6)}`,
            outlineOffset: 2,
          },
          "& .MuiButton-startIcon": { mr: 0.75, ml: -0.25 },
          "& .MuiButton-endIcon": { ml: 0.5, mr: -0.25 },
        };
      }}
    >
      {label}
    </LinkButton>
  );
}
