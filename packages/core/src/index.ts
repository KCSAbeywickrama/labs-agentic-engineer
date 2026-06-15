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

import { widgetLabel, type Widget } from "@aep/contracts";

/**
 * Cross-package consumer of the generated contract types. `@aep/core` imports
 * `@aep/contracts`, so its build/typecheck depend (topologically) on the
 * contracts package having run `gen` and `build` first — proving the
 * build-graph contract edge fires across package boundaries (guard #3).
 */
export function describeWidget(w: Widget): string {
  return `widget:${widgetLabel(w)}`;
}
