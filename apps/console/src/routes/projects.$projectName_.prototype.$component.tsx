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

import { createFileRoute } from "@tanstack/react-router";
import { PrototypePage } from "../features/spec/components/PrototypePage";

// `$projectName_` (trailing underscore) un-nests this route from the
// /projects/$projectName layout, same trick as `projects.$projectName_.spec`
// — the prototype is a full-screen workspace without the shared project
// header (#252 Task 6).
//
// `?screen=<Name>` deep-links to a specific screen of the component's
// prototype (e.g. a link shared mid-review). `PrototypeView` drives screen
// navigation internally and calls back on every change via `onScreenChange`;
// this route syncs that back into the URL with a REPLACE navigation (not
// push), so clicking through screens doesn't pile up history entries — the
// browser back button leaves the prototype rather than stepping screen by
// screen.
export const Route = createFileRoute(
  "/projects/$projectName_/prototype/$component",
)({
  validateSearch: (search: Record<string, unknown>): { screen?: string } => ({
    ...(typeof search.screen === "string" && search.screen
      ? { screen: search.screen }
      : {}),
  }),
  component: PrototypeRoute,
});

function PrototypeRoute() {
  const { projectName, component } = Route.useParams();
  const { screen } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PrototypePage
      projectName={projectName}
      component={component}
      onScreenChange={(s) => void navigate({ search: { screen: s }, replace: true })}
      {...(screen ? { screen } : {})}
    />
  );
}
