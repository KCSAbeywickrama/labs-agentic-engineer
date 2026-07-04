import { setupWorker } from "msw/browser";
import { projectHandlers } from "./handlers/project";
import { projectsHandlers } from "./handlers/projects";

// Order matters: project-scoped routes (/projects/:name/...) are more
// specific than /projects/:name, so they register first.
export const worker = setupWorker(...projectHandlers, ...projectsHandlers);
