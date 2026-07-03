import type { components } from "../../generated/aep-api";

type ProjectList = components["schemas"]["ProjectList"];
type ErrorModel = components["schemas"]["ErrorModel"];

// Scenario switch (api-guidelines: mocks must produce empty AND error
// states). Toggle in the browser devtools:
//   localStorage.setItem('aep:mock:projects', 'empty' | 'some' | 'error')
export type ProjectsScenario = "empty" | "some" | "error";

export const emptyProjects: ProjectList = { items: [] };

export const someProjects: ProjectList = {
  items: [
    {
      name: "demo-shop",
      displayName: "Demo Shop",
      description: "Sample project seeded by the mock layer",
      status: "active",
    },
  ],
};

export const projectsError: ErrorModel = {
  status: 500,
  title: "Internal Server Error",
  detail: "Mock error scenario for the projects list",
};
