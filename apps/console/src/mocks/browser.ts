import { setupWorker } from "msw/browser";
import { projectHandlers } from "./handlers/project";
import { projectsHandlers } from "./handlers/projects";
import { organizationsHandlers } from "./handlers/organizations";

// Order matters: project-scoped routes (/projects/:name/...) are more
// specific than /projects/:name, so they register first.
export const worker = setupWorker(
  ...projectHandlers,
  ...projectsHandlers,
  ...organizationsHandlers,
);
