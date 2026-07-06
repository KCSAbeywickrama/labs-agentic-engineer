import type { components } from "../../generated/aep-api";

type ProjectStatus = components["schemas"]["ProjectStatus"];
type ComponentList = components["schemas"]["ComponentList"];
type ProjectBoard = components["schemas"]["ProjectBoard"];
type SpecBundle = components["schemas"]["SpecBundle"];
type ErrorModel = components["schemas"]["ErrorModel"];

// Scenario switch for the project overview (#77) and spec view (#80).
// Toggle in devtools:
//   localStorage.setItem('aep:mock:project',
//     'fresh' | 'spec' | 'spec-failed' | 'building' | 'deployed' |
//     'deploy-failed' | 'repo-error' | 'error')
export type ProjectScenario =
  | "fresh"
  | "spec"
  | "spec-failed"
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
  // Spec derivation hit a problem; the seeded PRD is still there.
  "spec-failed": {
    phase: "spec",
    repoStatus: "ready",
    repoUrl: REPO_URL,
    hasSpec: true,
    hasDesign: false,
    hasTasks: false,
    specStatus: "failed",
    designStatus: "failed",
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
  "spec-failed": emptyComponents,
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
  "spec-failed": emptyBoard,
  building: buildingBoard,
  deployed: doneBoard,
  "deploy-failed": doneBoard,
  "repo-error": emptyBoard,
};

// Spec bundle backing the spec view (#80). The backend seeds a PRD at repo
// initialization, so requirements is never empty; designs/validation fill
// in as the agents derive them.
const seededPrd = `# Demo Shop — PRD

## Goal

A small storefront where customers browse the product catalog, add items
to a cart, and check out.

## Requirements

- Browse products by category with search.
- Cart persists across sessions.
- Checkout with a mocked payment provider.
- Order history per customer.
`;

const userStories = `# Demo Shop — User stories

- As a shopper, I can search the catalog so that I find products quickly.
- As a shopper, my cart survives a page reload so that I don't lose picks.
- As a shopper, I can check out and see an order confirmation.
- As a returning customer, I can see my past orders.
`;

const architectureMd = `# Demo Shop — Component architecture

Three components behind the project cell:

| Component | Type | Responsibility |
|---|---|---|
| storefront | webapp | Customer-facing UI |
| catalog-api | service | Product catalog CRUD + search |
| orders-api | service | Cart, checkout, order history |

The storefront talks to both services; services share nothing.
`;

const architectureDiagram = `{
  "type": "excalidraw-dsl",
  "components": [
    { "id": "storefront", "kind": "webapp" },
    { "id": "catalog-api", "kind": "service" },
    { "id": "orders-api", "kind": "service" }
  ],
  "edges": [
    { "from": "storefront", "to": "catalog-api" },
    { "from": "storefront", "to": "orders-api" }
  ]
}`;

const validationPlan = `# Demo Shop — Validation plan

- Catalog search returns seeded products by name and category.
- Cart contents survive a browser restart.
- Checkout produces an order visible in order history.
- Each service exposes /healthz returning 200.
`;

const prdOnlySpec: SpecBundle = {
  files: [{ path: "requirements/prd.md", group: "requirements", content: seededPrd }],
};

const collaborationSpec: SpecBundle = {
  files: [
    { path: "requirements/prd.md", group: "requirements", content: seededPrd },
    {
      path: "requirements/user-stories.md",
      group: "requirements",
      content: userStories,
    },
    {
      path: "design/architecture.md",
      group: "designs",
      content: architectureMd,
    },
  ],
};

const fullSpec: SpecBundle = {
  files: [
    ...collaborationSpec.files,
    {
      path: "design/architecture.excalidraw",
      group: "designs",
      content: architectureDiagram,
    },
    {
      path: "validation/validation-plan.md",
      group: "validation",
      content: validationPlan,
    },
  ],
};

export const projectSpecs: Record<
  Exclude<ProjectScenario, "error">,
  SpecBundle
> = {
  fresh: prdOnlySpec,
  spec: collaborationSpec,
  "spec-failed": prdOnlySpec,
  building: fullSpec,
  deployed: fullSpec,
  "deploy-failed": fullSpec,
  "repo-error": prdOnlySpec,
};

export const projectSectionError: ErrorModel = {
  type: "about:blank",
  status: 500,
  title: "Internal Server Error",
  detail: "Mock error scenario for the project overview",
};
