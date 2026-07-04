import { http, HttpResponse, type JsonBodyType } from "msw";
import {
  projectBoards,
  projectComponents,
  projectSectionError,
  projectStatuses,
  type ProjectScenario,
} from "../fixtures/project";

function scenario(): ProjectScenario {
  return (
    (localStorage.getItem("aep:mock:project") as ProjectScenario | null) ??
    "building"
  );
}

function respond<T extends JsonBodyType>(
  pick: (s: Exclude<ProjectScenario, "error">) => T,
) {
  const s = scenario();
  if (s === "error") {
    return HttpResponse.json(projectSectionError, {
      status: 500,
      headers: { "Content-Type": "application/problem+json" },
    });
  }
  return HttpResponse.json(pick(s));
}

// Project-scoped reads backing the overview page (issue #77). The project
// itself (GET /projects/:projectName) is served by handlers/projects.ts.
export const projectHandlers = [
  http.get("*/api/v1/projects/:projectName/status", () =>
    respond((s) => projectStatuses[s]),
  ),
  http.get("*/api/v1/projects/:projectName/components", () =>
    respond((s) => projectComponents[s]),
  ),
  http.get("*/api/v1/projects/:projectName/board", () =>
    respond((s) => projectBoards[s]),
  ),
];
