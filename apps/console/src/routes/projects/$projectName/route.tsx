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

import { createFileRoute, Outlet, useChildMatches } from "@tanstack/react-router";
import { BuildPickerHost } from "../../../features/builds/components/BuildPicker";
import { useBuildNotes } from "../../../features/builds/hooks/useBuildNotes";
import { ProjectOverview } from "../../../features/projects/components/ProjectOverview";
import { BasePage } from "../../../features/shell/components/BasePage";

// A project: its overview is the base page, and a card route (spec, design,
// builds) draws over it through the outlet. The overview stays mounted while
// a card is open, covered by the card's scrim. The build picker opens over
// either, from wherever a build is offered.
//
// `?chat=open` (#562) is the arrival from New project: the platform has
// already fired `/start`, so the shell opens the chat to show the journey
// underway, then strips the param so a refresh or Back does not reopen a
// panel the user closed. It only raises a panel; it never moves the user.
export const Route = createFileRoute("/projects/$projectName")({
  validateSearch: (search: Record<string, unknown>): { chat?: "open" } =>
    search.chat === "open" ? { chat: "open" as const } : {},
  component: ProjectRoute,
});

/** The chat's line when a build ends, wherever in the project the user is. Renders nothing. */
function BuildNotes({ projectName }: { projectName: string }) {
  useBuildNotes(projectName);
  return null;
}

function ProjectRoute() {
  const { projectName } = Route.useParams();
  const cardOpen = useChildMatches().length > 0;
  return (
    <BuildPickerHost projectName={projectName}>
      <BuildNotes projectName={projectName} />
      <BasePage covered={cardOpen}>
        <ProjectOverview projectName={projectName} />
      </BasePage>
      <Outlet />
    </BuildPickerHost>
  );
}
