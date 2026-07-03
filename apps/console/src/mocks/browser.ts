import { setupWorker } from "msw/browser";
import { projectsHandlers } from "./handlers/projects";

export const worker = setupWorker(...projectsHandlers);
