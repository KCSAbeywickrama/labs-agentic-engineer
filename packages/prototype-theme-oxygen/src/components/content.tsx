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

/** Content: text, heading, badge, stat, alert, empty state, button and link. */

import { Alert as OxygenAlert, AlertTitle, Box, Button as OxygenButton, Card, CardContent, Chip, Link as OxygenLink, StatCard, Typography } from "@wso2/oxygen-ui";
import type { ThemeAlertProps, ThemeBadgeProps, ThemeButtonProps, ThemeEmptyStateProps, ThemeHeadingProps, ThemeLinkProps, ThemeStatProps, ThemeTextProps } from "@wso2/prototype-kit";

export function Button({ label, emphasis, disabled, onPress }: ThemeButtonProps) {
  return (
    <OxygenButton
      type="button"
      variant={emphasis === undefined ? "outlined" : "contained"}
      color={emphasis === "danger" ? "error" : "primary"}
      disabled={disabled}
      disableRipple
      onClick={onPress}
    >
      {label}
    </OxygenButton>
  );
}

export function Link({ label, onPress }: ThemeLinkProps) {
  return (
    <OxygenLink component="button" type="button" variant="body2" onClick={onPress}>
      {label}
    </OxygenLink>
  );
}

export function Text({ text, tone }: ThemeTextProps) {
  return (
    <Typography variant="body2" color={tone === "primary" ? "text.primary" : "text.secondary"}>
      {text}
    </Typography>
  );
}

export function Heading({ text, level, actions }: ThemeHeadingProps) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
      {level === "page" ? (
        <Typography variant="h4" component="h2">
          {text}
        </Typography>
      ) : (
        <Typography variant="h6" component="h3">
          {text}
        </Typography>
      )}
      {actions !== undefined && <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>{actions}</Box>}
    </Box>
  );
}

export function Badge({ label, tone }: ThemeBadgeProps) {
  return <Chip size="small" label={label} color={tone} variant={tone === "default" ? "outlined" : "filled"} />;
}

export function Stat({ label, value }: ThemeStatProps) {
  return <StatCard label={label} value={value} />;
}

export function Alert({ tone, title, text }: ThemeAlertProps) {
  return (
    <OxygenAlert role="status" severity={tone === "default" ? "info" : tone}>
      {title && <AlertTitle>{title}</AlertTitle>}
      {text}
    </OxygenAlert>
  );
}

export function EmptyState({ title, text, actions }: ThemeEmptyStateProps) {
  return (
    <Card variant="outlined">
      <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, py: 5, textAlign: "center" }}>
        <Typography variant="h6" component="h3">
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {text}
        </Typography>
        {actions !== undefined && <Box sx={{ display: "flex", gap: 1, mt: 1 }}>{actions}</Box>}
      </CardContent>
    </Card>
  );
}
