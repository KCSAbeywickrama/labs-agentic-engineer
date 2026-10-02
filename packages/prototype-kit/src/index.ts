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

/**
 * `@wso2/prototype-kit`: everything a `prototype.tsx` imports besides React —
 * `defineApp`, the hooks, and the component catalog — plus the theme contract
 * a theme implements. There is no escape hatch to raw HTML, styles or the
 * network.
 */

export { defineApp, type PrototypeAppDefinition } from "./app.js";
export {
  PROTOTYPE_TODAY,
  useCollection,
  useDisplayState,
  useNav,
  useParams,
  useRole,
  useToday,
  useValue,
  type Collection,
  type KitNav,
} from "./runtime/hooks.js";
export type { Pressable } from "./runtime/press.js";
export type { SelectableRootProps } from "./runtime/selectable.js";
export type { KitComponentName, KitComponentProps, PrototypeTheme, ThemeRegistry } from "./theme/contract.js";

export { Detail, Grid, Screen, Split, Stack } from "./components/layout.js";
export type {
  DetailField,
  DetailProps,
  GridProps,
  ScreenProps,
  SplitProps,
  StackProps,
  ThemeDetailProps,
  ThemeGridProps,
  ThemeScreenProps,
  ThemeSplitProps,
  ThemeStackProps,
} from "./components/layout.js";
export { Alert, Badge, Button, EmptyState, Heading, Link, Stat, Text } from "./components/content.js";
export type {
  AlertProps,
  BadgeProps,
  ButtonProps,
  EmptyStateProps,
  HeadingProps,
  LinkProps,
  StatProps,
  TextProps,
  ThemeAlertProps,
  ThemeBadgeProps,
  ThemeButtonProps,
  ThemeEmptyStateProps,
  ThemeHeadingProps,
  ThemeLinkProps,
  ThemeStatProps,
  ThemeTextProps,
  Tone,
} from "./components/content.js";
