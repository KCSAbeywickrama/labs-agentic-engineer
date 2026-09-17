# Multi-Environment Deployments — Implementation Plan 3: The Deployment Environments Settings Tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Settings tab showing the deployment pipeline as a horizontal strip, with exactly one control: a working per-environment validation switch.

**Architecture:** The strip reads the same `useEnvironments` list plan 1 built. The validation switch is the project's only platform write — a read-modify-write of one annotation on an OpenChoreo `Environment`. Creating, renaming and reordering environments are **out of scope entirely** (spec D6, decided on a call 2026-09-17): not built, not drawn, not disabled-with-a-tooltip. They are platform-admin operations against OpenChoreo directly.

**Tech Stack:** Go 1.25 (one BFF endpoint), TypeScript/React 19, Oxygen UI, React Query, vitest. No drag-and-drop library, and no drag.

**Spec:** [`docs/design/multi-environment-deployments.md`](multi-environment-deployments.md) §4.4, §7 and §8. **Depends on plan 1** for `environments.ts` and `useEnvironments`. Independent of plan 2.

## Global Constraints

Everything in [plan 1's Global Constraints](multi-environment-deployments-plan-1.md#global-constraints) applies unchanged. Additionally:

- **One write, and only one.** `aep.wso2.com/validation` on an existing `Environment`. This project creates nothing, renames nothing, and never writes a `DeploymentPipeline`.
- **The annotation write is read-modify-write** and must preserve every other annotation and the whole of `spec`. A write that blanks a field it did not understand is a defect, not a race.
- **No control exists for anything but validation.** No add card, no edit pencil, no drag grip — not even disabled. A control that can never work invites the question every time it is seen.
- Per CLAUDE.md, anything touching OpenChoreo primitives goes through **platform-design-expert** before merge. That applies to Tasks 2 and 3.

---

### Task 1: The tab exists and lists the pipeline

**Files:**
- Create: `apps/console/src/routes/settings.environments.tsx`
- Create: `apps/console/src/features/settings/components/EnvironmentsSection.tsx`
- Create: `apps/console/src/features/settings/components/EnvironmentsSection.test.tsx`
- Modify: `apps/console/src/features/settings/components/SettingsLayout.tsx:36-38` (the `SECTIONS` array)

**Interfaces:**
- Consumes: plan 1's `useEnvironments`, `stepsFor`, `isLast`.
- Produces: `<EnvironmentsSection />` at `/settings/environments`.

- [ ] **Step 1: Write the failing tests**

```tsx
describe("EnvironmentsSection", () => {
  it("adds the tab to Settings", () => {
    render(<SettingsLayout />);
    expect(screen.getByRole("tab", { name: "Deployment Environments" })).toHaveAttribute(
      "href",
      "/settings/environments",
    );
  });

  it("draws one card per environment in the platform's order, with its position", () => {
    render(<EnvironmentsSection />);
    expect(screen.getAllByTestId("env-setting-name").map((n) => n.textContent)).toEqual([
      "Development", "Staging", "Production",
    ]);
    expect(screen.getByTestId("env-setting-development")).toHaveTextContent("First · 3 steps");
    expect(screen.getByTestId("env-setting-staging")).toHaveTextContent("Second · 2 steps");
    expect(screen.getByTestId("env-setting-production")).toHaveTextContent("Last · 2 steps");
  });

  it("strikes through the validation step where the environment does not validate", () => {
    const staging = within(screen.getByTestId("env-setting-staging"));
    expect(staging.getByText("Validation")).toHaveStyle({ textDecoration: "line-through" });
  });

  it("flags production from isProduction, never from the name", () => {
    render(<EnvironmentsSection />);
    expect(within(screen.getByTestId("env-setting-production")).getByText("Production")).toBeInTheDocument();
    // An environment merely CALLED production-like is not flagged.
    mockEnvironments = [env({ name: "pre-production", displayName: "Pre Production", isProduction: false })];
    render(<EnvironmentsSection />);
    expect(screen.queryByTestId("production-flag")).not.toBeInTheDocument();
  });

  it("names the pipeline it read, and says where environments are managed", () => {
    expect(screen.getByText(/default-pipeline/)).toBeInTheDocument();
    expect(
      screen.getByText(/Environments are managed by a platform administrator/),
    ).toBeInTheDocument();
  });

  it("offers no control but the validation switch", () => {
    render(<EnvironmentsSection />);
    // Not "disabled" — absent. A control that can never work invites the
    // question every time it is seen.
    expect(screen.queryByRole("button", { name: /Add environment/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /display name/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Not supported yet/)).not.toBeInTheDocument();
    expect(document.querySelectorAll("[draggable]")).toHaveLength(0);
  });

  it("holds a skeleton while the list is out and offers a retry when it fails", () => {
    mockEnvironmentsPending = true;
    render(<EnvironmentsSection />);
    expect(screen.getByTestId("env-strip-skeleton")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm exec vitest run src/features/settings
```

- [ ] **Step 3: Implement**

Add `{ path: "/settings/environments", label: "Deployment Environments", Icon: <pick from lucide, matching the file's existing imports> }` to `SECTIONS`. The strip is a `Stack direction="row"` with `overflow-x: auto` and an arrow between cards. Position words come from `position` and `isLast`: `First`, `Second`, `Third`… and `Last` for the final card. Step count comes from `stepsFor(env).length` — never a literal.

Run `pnpm gen` for the route tree.

- [ ] **Step 4: Run and watch them pass**

```bash
cd apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm gen && pnpm run typecheck && pnpm exec vitest run src/features/settings
```

- [ ] **Step 5: Commit**

```bash
git add apps/console/src
git commit -m "console: Settings shows the deployment pipeline as it is"
```

---

### Task 2: The validation endpoint

**Files:**
- Modify: `packages/contracts/api/v1/openapi.yaml`
- Modify: `services/aep-api/internal/dependencies/provisioning/handlers.go`
- Modify: `services/aep-api/internal/dependencies/provisioning/service.go`
- Modify: the OpenChoreo environment client (the type behind `EnvironmentLister`)
- Test: `services/aep-api/internal/dependencies/provisioning/provisioning_component_test.go`

**Interfaces:**
- Produces: `PUT /api/v1/dependencies/environments/{environment}/validation`, body `{"validation": "on" | "off"}`, returning the updated `EnvironmentDTO`.

- [ ] **Step 1: Add the contract**

```yaml
  /dependencies/environments/{environment}/validation:
    put:
      operationId: set-environment-validation
      summary: Turn the validation step on or off for one environment
      description: >-
        Writes the aep.wso2.com/validation annotation on the OpenChoreo
        Environment. Read-modify-write: every other annotation and the whole
        of spec are preserved.
      parameters:
      - name: environment
        in: path
        required: true
        schema:
          type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required: [validation]
              properties:
                validation:
                  type: string
                  enum: [on, off]
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/EnvironmentDTO'
      tags:
      - Dependencies
```

Then:

```bash
cd services/aep-api && make gen-api
cd ../../apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm gen
```

- [ ] **Step 2: Write the failing test**

```go
func TestProvisioning_SetEnvironmentValidation_PreservesEverythingElse(t *testing.T) {
	t.Parallel()
	envs := &cEnvs{
		infos: []provisioning.EnvironmentInfo{{Name: "staging", DisplayName: "Staging", Validation: "off"}},
		raw: map[string]map[string]string{
			"staging": {"openchoreo.dev/display-name": "Staging", "someone.else/keep-me": "yes"},
		},
	}
	svc := provisioning.NewService(provisioning.Deps{Environments: envs, Pipeline: &cPipeline{order: []string{"staging"}}})
	h := newProvHarness(t, svc)

	resp := h.AsOrg("acme").Put("/api/v1/dependencies/environments/staging/validation", `{"validation":"on"}`)
	if resp.Code != 200 {
		t.Fatalf("want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	written := envs.lastWrittenAnnotations["staging"]
	if written["aep.wso2.com/validation"] != "on" {
		t.Errorf("validation annotation = %q, want on", written["aep.wso2.com/validation"])
	}
	// A read-modify-write that drops a neighbour's annotation is a defect.
	if written["someone.else/keep-me"] != "yes" {
		t.Error("the write blanked an annotation it did not own")
	}
	if written["openchoreo.dev/display-name"] != "Staging" {
		t.Error("the write blanked the display name")
	}
	if envs.specTouched {
		t.Error("the write touched spec; it must only ever write annotations")
	}
}

func TestProvisioning_SetEnvironmentValidation_RejectsAnythingButOnOrOff(t *testing.T) {
	t.Parallel()
	svc := provisioning.NewService(provisioning.Deps{Environments: &cEnvs{}, Pipeline: &cPipeline{}})
	h := newProvHarness(t, svc)
	resp := h.AsOrg("acme").Put("/api/v1/dependencies/environments/staging/validation", `{"validation":"maybe"}`)
	if resp.Code != 400 {
		t.Fatalf("want 400 for an unknown value, got %d", resp.Code)
	}
}

func TestProvisioning_SetEnvironmentValidation_UnknownEnvironmentIs404(t *testing.T) {
	t.Parallel()
	svc := provisioning.NewService(provisioning.Deps{Environments: &cEnvs{}, Pipeline: &cPipeline{}})
	h := newProvHarness(t, svc)
	resp := h.AsOrg("acme").Put("/api/v1/dependencies/environments/nope/validation", `{"validation":"on"}`)
	if resp.Code != 404 {
		t.Fatalf("want 404, got %d", resp.Code)
	}
}
```

- [ ] **Step 3: Run and watch them fail**

```bash
cd services/aep-api && go test ./internal/dependencies/provisioning/ -run TestProvisioning_SetEnvironmentValidation -v
```

- [ ] **Step 4: Implement**

Add `SetValidation(ctx, orgID, environment, value string) error` to the environment client: `GetEnvironment`, mutate exactly one key in `metadata.annotations`, `UpdateEnvironment` with the object it read. It must send back the whole object it received, with only that key changed — never a hand-built `Environment` with the fields it happens to know.

- [ ] **Step 5: Run and watch them pass**

```bash
cd services/aep-api && go test ./internal/dependencies/... -v
```

- [ ] **Step 6: Commit**

```bash
git add packages/contracts services/aep-api apps/console/src/generated
git commit -m "aep-api: an environment's validation step can be turned on and off"
```

---

### Task 3: The switch works

**Files:**
- Modify: `apps/console/src/features/settings/api/queries.ts` (or the settings feature's query module)
- Modify: `apps/console/src/features/settings/components/EnvironmentsSection.tsx`
- Modify: `apps/console/src/features/settings/components/EnvironmentsSection.test.tsx`

**Interfaces:**
- Produces: `useSetEnvironmentValidation()` — a mutation invalidating `["environments"]` on success.

- [ ] **Step 1: Write the failing tests**

```tsx
it("turns validation on for an environment that did not have it", async () => {
  render(<EnvironmentsSection />);
  fireEvent.click(within(screen.getByTestId("env-setting-staging")).getByRole("switch", { name: /Run validation here/ }));
  await waitFor(() =>
    expect(mockSetValidation).toHaveBeenCalledWith({ environment: "staging", validation: "on" }, expect.anything()),
  );
});

it("adds the step to the card once the switch is on", async () => {
  mockEnvironments = [devEnv, { ...stagingEnv, validation: "on" }, prodEnv];
  render(<EnvironmentsSection />);
  expect(screen.getByTestId("env-setting-staging")).toHaveTextContent("Second · 3 steps");
});

it("puts the switch back and says so when the write fails", async () => {
  mockSetValidationError = true;
  render(<EnvironmentsSection />);
  const sw = within(screen.getByTestId("env-setting-staging")).getByRole("switch");
  fireEvent.click(sw);
  await waitFor(() => expect(screen.getByText(/Validation could not be changed for Staging/)).toBeInTheDocument());
  expect(sw).not.toBeChecked();
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm exec vitest run src/features/settings
```

- [ ] **Step 3: Implement**

The mutation invalidates `["environments"]`; the card's step count and struck-through validation line follow from the refetched list, so nothing recomputes them locally. On error, surface an `Alert` naming the environment and leave the switch showing the platform's value — an optimistic flip that silently stays flipped after a failed write is the bug this test exists to prevent.

- [ ] **Step 4: Run and watch them pass**

```bash
cd apps/console && PATH=$HOME/.nvm/versions/node/v22.16.0/bin:$PATH pnpm run typecheck && pnpm exec vitest run src/features/settings
```

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/features/settings
git commit -m "console: the validation step is a switch, and the card follows it"
```

---

### Task 4: Verify the cascade is environment-scoped

**Files:**
- Read: the deployed-task cascade in `services/aep-api` (`cors.allowedOrigins` re-emission, `env-config.js` on SPA ReleaseBindings)
- Create (if a gap is found): a test pinning the behaviour, plus an issue

This is the spec's §10 carried-forward gap, and the reason it lands here: this plan is where environments stop being a fixed pair in anyone's mind.

- [ ] **Step 1: Read the cascade**

```bash
cd services/aep-api && grep -rn "allowedOrigins\|env-config" internal --include=*.go | grep -v _test
```

Answer one question in writing: when a task lands `deployed` in environment X, does the cascade re-emit for **X only**, or for a hardcoded development/production pair?

- [ ] **Step 2: Write a test that pins the answer**

If it is environment-scoped, write the regression test that says so, so a future refactor cannot quietly widen it. If it is not, write the failing test, **stop, and report** — fixing it is platform work that belongs in its own task with platform-design-expert, not a step tacked onto a settings tab.

- [ ] **Step 3: Commit or report**

```bash
git add services/aep-api
git commit -m "aep-api: pin the deployed cascade to the environment that deployed"
```

---

### Task 5: Documentation

- [ ] **Step 1: Amend ADR-0033** with the settings tab: the pipeline is read, the validation annotation is the one write, reorder is a preview, add and rename are feasible and deferred, and rename can only ever mean the display name.

- [ ] **Step 2: Update `apps/console/PRD.md`** with the Deployment Environments tab.

- [ ] **Step 3: Commit**

```bash
git add apps/console/design/decisions apps/console/PRD.md
git commit -m "docs: the Deployment Environments tab, and what it deliberately does not do"
```

---

## Known gaps, stated rather than half-built

- **The pipeline cannot be changed from the console at all.** Adding, renaming and
  reordering an environment are platform-admin operations against OpenChoreo. The tab's
  banner says so and names the pipeline it read, so a reader is never left wondering
  where the controls went.
- **`moveEnvironment` (plan 1) is now unused** — it was built for the drag this plan no
  longer has. Correct and tested; `apps/*` is outside knip's scope so nothing fails.
  The whole-branch review triages whether it stays.
- **Renaming, if it ever arrives, can only change the display name** (§8.2) —
  `metadata.name` is the identity every binding and workload points at.

## Self-review notes

**Spec coverage.** §4.4 → Task 2. §7 → Tasks 1 and 3. §8 → nothing builds those
controls by design; §8's table survives as research, not as a plan. §10's cascade → Task 4.

**Type consistency.** `stepsFor`, `isLast` and `EnvironmentInfo` are plan 1's, used here
with the same signatures. `useSetEnvironmentValidation` is defined in Task 3 and used
nowhere earlier.

**Ordering constraint.** Task 3 needs Task 2's endpoint. Tasks 4 and 5 are independent
of the rest and can run in any order after Task 1.
