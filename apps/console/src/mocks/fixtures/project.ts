import type { components } from "../../generated/aep-api";

type ProjectStatus = components["schemas"]["ProjectStatus"];
type ComponentList = components["schemas"]["ComponentList"];
type ProjectBoard = components["schemas"]["ProjectBoard"];
type ErrorModel = components["schemas"]["ErrorModel"];

// Scenario switch for the project overview (issue #77). Toggle in devtools:
//   localStorage.setItem('aep:mock:project',
//     'fresh' | 'spec' | 'building' | 'deployed' | 'deploy-failed' |
//     'repo-error' | 'error')
export type ProjectScenario =
  | "fresh"
  | "spec"
  | "building"
  | "deployed"
  | "deploy-failed"
  | "repo-error"
  | "error";

const REPO_URL = "https://github.com/acme-dev/demo-shop";
const BOARD_URL = "https://github.com/acme-dev/demo-shop/issues";

export const projectStatuses: Record<
  Exclude<ProjectScenario, "error">,
  ProjectStatus
> = {
  // Just created from a prompt: spec derivation hasn't produced anything.
  fresh: {
    phase: "prompt",
    repoStatus: "ready",
    repoUrl: REPO_URL,
    hasSpec: false,
    hasDesign: false,
    hasTasks: false,
    specStatus: "pending",
    designStatus: "pending",
  },
  // Spec collaboration underway, nothing published.
  spec: {
    phase: "spec",
    repoStatus: "ready",
    repoUrl: REPO_URL,
    hasSpec: true,
    hasDesign: true,
    hasTasks: false,
    specStatus: "draft",
    designStatus: "in_progress",
  },
  // v1 published, agents building, nothing deployed yet.
  building: {
    phase: "tasks",
    repoStatus: "ready",
    repoUrl: REPO_URL,
    hasSpec: true,
    hasDesign: true,
    hasTasks: true,
    specStatus: "approved",
    designStatus: "approved",
    specVersion: "v1",
    specDirty: false,
  },
  // v1 deployed to dev successfully; spec has drifted since.
  deployed: {
    phase: "components",
    repoStatus: "ready",
    repoUrl: REPO_URL,
    hasSpec: true,
    hasDesign: true,
    hasTasks: true,
    specStatus: "approved",
    designStatus: "approved",
    specVersion: "v1",
    specDirty: true,
    deployedVersion: "v1",
    deployStatus: "succeeded",
  },
  // v1 build done but the dev deployment failed.
  "deploy-failed": {
    phase: "components",
    repoStatus: "ready",
    repoUrl: REPO_URL,
    hasSpec: true,
    hasDesign: true,
    hasTasks: true,
    specStatus: "approved",
    designStatus: "approved",
    specVersion: "v1",
    specDirty: false,
    deployStatus: "failed",
  },
  // Repo bootstrap went sideways before any spec work.
  "repo-error": {
    phase: "repo-error",
    repoStatus: "error",
    repoErrorMessage: "GitHub App installation lacks repo-creation permission",
    repoUrl: "",
    hasSpec: false,
    hasDesign: false,
    hasTasks: false,
    specStatus: "pending",
    designStatus: "pending",
  },
};

const emptyComponents: ComponentList = { items: [] };

const builtComponents: ComponentList = {
  items: [
    {
      name: "storefront",
      displayName: "Storefront",
      description: "Customer-facing web app",
      type: "webapp",
      status: "active",
    },
    {
      name: "catalog-api",
      displayName: "Catalog API",
      description: "Product catalog service",
      type: "service",
      status: "active",
    },
    {
      name: "orders-api",
      displayName: "Orders API",
      description: "Order processing service",
      type: "service",
      status: "active",
    },
  ],
};

const deployedComponents: ComponentList = {
  items: (builtComponents.items ?? []).map((c) =>
    c.type === "webapp"
      ? { ...c, endpointUrl: "https://storefront.dev.acme-aep.io" }
      : c,
  ),
};

export const projectComponents: Record<
  Exclude<ProjectScenario, "error">,
  ComponentList
> = {
  fresh: emptyComponents,
  spec: emptyComponents,
  building: builtComponents,
  deployed: deployedComponents,
  "deploy-failed": builtComponents,
  "repo-error": emptyComponents,
};

const emptyBoard: ProjectBoard = {
  url: BOARD_URL,
  todo: [],
  inProgress: [],
  onHold: [],
  done: [],
  failed: [],
};

const buildingBoard: ProjectBoard = {
  url: BOARD_URL,
  todo: [
    {
      id: "12",
      title: "Checkout flow with cart persistence",
      url: `${BOARD_URL}/12`,
      componentName: "storefront",
      status: "todo",
    },
  ],
  inProgress: [
    {
      id: "10",
      title: "Product catalog CRUD endpoints",
      url: `${BOARD_URL}/10`,
      componentName: "catalog-api",
      status: "in_progress",
      assignee: "coding-agent",
    },
  ],
  onHold: [],
  done: [
    {
      id: "9",
      title: "Scaffold storefront app shell",
      url: `${BOARD_URL}/9`,
      componentName: "storefront",
      status: "done",
    },
  ],
  failed: [
    {
      id: "11",
      title: "Orders service payment integration",
      url: `${BOARD_URL}/11`,
      componentName: "orders-api",
      status: "failed",
      errorMessage: "Build failed: missing PAYMENT_GATEWAY_URL config",
    },
  ],
};

const doneBoard: ProjectBoard = {
  url: BOARD_URL,
  todo: [],
  inProgress: [],
  onHold: [],
  done: [
    ...(buildingBoard.inProgress ?? []),
    ...(buildingBoard.todo ?? []),
    ...(buildingBoard.failed ?? []),
    ...(buildingBoard.done ?? []),
  ].map((t) => ({ ...t, status: "done" })),
  failed: [],
};

export const projectBoards: Record<
  Exclude<ProjectScenario, "error">,
  ProjectBoard
> = {
  fresh: emptyBoard,
  spec: emptyBoard,
  building: buildingBoard,
  deployed: doneBoard,
  "deploy-failed": doneBoard,
  "repo-error": emptyBoard,
};

export const projectSectionError: ErrorModel = {
  type: "about:blank",
  status: 500,
  title: "Internal Server Error",
  detail: "Mock error scenario for the project overview",
};
