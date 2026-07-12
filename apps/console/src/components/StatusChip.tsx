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

import { Chip } from "@wso2/oxygen-ui";

// Console-wide status/kind chip (Task 4): every domain (task status, alert
// classification, skill origin, project phase, ...) maps its own vocabulary
// to one of these tones in a single place — see each feature's own
// `*chip`/`*Tone` mapping function — so every pill in the app shares one
// size, shape, and palette instead of three divergent chip components.
// `primary` covers a "brand" kind (the org skill origin) that isn't a state
// but still needs to stand out from the neutral default.
export type StatusTone =
  | "success"
  | "info"
  | "warning"
  | "error"
  | "neutral"
  | "primary";

const TONE_COLOR: Record<
  StatusTone,
  "default" | "primary" | "success" | "info" | "warning" | "error"
> = {
  success: "success",
  info: "info",
  warning: "warning",
  error: "error",
  neutral: "default",
  primary: "primary",
};

export function StatusChip({
  label,
  tone,
  variant,
}: {
  label: string;
  tone: StatusTone;
  variant?: "filled" | "outlined";
}) {
  return (
    <Chip
      size="small"
      label={label}
      color={TONE_COLOR[tone]}
      {...(variant ? { variant } : {})}
    />
  );
}
