# Multi-Environment Deployments — Implementation Plan 1: Foundation and the Deployments Flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Deployments page renders one full-detail card per environment in the platform's promotion order, however many there are, as a horizontal left-to-right flow — and the bottom ledger is gone.

**Architecture:** OpenChoreo's `DeploymentPipeline.promotionPaths` is the source of truth for which environments exist and in what order; the BFF already walks it. This plan widens `EnvironmentDTO` to carry display name, production flag, validation setting and position, teaches the console to read that list instead of a two-element literal, and replaces the two hardcoded cards with a rendered row.

**Tech Stack:** Go 1.25 (BFF, oapi-codegen strict server), TypeScript/React 19 + Oxygen UI + React Query (console), vitest, OpenAPI 3 contract at `packages/contracts/api/v1/openapi.yaml`.

**Spec:** [`docs/design/multi-environment-deployments.md`](multi-environment-deployments.md) — read it before starting. This plan implements §3, §4.1, §4.2 and §5. The environment page (§6) and settings tab (§7) are plans 2 and 3.

## Global Constraints

- **The contract is the source of truth.** Edit `packages/contracts/api/v1/openapi.yaml`, then regenerate. Never hand-edit `services/aep-api/internal/gen/**` or `apps/console/src/generated/aep-api.d.ts`. CI has a freshness gate that fails on drift.
- Regenerate Go with `cd services/aep-api && make gen-api`; regenerate console types with `cd apps/console && pnpm gen`.
- **Node:** prefix commands with `PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH`.
- **Console checks, run before every commit:** `cd apps/console && pnpm run typecheck && pnpm exec vitest run src/features/projects src/routes && pnpm exec eslint src/features/projects`.
- **Annotation keys, verbatim:** display name `openchoreo.dev/display-name` (constant `AnnotationKeyDisplayName` already exists); validation `aep.wso2.com/validation`, values `"on"` / `"off"`, **absent means `"off"`**.
- **Copy rules:** an environment is titled `<Display Name>` with the word `Environment` beside it, faded. "Connections" is called **dependencies** in all new and touched copy. The promote step and its button name the target: *Promote to Staging*, *Promote v4 to Staging*.
- **No invented data.** A version that cannot be resolved reads *Version unknown*. Never guess.
- **Order comes from the list the BFF returned** — the console must never sort environments by name, by `isProduction`, or by any heuristic.
- TDD throughout: failing test first, watch it fail, minimal implementation, watch it pass, commit.

---

### Task 1: Widen `EnvironmentDTO` in the contract

**Files:**
- Modify: `packages/contracts/api/v1/openapi.yaml:4950-4957`
- Regenerate: `services/aep-api/internal/gen/models_gen.go`, `apps/console/src/generated/aep-api.d.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `EnvironmentDTO { name: string; displayName: string; isProduction: boolean; validation: "on" | "off"; position: number; promotesTo?: string }` in both Go (`gen.EnvironmentDTO`) and TS (`components["schemas"]["EnvironmentDTO"]`).

- [ ] **Step 1: Edit the schema**

In `packages/contracts/api/v1/openapi.yaml`, replace the `EnvironmentDTO` block:

```yaml
    EnvironmentDTO:
      additionalProperties: false
      description: >-
        One environment in the org's deployment pipeline, in promotion order.
        `name` is the OpenChoreo Environment's immutable identity; everything
        else is presentation or flow. `validation` says whether this
        environment runs a validation step — absent on the object means "off".
      properties:
        name:
          type: string
          description: Immutable OpenChoreo Environment name. Bindings and cell namespaces reference it.
        displayName:
          type: string
          description: From the openchoreo.dev/display-name annotation; falls back to a titlecased name.
        isProduction:
          type: boolean
          description: From Environment.spec.isProduction. Never inferred from the name.
        validation:
          type: string
          enum: [on, off]
          description: From the aep.wso2.com/validation annotation. Absent on the object means off.
        position:
          type: integer
          format: int32
          description: 0-based index in promotion order. The array is already ordered; this is a convenience.
        promotesTo:
          type: string
          description: The next environment's name. Omitted on the last environment, which has no promote step.
      required:
      - name
      - displayName
      - isProduction
      - validation
      - position
      type: object
```

- [ ] **Step 2: Regenerate both sides**

```bash
cd services/aep-api && make gen-api
cd ../../apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm gen
```

- [ ] **Step 3: Verify the generated types carry the new fields**

```bash
grep -A10 "type EnvironmentDTO struct" services/aep-api/internal/gen/models_gen.go
grep -A12 "EnvironmentDTO: {" apps/console/src/generated/aep-api.d.ts
```

Expected: both show `displayName`, `isProduction`, `validation`, `position`, `promotesTo`. The Go build will now fail in `handlers.go` because the struct literal is missing required fields — that is Task 3's job.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/api/v1/openapi.yaml services/aep-api/internal/gen apps/console/src/generated
git commit -m "contract: an environment carries its display name, order and validation setting"
```

---

### Task 2: The OpenChoreo environment reader returns more than names

**Files:**
- Modify: `services/aep-api/internal/clients/openchoreo/` — the type backing `provisioning.EnvironmentLister`
- Modify: `services/aep-api/internal/dependencies/provisioning/service.go:304-319`
- Test: `services/aep-api/internal/dependencies/provisioning/provisioning_component_test.go`

**Interfaces:**
- Consumes: Task 1's `gen.EnvironmentDTO`.
- Produces:

```go
// provisioning.EnvironmentInfo — one environment as the BFF reads it from OC.
type EnvironmentInfo struct {
    Name         string
    DisplayName  string
    IsProduction bool
    Validation   string // "on" | "off"; "off" when the annotation is absent
}

// EnvironmentLister gains:
List(ctx context.Context, orgID string) ([]EnvironmentInfo, error)
```

Keep `ListNames` until Task 3 has migrated the last caller, then delete it in Task 3's commit.

- [ ] **Step 1: Write the failing test**

In `provisioning_component_test.go`, alongside the existing `TestProvisioningComponent_ListOrgEnvironments_*` tests:

```go
func TestProvisioning_EnvironmentInfo_AnnotationsAndFallbacks(t *testing.T) {
	t.Parallel()
	svc := provisioning.NewService(provisioning.Deps{
		Environments: &cEnvs{infos: []provisioning.EnvironmentInfo{
			{Name: "development", DisplayName: "Development", IsProduction: false, Validation: "on"},
			{Name: "staging-local", DisplayName: "", IsProduction: false, Validation: ""},
			{Name: "production", DisplayName: "Production", IsProduction: true, Validation: "off"},
		}},
	})
	got, err := svc.ListOrgEnvironments(context.Background(), "acme")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("want 3 environments, got %d", len(got))
	}
	// An absent display-name annotation falls back to a titlecased name.
	if got[1].DisplayName != "Staging Local" {
		t.Errorf("display name fallback = %q, want %q", got[1].DisplayName, "Staging Local")
	}
	// An absent validation annotation is OFF — a new environment does not
	// silently start running validation.
	if got[1].Validation != "off" {
		t.Errorf("absent validation annotation = %q, want %q", got[1].Validation, "off")
	}
	if !got[2].IsProduction {
		t.Error("production environment lost its isProduction flag")
	}
}
```

Extend the `cEnvs` test double in that file with an `infos []provisioning.EnvironmentInfo` field and a `List` method returning it.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd services/aep-api && go test ./internal/dependencies/provisioning/ -run TestProvisioning_EnvironmentInfo -v
```

Expected: compile failure — `provisioning.EnvironmentInfo` undefined.

- [ ] **Step 3: Implement**

Add `EnvironmentInfo` and widen the lister in `service.go`. The titlecase fallback and the annotation default belong here, in one place:

```go
// titleFromName turns an OpenChoreo environment name into a readable label
// when nobody has set openchoreo.dev/display-name: "staging-local" → "Staging Local".
func titleFromName(name string) string {
	parts := strings.FieldsFunc(name, func(r rune) bool { return r == '-' || r == '_' })
	for i, p := range parts {
		if p == "" {
			continue
		}
		parts[i] = strings.ToUpper(p[:1]) + p[1:]
	}
	return strings.Join(parts, " ")
}

func (s *Service) ListOrgEnvironments(ctx context.Context, orgID string) ([]EnvironmentInfo, error) {
	if s.environments == nil {
		return []EnvironmentInfo{}, nil
	}
	infos, err := s.environments.List(ctx, orgID)
	if err != nil {
		return nil, fmt.Errorf("provisioning: list environments: %w", err)
	}
	out := make([]EnvironmentInfo, 0, len(infos))
	for _, e := range infos {
		if e.DisplayName == "" {
			e.DisplayName = titleFromName(e.Name)
		}
		// Absent means off. Anything we do not recognise also means off —
		// an unreadable annotation must not switch validation on.
		if e.Validation != "on" {
			e.Validation = "off"
		}
		out = append(out, e)
	}
	return out, nil
}
```

In the OpenChoreo client implementing `EnvironmentLister`, read each Environment's `metadata.annotations[openchoreo.dev/display-name]` and `[aep.wso2.com/validation]` and `spec.isProduction`. Add the validation key beside `AnnotationKeyDisplayName` in `services/aep-api/internal/clients/openchoreo/constants.go`:

```go
	AnnotationKeyValidation = "aep.wso2.com/validation"
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd services/aep-api && go test ./internal/dependencies/provisioning/ -run TestProvisioning_EnvironmentInfo -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/aep-api/internal
git commit -m "aep-api: an environment reads its display name, production flag and validation setting"
```

---

### Task 3: Order the environments by the pipeline and serve the DTO

**Files:**
- Modify: `services/aep-api/internal/dependencies/provisioning/service.go`
- Modify: `services/aep-api/internal/dependencies/provisioning/handlers.go:63-77`
- Test: `services/aep-api/internal/dependencies/provisioning/provisioning_component_test.go`

**Interfaces:**
- Consumes: Task 2's `EnvironmentInfo`; the existing `PipelineEnvironments(ctx, namespace, pipelineName) ([]string, error)` on `openchoreo.ProjectCellClient`.
- Produces: `GET /api/v1/dependencies/environments` returning `[]EnvironmentDTO` in promotion order with `position` and `promotesTo` filled.

- [ ] **Step 1: Write the failing test**

```go
func TestProvisioningComponent_ListOrgEnvironments_PipelineOrderAndFlow(t *testing.T) {
	t.Parallel()
	svc := provisioning.NewService(provisioning.Deps{
		// Returned deliberately OUT of promotion order — the pipeline decides.
		Environments: &cEnvs{infos: []provisioning.EnvironmentInfo{
			{Name: "production", DisplayName: "Production", IsProduction: true, Validation: "off"},
			{Name: "development", DisplayName: "Development", Validation: "on"},
			{Name: "staging", DisplayName: "Staging", Validation: "off"},
		}},
		Pipeline: &cPipeline{order: []string{"development", "staging", "production"}},
	})
	h := newProvHarness(t, svc)
	resp := h.AsOrg("acme").Get("/api/v1/dependencies/environments")
	if resp.Code != 200 {
		t.Fatalf("want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	var got []gen.EnvironmentDTO
	if err := json.Unmarshal(resp.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	wantNames := []string{"development", "staging", "production"}
	for i, want := range wantNames {
		if got[i].Name != want {
			t.Fatalf("position %d = %q, want %q", i, got[i].Name, want)
		}
		if got[i].Position != int32(i) {
			t.Errorf("%s position = %d, want %d", want, got[i].Position, i)
		}
	}
	if got[0].PromotesTo == nil || *got[0].PromotesTo != "staging" {
		t.Errorf("development promotesTo = %v, want staging", got[0].PromotesTo)
	}
	// The last environment promotes nowhere, and must say so by omission.
	if got[2].PromotesTo != nil {
		t.Errorf("production promotesTo = %v, want omitted", *got[2].PromotesTo)
	}
}

func TestProvisioningComponent_ListOrgEnvironments_EnvironmentOutsidePipelineIsDropped(t *testing.T) {
	t.Parallel()
	svc := provisioning.NewService(provisioning.Deps{
		Environments: &cEnvs{infos: []provisioning.EnvironmentInfo{
			{Name: "development", DisplayName: "Development", Validation: "on"},
			{Name: "someone-elses-env", DisplayName: "Someone Elses Env"},
		}},
		Pipeline: &cPipeline{order: []string{"development"}},
	})
	h := newProvHarness(t, svc)
	resp := h.AsOrg("acme").Get("/api/v1/dependencies/environments")
	var got []gen.EnvironmentDTO
	_ = json.Unmarshal(resp.Body.Bytes(), &got)
	if len(got) != 1 || got[0].Name != "development" {
		t.Fatalf("a converged cluster's foreign environment leaked into the pipeline: %+v", got)
	}
}
```

Add a `cPipeline` test double returning `order` from `PipelineEnvironments`.

- [ ] **Step 2: Run and watch it fail**

```bash
cd services/aep-api && go test ./internal/dependencies/provisioning/ -run TestProvisioningComponent_ListOrgEnvironments_ -v
```

Expected: FAIL — `Deps.Pipeline` undefined.

- [ ] **Step 3: Implement**

Order the infos by the pipeline, dropping anything the pipeline does not name (the same reasoning `PipelineEnvironments` documents: a converged cluster carries other platforms' environments). In `handlers.go`:

```go
func (h *Handler) ListOrgEnvironments(ctx context.Context, _ gen.ListOrgEnvironmentsRequestObject) (gen.ListOrgEnvironmentsResponseObject, error) {
	org := tenant.BoundOrgFromContext(ctx)
	if h.svc == nil {
		return nil, errProvisioningUnavailable()
	}
	infos, err := h.svc.ListOrgEnvironments(ctx, org)
	if err != nil {
		return nil, mapProvisionError(err)
	}
	out := make([]gen.EnvironmentDTO, 0, len(infos))
	for i, e := range infos {
		dto := gen.EnvironmentDTO{
			Name:         e.Name,
			DisplayName:  e.DisplayName,
			IsProduction: e.IsProduction,
			Validation:   gen.EnvironmentDTOValidation(e.Validation),
			Position:     int32(i),
		}
		if i+1 < len(infos) {
			next := infos[i+1].Name
			dto.PromotesTo = &next
		}
		out = append(out, dto)
	}
	return gen.ListOrgEnvironments200JSONResponse(out), nil
}
```

The ordering itself belongs in the service, not the handler — `ListOrgEnvironments` asks the pipeline for the order and returns the infos already sorted and filtered. Delete `ListNames` and its interface method now that nothing calls it.

- [ ] **Step 4: Run and watch it pass**

```bash
cd services/aep-api && go test ./internal/dependencies/provisioning/... -v
```

Expected: PASS, including the two pre-existing `_Empty` and `_NamesFromOC` tests (update the latter's double to `infos`).

- [ ] **Step 5: Commit**

```bash
git add services/aep-api/internal
git commit -m "aep-api: environments are served in the pipeline's promotion order, with their flow"
```

---

### Task 4: The console's environment module — pure functions, no React

**Files:**
- Create: `apps/console/src/features/projects/lib/environments.ts`
- Test: `apps/console/src/features/projects/lib/environments.test.ts`

**Interfaces:**
- Consumes: Task 1's TS `EnvironmentDTO`.
- Produces — every later task uses these exact names:

```ts
export type EnvironmentInfo = components["schemas"]["EnvironmentDTO"];
export type StepKind = "deployment" | "validation" | "promote";
export interface FlowStepSpec { kind: StepKind; index: number; promotesTo?: string }

export function stepsFor(env: EnvironmentInfo): FlowStepSpec[];
export function isLast(env: EnvironmentInfo): boolean;
export function labelOf(env: EnvironmentInfo | undefined, name: string): string;
export function findEnvironment(list: EnvironmentInfo[], name: string): EnvironmentInfo | undefined;
export function moveEnvironment(list: EnvironmentInfo[], from: number, to: number): EnvironmentInfo[];
```

`moveEnvironment` is written here, in plan 1, even though drag lands in plan 3: it is pure position arithmetic and the plan-3 UI should consume a tested function rather than invent one.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { findEnvironment, isLast, labelOf, moveEnvironment, stepsFor, type EnvironmentInfo } from "./environments";

const env = (over: Partial<EnvironmentInfo> & { name: string }): EnvironmentInfo => ({
  displayName: over.name,
  isProduction: false,
  validation: "off",
  position: 0,
  ...over,
});

describe("stepsFor", () => {
  it("gives a validating, non-final environment three steps, numbered in order", () => {
    const steps = stepsFor(env({ name: "development", validation: "on", position: 0, promotesTo: "staging" }));
    expect(steps.map((s) => [s.kind, s.index])).toEqual([
      ["deployment", 1],
      ["validation", 2],
      ["promote", 3],
    ]);
    expect(steps[2]?.promotesTo).toBe("staging");
  });

  it("drops the validation step when the environment does not validate", () => {
    const steps = stepsFor(env({ name: "staging", validation: "off", promotesTo: "uat" }));
    expect(steps.map((s) => [s.kind, s.index])).toEqual([
      ["deployment", 1],
      ["promote", 2],
    ]);
  });

  it("drops the promote step on the last environment — nothing follows it", () => {
    const steps = stepsFor(env({ name: "production", validation: "on", isProduction: true }));
    expect(steps.map((s) => [s.kind, s.index])).toEqual([
      ["deployment", 1],
      ["validation", 2],
    ]);
  });

  it("leaves a lone environment with one step", () => {
    expect(stepsFor(env({ name: "development" })).map((s) => s.kind)).toEqual(["deployment"]);
  });
});

describe("isLast", () => {
  it("is the absence of a promotion target, not a guess from isProduction", () => {
    expect(isLast(env({ name: "production", isProduction: true }))).toBe(true);
    // A production environment that still promotes onward is NOT last.
    expect(isLast(env({ name: "production", isProduction: true, promotesTo: "dr" }))).toBe(false);
  });
});

describe("labelOf", () => {
  it("uses the display name, and falls back to the raw name when the environment is unknown", () => {
    expect(labelOf(env({ name: "staging", displayName: "Staging" }), "staging")).toBe("Staging");
    expect(labelOf(undefined, "staging")).toBe("staging");
  });
});

describe("moveEnvironment", () => {
  const list = [env({ name: "a" }), env({ name: "b" }), env({ name: "c" })];

  it("moves a card forward and backward without mutating the input", () => {
    expect(moveEnvironment(list, 0, 2).map((e) => e.name)).toEqual(["b", "c", "a"]);
    expect(moveEnvironment(list, 2, 0).map((e) => e.name)).toEqual(["c", "a", "b"]);
    expect(list.map((e) => e.name)).toEqual(["a", "b", "c"]);
  });

  it("renumbers position and rewires promotesTo to the new neighbour", () => {
    const moved = moveEnvironment(list, 0, 2);
    expect(moved.map((e) => e.position)).toEqual([0, 1, 2]);
    expect(moved.map((e) => e.promotesTo)).toEqual(["c", "a", undefined]);
  });

  it("is a no-op for an unchanged or out-of-range move", () => {
    expect(moveEnvironment(list, 1, 1).map((e) => e.name)).toEqual(["a", "b", "c"]);
    expect(moveEnvironment(list, 5, 0).map((e) => e.name)).toEqual(["a", "b", "c"]);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm exec vitest run src/features/projects/lib/environments.test.ts
```

Expected: FAIL — cannot resolve `./environments`.

- [ ] **Step 3: Implement**

```ts
import type { components } from "../../../generated/aep-api";

/**
 * An environment as the platform describes it: its immutable name, how it is
 * shown, whether it validates, and what it promotes to. The console never
 * decides any of this — it reads the list the BFF served, in the order it
 * served it.
 */
export type EnvironmentInfo = components["schemas"]["EnvironmentDTO"];

export type StepKind = "deployment" | "validation" | "promote";

export interface FlowStepSpec {
  kind: StepKind;
  /** 1-based, as the card numbers them. */
  index: number;
  /** The promote step's target; absent on the others. */
  promotesTo?: string;
}

/** True when nothing follows this environment — the promotion target is the
 *  only thing that says so. `isProduction` is a label, not a position. */
export function isLast(env: EnvironmentInfo): boolean {
  return !env.promotesTo;
}

/**
 * A card's steps are a consequence, never a stored number: Deployment always,
 * Validation when this environment is configured for it, Promote when
 * something follows.
 */
export function stepsFor(env: EnvironmentInfo): FlowStepSpec[] {
  const steps: FlowStepSpec[] = [{ kind: "deployment", index: 1 }];
  if (env.validation === "on") {
    steps.push({ kind: "validation", index: steps.length + 1 });
  }
  if (!isLast(env)) {
    steps.push({ kind: "promote", index: steps.length + 1, promotesTo: env.promotesTo });
  }
  return steps;
}

export function findEnvironment(list: EnvironmentInfo[], name: string): EnvironmentInfo | undefined {
  return list.find((e) => e.name === name);
}

/** The environment's display name, or the raw segment when the list does not
 *  know it — a URL naming a dead environment still has to render something. */
export function labelOf(env: EnvironmentInfo | undefined, name: string): string {
  return env?.displayName || name;
}

/**
 * Reorder for the settings strip (plan 3). Pure: it renumbers `position` and
 * rewires every `promotesTo` to the new neighbour, because both are
 * consequences of order and a half-renumbered list would draw a broken flow.
 */
export function moveEnvironment(
  list: EnvironmentInfo[],
  from: number,
  to: number,
): EnvironmentInfo[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list.map((e) => ({ ...e }));
  }
  const next = list.map((e) => ({ ...e }));
  const [moved] = next.splice(from, 1);
  if (!moved) return list.map((e) => ({ ...e }));
  next.splice(to, 0, moved);
  return next.map((e, i) => {
    const rest: EnvironmentInfo = { ...e, position: i };
    const following = next[i + 1];
    if (following) {
      rest.promotesTo = following.name;
    } else {
      delete rest.promotesTo;
    }
    return rest;
  });
}
```

- [ ] **Step 4: Run and watch them pass**

```bash
cd apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm exec vitest run src/features/projects/lib/environments.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/features/projects/lib/environments.ts apps/console/src/features/projects/lib/environments.test.ts
git commit -m "console: an environment's steps and order are a pure function of the pipeline"
```

---

### Task 5: The environments query

**Files:**
- Modify: `apps/console/src/features/projects/api/queries.ts`
- Test: covered through the page tests in Task 8 (the hook is a thin React Query wrapper; testing it standalone would test React Query).

**Interfaces:**
- Produces: `useEnvironments(): { data: EnvironmentInfo[] | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => void }`

- [ ] **Step 1: Add the hook**

Follow the file's existing hook shape exactly (same client, same `queryKey` convention, same error handling). The environment list changes rarely, so give it a long `staleTime`:

```ts
/**
 * The org's environments, in the platform pipeline's promotion order. Every
 * surface that draws a flow reads this — the order is the platform's, and the
 * console must never re-sort it.
 */
export function useEnvironments() {
  return useQuery({
    queryKey: ["environments"],
    queryFn: async () => {
      const { data, error } = await client.GET("/dependencies/environments");
      if (error) throw error;
      return (data ?? []) as EnvironmentInfo[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/features/projects/api/queries.ts
git commit -m "console: read the org's environments in promotion order"
```

---

### Task 6: `EnvironmentKey` stops being a two-word union

**Files:**
- Modify: `apps/console/src/features/projects/lib/deploymentLedger.ts:30-52,186-217`
- Modify: `apps/console/src/features/projects/lib/deploymentRows.ts` (the board's `development` / `production` buckets)
- Test: `apps/console/src/features/projects/lib/deploymentLedger.test.ts`

**Interfaces:**
- Consumes: Task 4's `EnvironmentInfo`, `labelOf`.
- Produces:
  - `export type EnvironmentKey = string;`
  - `groupDeploymentCards(components, deployments): DeploymentBoard` where `DeploymentBoard` becomes `Map<string, DeploymentCard[]>` keyed by environment name.
  - `environmentRows(board, environments, deploy): EnvironmentRow[]` — one row per environment in `environments` order.
  - `ENVIRONMENTS` and `parseEnvironment` are **deleted**.

- [ ] **Step 1: Write the failing test**

Add to `deploymentLedger.test.ts`:

```ts
describe("environmentRows across N environments", () => {
  const envs: EnvironmentInfo[] = [
    { name: "development", displayName: "Development", isProduction: false, validation: "on", position: 0, promotesTo: "staging" },
    { name: "staging", displayName: "Staging", isProduction: false, validation: "off", position: 1, promotesTo: "production" },
    { name: "production", displayName: "Production", isProduction: true, validation: "off", position: 2 },
  ];

  it("gives every environment a row, in the order the platform served", () => {
    const board = groupDeploymentCards(
      [{ name: "api", displayName: "API", type: "service" }],
      [{ componentName: "api", environment: "staging", status: "Ready", createdAt: "2026-09-12T10:00:00Z" }],
    );
    const rows = environmentRows(board, envs, deploy());
    expect(rows.map((r) => [r.environment, r.label])).toEqual([
      ["development", "Development"],
      ["staging", "Staging"],
      ["production", "Production"],
    ]);
  });

  it("gives an environment with no bindings a row too — absence is information on the board", () => {
    const board = groupDeploymentCards([{ name: "api", displayName: "API", type: "service" }], []);
    const rows = environmentRows(board, envs, deploy());
    expect(rows).toHaveLength(3);
    expect(rows[2]?.status.label).toBe("Nothing deployed");
  });

  it("renders a single-environment pipeline without inventing a second", () => {
    const board = groupDeploymentCards([{ name: "api", displayName: "API", type: "service" }], []);
    const rows = environmentRows(board, [envs[0]!], deploy());
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm exec vitest run src/features/projects/lib/deploymentLedger.test.ts
```

Expected: FAIL — `environmentRows` takes two arguments.

- [ ] **Step 3: Implement**

`environmentRows` now walks the environment list. Every existing `environment === "development"` branch must be re-read one at a time and replaced with the question it was actually asking — they are **not** the same question:

| Existing check | What it meant | Replace with |
|---|---|---|
| the deploy aggregate names the version | only dev has an aggregate version | `env.position === 0` |
| dev collects dependency values | values are collected where they are first needed | `env.position === 0` |
| production has a row only when bound | non-dev rows were conditional | every environment gets a row now |

Do not introduce a single `isDevelopment()` helper standing in for all three — that is how the two-environment assumption would survive the refactor.

- [ ] **Step 4: Run the full lib suite**

```bash
cd apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm exec vitest run src/features/projects/lib
```

Expected: PASS. Existing tests will need their `environmentRows` calls updated with a two-environment list — that is expected churn, not a regression.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/features/projects/lib
git commit -m "console: an environment is a name from the pipeline, not one of two words"
```

---

### Task 7: The route stops validating environments synchronously

**Files:**
- Modify: `apps/console/src/routes/projects.$projectName.deployments.$environment.index.tsx`
- Modify: `apps/console/src/routes/deployment-routes.test.ts`

**Interfaces:**
- Consumes: Task 5's `useEnvironments`, Task 4's `findEnvironment`.
- Produces: a route that accepts any `$environment` segment.

- [ ] **Step 1: Write the failing test**

`parseEnvironment` rejected unknown segments at route level. It cannot: the valid set arrives over the network. Replace those route tests with:

```ts
it("accepts any environment segment — the page, not the route, knows what exists", () => {
  expect(() => renderRoute("/projects/expense/deployments/staging")).not.toThrow();
});
```

and a page test asserting the dead end:

```tsx
it("is a dead end with a way back when the pipeline has no such environment", () => {
  mockEnvironments = [devEnv];
  render(<DeploymentEnvironmentPage projectName="expense" environment="uat" />);
  expect(screen.getByText("No environment called uat")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back to Deployments" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm exec vitest run src/routes
```

Expected: FAIL — the route still rejects the segment.

- [ ] **Step 3: Implement**

Remove the `parseEnvironment` guard from the route. The page renders the `EmptyState` dead end once the environment list has answered — and **only** once it has: while `isPending`, show the page skeleton, never the dead end. A slow network must not accuse a real environment of not existing.

- [ ] **Step 4: Run and watch it pass**

```bash
cd apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm exec vitest run src/routes src/features/projects
```

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/routes apps/console/src/features/projects
git commit -m "console: an unknown environment is a dead end on the page, not a rejected route"
```

---

### Task 8: The horizontal environment flow

**Files:**
- Create: `apps/console/src/features/projects/components/EnvironmentFlow.tsx`
- Create: `apps/console/src/features/projects/components/EnvironmentFlow.test.tsx`
- Modify: `apps/console/src/features/projects/components/EnvironmentCards.tsx` (the card becomes one item in the row)

**Interfaces:**
- Consumes: Tasks 4 and 6.
- Produces: `<EnvironmentFlow projectName environments rows deploy onPromote onTryOut />`

- [ ] **Step 1: Write the failing tests**

```tsx
describe("EnvironmentFlow", () => {
  it("draws one card per environment, in the platform's order", () => {
    render(<EnvironmentFlow {...props(threeEnvs)} />);
    const names = screen.getAllByTestId("environment-card-name").map((n) => n.textContent);
    expect(names).toEqual(["Development", "Staging", "Production"]);
  });

  it("numbers the steps per environment, dropping validation where it is off", () => {
    render(<EnvironmentFlow {...props(threeEnvs)} />);
    const staging = within(screen.getByTestId("environment-card-staging"));
    expect(staging.queryByText("Validation")).not.toBeInTheDocument();
    expect(staging.getByText("Promote to Production")).toBeInTheDocument();
  });

  it("gives the last environment no promote step", () => {
    const production = within(screen.getByTestId("environment-card-production"));
    expect(production.queryByText(/^Promote to/)).not.toBeInTheDocument();
    expect(production.getByText("Last environment in the pipeline — nothing to promote to.")).toBeInTheDocument();
  });

  it("names the promote target and the version on the button", () => {
    expect(screen.getByRole("button", { name: "Promote v4 to Staging" })).toBeInTheDocument();
  });

  it("makes Promote primary and Try it now secondary once validation has passed", () => {
    render(<EnvironmentFlow {...props(threeEnvs, { validation: "passed" })} />);
    expect(screen.getByRole("button", { name: /Promote v4 to Staging/ })).toHaveClass("MuiButton-contained");
    expect(screen.getByRole("link", { name: /Try it now/ })).toHaveClass("MuiButton-outlined");
  });

  it("keeps Try it now primary and Promote unavailable while the verdict is unknown", () => {
    render(<EnvironmentFlow {...props(threeEnvs, { validation: "cancelled" })} />);
    expect(screen.getByRole("link", { name: /Try it now/ })).toHaveClass("MuiButton-contained");
    expect(screen.getByRole("button", { name: /Promote/ })).toBeDisabled();
  });

  it("opens the environment page from the card, and not from a button inside it", () => {
    const onTryOut = vi.fn();
    render(<EnvironmentFlow {...props(threeEnvs)} onTryOut={onTryOut} />);
    fireEvent.click(screen.getByTestId("environment-card-staging"));
    expect(onTryOut).toHaveBeenCalledWith("staging");
    onTryOut.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Promote/ }));
    expect(onTryOut).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm exec vitest run src/features/projects/components/EnvironmentFlow.test.tsx
```

- [ ] **Step 3: Implement**

A `Stack direction="row"` with `overflow-x: auto`, `alignItems: "stretch"` (equal heights — the tallest card's component and dependency lists set the row), a fixed card width, and an arrow between cards. Inside the card, the rail is a flex column with the trailing step carrying `marginTop: auto` so every promote row lines up across the pipeline.

The card header is the display name at full weight with `Environment` small and muted beside it.

Card click: an `onClick` on the card `Box`, a real `RouterLink` on the environment name for keyboard and middle-click, and `event.stopPropagation()` on every inner button. Do **not** wrap the card in an `<a>` — buttons are illegal descendants of an anchor.

The one-primary rule: compute `promoteReady` (validation passed and something follows), then `Try it now` is `contained` when `!promoteReady` and `outlined` otherwise.

- [ ] **Step 4: Run and watch them pass**

```bash
cd apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm exec vitest run src/features/projects
```

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/features/projects/components
git commit -m "console: the environments read as a flow, left to right"
```

---

### Task 9: The page renders the flow, and the ledger leaves

**Files:**
- Modify: `apps/console/src/features/projects/components/DeploymentsPage.tsx`
- Modify: `apps/console/src/features/projects/components/DeploymentsPage.test.tsx`
- Delete: `apps/console/src/features/projects/components/DeploymentsLedger.tsx` — **only after** plan 2 has moved its table into the environment page's Past deployments. Until then, keep the file and stop rendering it.

**Interfaces:**
- Consumes: Tasks 5, 6, 8.

- [ ] **Step 1: Write the failing test**

```tsx
it("is the flow and nothing under it — the version ledger has left the page", () => {
  render(<DeploymentsPage projectName="expense" />);
  expect(screen.getByTestId("environment-flow")).toBeInTheDocument();
  expect(screen.queryByText("every version this project built, newest first")).not.toBeInTheDocument();
});

it("holds a skeleton while the environment list is out, rather than guessing two cards", () => {
  mockEnvironmentsPending = true;
  render(<DeploymentsPage projectName="expense" />);
  expect(screen.getByTestId("environment-flow-skeleton")).toBeInTheDocument();
  expect(screen.queryByText("Development")).not.toBeInTheDocument();
});

it("says the pipeline could not be read, with a retry, rather than an empty page", () => {
  mockEnvironmentsError = true;
  render(<DeploymentsPage projectName="expense" />);
  expect(screen.getByText(/The deployment pipeline could not be loaded/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(mockEnvironmentsRefetch).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm exec vitest run src/features/projects/components/DeploymentsPage.test.tsx
```

- [ ] **Step 3: Implement**

Replace the two-card grid with `<EnvironmentFlow>`, drop `<DeploymentsLedger>` from the render, and add the pending and error states above. The skeleton must not render a guessed number of cards — one full-width shimmer, not two card-shaped ones.

- [ ] **Step 4: Run the whole console suite**

```bash
cd apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm run typecheck && pnpm exec vitest run src/features/projects src/routes && pnpm exec eslint src/features/projects
```

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/features/projects/components
git commit -m "console: the Deployments page is the pipeline, however many environments it has"
```

---

### Task 10: Each environment's version

**Files:**
- Modify: `packages/contracts/api/v1/openapi.yaml` — `Deployment` schema, add `version`
- Modify: the BFF deployment read that builds `Deployment` DTOs
- Modify: `apps/console/src/features/projects/lib/deploymentLedger.ts` — `environmentRows` reads it
- Test: BFF component test + `deploymentLedger.test.ts`

**Interfaces:**
- Produces: `Deployment.version?: string` — the spec tag this environment's binding is pinned to.

- [ ] **Step 1: Write the failing console test**

```ts
it("takes every environment's version from its own binding, not the dev aggregate", () => {
  const board = groupDeploymentCards(
    [{ name: "api", displayName: "API", type: "service" }],
    [{ componentName: "api", environment: "staging", status: "Ready", createdAt: "...", version: "v3" }],
  );
  const rows = environmentRows(board, envs, deploy({ version: "v4" }));
  expect(rows.find((r) => r.environment === "staging")?.version).toBe("v3");
  expect(rows.find((r) => r.environment === "development")?.version).toBe("v4");
});

it("says nothing rather than guessing when the binding names no version", () => {
  const board = groupDeploymentCards(
    [{ name: "api", displayName: "API", type: "service" }],
    [{ componentName: "api", environment: "staging", status: "Ready", createdAt: "..." }],
  );
  const rows = environmentRows(board, envs, deploy());
  expect(rows.find((r) => r.environment === "staging")?.version).toBeUndefined();
});
```

And the card must render *Version unknown* for that row — assert it in `EnvironmentFlow.test.tsx`.

- [ ] **Step 2: Run and watch them fail**

```bash
cd apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm exec vitest run src/features/projects/lib/deploymentLedger.test.ts
```

- [ ] **Step 3: Implement**

Contract first: add `version` to `Deployment` with the description *"Spec tag this environment's binding is pinned to; omitted when it cannot be resolved."*, regenerate both sides. In the BFF, resolve it from the environment's `ProjectReleaseBinding` pin. If that read is unavailable, fall back to parsing `releaseName` (`<component>-<version>-<sha>`) — and **omit the field** rather than emit a guess when the parse does not match. In the console, `environmentRows` prefers `deploy.version` for position 0 and the binding's `version` everywhere else.

- [ ] **Step 4: Run both suites**

```bash
cd services/aep-api && go test ./... 
cd ../../apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm run typecheck && pnpm exec vitest run src/features/projects
```

- [ ] **Step 5: Commit**

```bash
git add packages/contracts services/aep-api apps/console
git commit -m "aep-api,console: an environment knows the version it is pinned to"
```

---

### Task 11: Documentation

**Files:**
- Create: `apps/console/design/decisions/ADR-0033-deployments-is-a-pipeline.md`
- Modify: `apps/console/PRD.md` — the deployments paragraph
- Modify: `docs/design/console.md` if it describes the two-environment board

- [ ] **Step 1: Write ADR-0033**

Amending ADR-0032. State the **final state**, not the journey — the repo's ADR rule. Cover: the pipeline is the source of truth; the step model as a consequence; the flow reads left to right; the last environment has no promote step; the ledger has left the page. Note plans 2 and 3 as the remaining surfaces.

- [ ] **Step 2: Update the PRD paragraph**

Replace "the board's ledger lists every version the project built" with the per-environment history, and the two-card description with the flow.

- [ ] **Step 3: Commit**

```bash
git add apps/console/design/decisions apps/console/PRD.md docs/design
git commit -m "docs: ADR-0033 — Deployments is a pipeline, not a pair"
```

---

## Self-review notes

**Spec coverage.** §3.1 → Tasks 2, 3. §3.2 → Task 4. §3.3 → Tasks 3, 4, 8. §4.1 → Tasks 1–3. §4.2 → Task 10. §4.3 → plan 2 (Past deployments). §5 → Tasks 8, 9. §6 → plan 2. §7 → plan 3. §9 deletions: the version page and the try-out route are plan 2's; `ENVIRONMENTS`/`parseEnvironment` are Task 6/7; `DeploymentsLedger` is unrendered here and deleted in plan 2.

**Known gap carried forward.** The spec's §10 cascade check — that the deployed-task cascade re-emitting `cors.allowedOrigins` and `env-config.js` is environment-scoped — is **not** covered by any task here. It is a BFF behaviour, not a console one, and it must be verified before a third environment is ever created on a real cluster. Raise it in plan 3, where environments become creatable.
