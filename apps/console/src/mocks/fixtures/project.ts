import type { components } from "../../generated/aep-api";

type ProjectStatus = components["schemas"]["ProjectStatus"];
type ComponentList = components["schemas"]["ComponentList"];
type TaskView = components["schemas"]["TaskView"];
type TagList = components["schemas"]["TagList"];
type FileMeta = components["schemas"]["FileMeta"];
type FileContent = components["schemas"]["FileContent"];
type ErrorModel = components["schemas"]["ErrorModel"];

// Scenario switch for the project overview (#77/#183) and spec view (#80).
// Toggle in devtools:
//   localStorage.setItem('aep:mock:project',
//     'fresh' | 'spec' | 'spec-failed' | 'building' | 'deploying' |
//     'deployed' | 'deploy-failed' | 'repo-error' | 'error')
export type ProjectScenario =
  | "fresh"
  | "spec"
  | "spec-failed"
  | "building"
  | "deploying"
  | "deployed"
  | "deploy-failed"
  | "repo-error"
  | "error";

const REPO_URL = "https://github.com/acme-dev/demo-shop";
const BOARD_URL = "https://github.com/acme-dev/demo-shop/issues";

// Stage-aggregate shorthands (#183/#184). The overview pipeline renders
// exclusively from these.
type SpecStage = components["schemas"]["SpecStage"];
type BuildStage = components["schemas"]["BuildStage"];
type DeployStage = components["schemas"]["DeployStage"];

const noSpec: SpecStage = { exists: false, version: "", dirty: false, design: false };
const idleBuild: BuildStage = {
  version: "",
  status: "idle",
  tasks: { total: 0, done: 0, failed: 0, active: 0 },
};
const noDeploy: DeployStage = {
  version: "",
  status: "none",
  components: { total: 0, ready: 0 },
};

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
    spec: noSpec,
    build: idleBuild,
    deploy: noDeploy,
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
    spec: { exists: true, version: "", dirty: false, design: true },
    build: idleBuild,
    deploy: noDeploy,
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
    spec: { exists: true, version: "", dirty: false, design: false },
    build: idleBuild,
    deploy: noDeploy,
  },
  // v1 published, agents building, nothing deployed yet. Task counts mirror
  // buildingTasks below (1 failed, 3 still moving).
  building: {
    phase: "tasks",
    repoStatus: "ready",
    repoUrl: REPO_URL,
    hasSpec: true,
    hasDesign: true,
    hasTasks: true,
    specStatus: "approved",
    designStatus: "approved",
    spec: { exists: true, version: "v1", dirty: false, design: true },
    build: {
      version: "v1",
      status: "running",
      tasks: { total: 4, done: 0, failed: 1, active: 3 },
    },
    deploy: noDeploy,
  },
  // v1 built, dev rollout in progress (1 of 3 components ready).
  deploying: {
    phase: "components",
    repoStatus: "ready",
    repoUrl: REPO_URL,
    hasSpec: true,
    hasDesign: true,
    hasTasks: true,
    specStatus: "approved",
    designStatus: "approved",
    spec: { exists: true, version: "v1", dirty: false, design: true },
    build: {
      version: "v1",
      status: "succeeded",
      tasks: { total: 4, done: 4, failed: 0, active: 0 },
    },
    deploy: {
      version: "v1",
      status: "deploying",
      components: { total: 3, ready: 1 },
    },
  },
  // v1 deployed to dev; spec has drifted since (dirty → rendered v1+).
  deployed: {
    phase: "components",
    repoStatus: "ready",
    repoUrl: REPO_URL,
    hasSpec: true,
    hasDesign: true,
    hasTasks: true,
    specStatus: "approved",
    designStatus: "approved",
    spec: { exists: true, version: "v1", dirty: true, design: true },
    build: {
      version: "v1",
      status: "succeeded",
      tasks: { total: 4, done: 4, failed: 0, active: 0 },
    },
    deploy: {
      version: "v1",
      status: "deployed",
      components: { total: 3, ready: 3 },
    },
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
    spec: { exists: true, version: "v1", dirty: false, design: true },
    build: {
      version: "v1",
      status: "succeeded",
      tasks: { total: 4, done: 4, failed: 0, active: 0 },
    },
    deploy: {
      version: "v1",
      status: "failed",
      components: { total: 3, ready: 1 },
    },
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
    spec: noSpec,
    build: idleBuild,
    deploy: noDeploy,
  },
};

const emptyComponents: ComponentList = { items: [] };

const builtComponents: ComponentList = {
  items: [
    {
      name: "storefront",
      displayName: "Storefront",
      description: "Customer-facing web app",
      type: "web-application",
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
    c.type === "web-application"
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
  deploying: builtComponents,
  deployed: deployedComponents,
  "deploy-failed": builtComponents,
  "repo-error": emptyComponents,
};

// Tasks backing list-tasks — the tasks page (#173); the overview no longer
// reads them (#183: counts ride on ProjectStatus.build.tasks).
function task(
  issueNumber: number,
  title: string,
  derivedStatus: string,
  component?: string,
): TaskView {
  return {
    issueNumber,
    title,
    derivedStatus,
    issueUrl: `${BOARD_URL}/${issueNumber}`,
    ...(component !== undefined && { component }),
    attention: null,
    dependsOn: null,
    executions: {},
    hold: false,
    lineage: { specTag: "v1" },
  };
}

const buildingTasks: TaskView[] = [
  task(12, "Checkout flow with cart persistence", "pending", "storefront"),
  task(10, "Product catalog CRUD endpoints", "in_progress", "catalog-api"),
  task(9, "Scaffold storefront app shell", "merged", "storefront"),
  task(11, "Orders service payment integration", "failed", "orders-api"),
];

const doneTasks: TaskView[] = buildingTasks.map((t) => ({
  ...t,
  derivedStatus: "deployed",
}));

export const projectTasks: Record<
  Exclude<ProjectScenario, "error">,
  TaskView[]
> = {
  fresh: [],
  spec: [],
  "spec-failed": [],
  building: buildingTasks,
  deploying: doneTasks,
  deployed: doneTasks,
  "deploy-failed": doneTasks,
  "repo-error": [],
};

// Spec version tags (#117): latest = newest user tag; specDirty = specs/
// moved on GitHub since. The 'deployed' scenario drifts to exercise the
// "draft changes" chip.
const noTags: TagList = { tags: [] };
const v1Tags: TagList = { tags: ["v1"], latest: "v1", specDirty: false };

export const projectTags: Record<
  Exclude<ProjectScenario, "error">,
  TagList
> = {
  fresh: noTags,
  spec: noTags,
  "spec-failed": noTags,
  building: v1Tags,
  deploying: v1Tags,
  deployed: { ...v1Tags, specDirty: true },
  "deploy-failed": v1Tags,
  "repo-error": noTags,
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
| storefront | web-application | Customer-facing UI |
| catalog-api | service | Product catalog CRUD + search |
| orders-api | service | Cart, checkout, order history |

The storefront talks to both services; services share nothing.
`;

// Per-component design files (#80 rich design view): design.json for each of
// the three components named in architectureMd, plus one wireframes.dsl for
// the customer-facing component — enough to exercise the Designs sidebar's
// component grouping and the derived Architecture / Wireframe views.
const storefrontDesignJson = `{
  "name": "storefront",
  "type": "web-application",
  "version": "0.1.0",
  "language": "TypeScript",
  "buildpack": "nodejs",
  "appPath": "storefront",
  "entrypoint": "src/main.tsx",
  "exposure": "internet",
  "description": "Customer-facing storefront UI.",
  "dependencies": [
    { "kind": "component", "name": "catalog-api" },
    { "kind": "component", "name": "orders-api" }
  ]
}`;

const storefrontWireframesDsl = `screen Catalog
  navbar "Demo Shop | Catalog | Cart | Orders" 0,0
  heading "Browse products" 40,60
  input "Search products" 40,110 400x36
  card "Product grid" 40,160 760x420

screen Cart
  navbar "Demo Shop | Catalog | Cart | Orders" 0,0
  heading "Your cart" 40,60
  table "Product | Qty | Price" 40,110 760x300
  button "Checkout" 40,430 160x40
`;

const catalogApiDesignJson = `{
  "name": "catalog-api",
  "type": "service",
  "version": "0.1.0",
  "language": "Go",
  "buildpack": "docker",
  "appPath": "catalog-api",
  "entrypoint": "cmd/main",
  "exposure": "intranet",
  "description": "Product catalog CRUD + search.",
  "dependencies": []
}`;

const ordersApiDesignJson = `{
  "name": "orders-api",
  "type": "service",
  "version": "0.1.0",
  "language": "Go",
  "buildpack": "docker",
  "appPath": "orders-api",
  "entrypoint": "cmd/main",
  "exposure": "intranet",
  "description": "Cart, checkout, and order history.",
  "dependencies": []
}`;

const validationPlan = `# Demo Shop — Validation plan

- Catalog search returns seeded products by name and category.
- Cart contents survive a browser restart.
- Checkout produces an order visible in order history.
- Each service exposes /healthz returning 200.
`;

// Spec files as the Files API serves them (#113): repo-relative paths under
// specs/, metadata (list-files) split from content (read-file).
interface MockSpecFile {
  path: string;
  content: string;
}

const prdOnlyFiles: MockSpecFile[] = [
  { path: "specs/requirements/prd.md", content: seededPrd },
];

const collaborationFiles: MockSpecFile[] = [
  ...prdOnlyFiles,
  { path: "specs/requirements/user-stories.md", content: userStories },
  { path: "specs/design/architecture.md", content: architectureMd },
];

const fullFiles: MockSpecFile[] = [
  ...collaborationFiles,
  {
    path: "specs/design/components/storefront/design.json",
    content: storefrontDesignJson,
  },
  {
    path: "specs/design/components/storefront/wireframes.dsl",
    content: storefrontWireframesDsl,
  },
  {
    path: "specs/design/components/catalog-api/design.json",
    content: catalogApiDesignJson,
  },
  {
    path: "specs/design/components/orders-api/design.json",
    content: ordersApiDesignJson,
  },
  { path: "specs/validation/validation-plan.md", content: validationPlan },
];

export const projectSpecFiles: Record<
  Exclude<ProjectScenario, "error">,
  MockSpecFile[]
> = {
  fresh: prdOnlyFiles,
  spec: collaborationFiles,
  "spec-failed": prdOnlyFiles,
  building: fullFiles,
  deploying: fullFiles,
  deployed: fullFiles,
  "deploy-failed": fullFiles,
  "repo-error": prdOnlyFiles,
};

// Deterministic stand-in for the git blob sha: stable per content revision,
// so the console's (path, sha) content caching behaves like it does live.
function mockSha(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").repeat(5);
}

export function specFileMetas(files: MockSpecFile[]): FileMeta[] {
  return files
    .map((f) => ({
      path: f.path,
      sha: mockSha(f.path + f.content),
      size: f.content.length,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function specFileContent(
  files: MockSpecFile[],
  path: string,
): FileContent | null {
  const file = files.find((f) => f.path === path);
  if (!file) return null;
  return {
    path: file.path,
    content: file.content,
    sha: mockSha(file.path + file.content),
  };
}

export const specFileNotFound = (path: string): ErrorModel => ({
  type: "about:blank",
  status: 404,
  title: "Not Found",
  detail: `no spec file at ${path}`,
});

export const projectSectionError: ErrorModel = {
  type: "about:blank",
  status: 500,
  title: "Internal Server Error",
  detail: "Mock error scenario for the project overview",
};
