import { http, HttpResponse } from "msw";
import {
  emptyProjects,
  projectsError,
  someProjects,
  type ProjectsScenario,
} from "../fixtures/projects";

function scenario(): ProjectsScenario {
  return (
    (localStorage.getItem("aep:mock:projects") as ProjectsScenario | null) ??
    "empty"
  );
}

export const projectsHandlers = [
  // Wildcard prefix: matches whatever runtime API base URL sits in front of
  // /api/v1.
  http.get("*/api/v1/projects", () => {
    switch (scenario()) {
      case "error":
        return HttpResponse.json(projectsError, {
          status: 500,
          headers: { "Content-Type": "application/problem+json" },
        });
      case "some":
        return HttpResponse.json(someProjects);
      default:
        return HttpResponse.json(emptyProjects);
    }
  }),
];
