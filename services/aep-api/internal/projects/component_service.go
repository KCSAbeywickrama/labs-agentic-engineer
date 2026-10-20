// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

package projects

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/wso2/aep/aep-api/internal/gen"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/clients/secretmanagersvc"
	"github.com/wso2/aep/aep-api/internal/organization"
	"github.com/wso2/aep/aep-api/internal/platform/k8sname"
	"github.com/wso2/aep/aep-api/internal/platform/modelconn"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// ComponentService handles business logic for component operations.
// ComponentName parameters are the user-friendly name; the OC client prefixes
// with projectName internally (see ScopedComponentName) because OC components
// share a single k8s namespace across all projects in an org.
//
// Deploy chain: every Component is created with AutoDeploy=true (see
// dispatch_service.ensureOCComponent), so OC drives Workload →
// ComponentRelease → ReleaseBinding from the build. The build workflow's
// generate-workload-cr step is the only writer of the Workload CR. The
// BFF reads ReleaseBindings via ListDeployments.
type ComponentService interface {
	// ModelAccessEnvVars yields the MODEL_* env vars an ai-agent needs, from
	// the org's model connection. On the interface rather than the concrete type
	// so DeploymentService's wiring is checked by the COMPILER: the previous
	// shape left it reachable only by type assertion, app.go never wired it,
	// and every ai-agent deployed with no model key and 500'd on its first
	// turn. Nothing failed at deploy time, which is what made it expensive.
	ModelAccessEnvVars(ctx context.Context, ocOrgID, component, environment string) ([]openchoreo.WorkflowEnvVarRef, error)

	ListComponents(ctx context.Context, orgName, projectName string, limit int, cursor string) (*gen.ComponentList, error)
	GetComponent(ctx context.Context, orgName, projectName, componentName string) (*gen.Component, error)
	CreateComponent(ctx context.Context, orgName, projectName string, req *openchoreo.CreateComponentRequest) (*gen.Component, error)
	// EnsureComponent idempotently provisions the OpenChoreo Component CR for a
	// design component (by friendly name), so a merged-PR build has a Component to
	// build. It is the coding-dispatch pre-flight (tasks-github-native): the CR
	// must exist by merge/build time or the build fails "Component not found".
	// Idempotent — CreateComponent is 409-safe, so re-dispatch is a no-op.
	EnsureComponent(ctx context.Context, orgName, projectName, componentName string) error

	// Deploy (read-only — autoDeploy on the Component drives the chain)
	ListDeployments(ctx context.Context, orgName, projectName, componentName string) (*gen.DeploymentList, error)

	// OpenAPI for the Deployments page's Try API dialog. Reads the spec from
	// `specs/design/components/<name>/openapi.yaml`. The dialog's swagger-ui
	// invokes the deployed endpoint directly; CORS is enabled on the service
	// ClusterComponentType's HTTPRoute.
	GetComponentOpenAPI(ctx context.Context, orgName, projectName, componentName string) (*gen.ComponentOpenAPI, error)

	// Build (workflow runs)
	TriggerBuild(ctx context.Context, orgName, projectName, componentName string) (*gen.WorkflowRun, error)
	ListBuilds(ctx context.Context, orgName, projectName, componentName string, limit int, cursor string) (*gen.WorkflowRunList, error)
	// GetBuildLogs reads one build's log live from OpenChoreo, after `cursor`
	// ("" = from the beginning). The response says whether it is COMPLETE —
	// the build is terminal and there will never be more — so a caller tailing
	// a live build knows when to stop asking. ErrBuildExpired once OpenChoreo
	// no longer keeps the build; ErrBuildNotInComponent when the build is not
	// the named component's.
	GetBuildLogs(ctx context.Context, orgName, projectName, componentName, buildName, cursor string) (*gen.BuildLogs, error)
}

// BuildSecretStager returns the secretRef the build WorkflowRun consumes: the
// org's github-pat SecretReference name, never a value. Consumer-
// side port over BuildCredentialsService; a thin composition-root adapter
// maps the concrete *StageResult to the secretRef string so the component
// feature need not import that services type.
type BuildSecretStager interface {
	StageBuildSecret(ctx context.Context, ocOrgID, repoSlug, workflowRunName string) (secretRef string, err error)
}

// ModelKeyResolver is the narrow port ModelAccessEnvVars needs from the
// organization domain's ConnectionReader: the org's model connection and its
// key's stamped reference with its vault path (KeyPathRef).
// Declared consumer-side (same pattern as OrgIDPProfiles in api_traits.go) so
// this package takes only the one method it needs, not the whole reader.
// Returns an *organization.NotFoundError when the org has no active
// connection — see ModelAccessEnvVars.
type ModelKeyResolver interface {
	KeyPathRef(ctx context.Context, ocOrgID string) (modelconn.Connection, organization.SecretRefTriplet, error)
}

// -- model access for ai-agent components (see ai_agent_model_access.go) ----
//
// The MODEL_* variables are the generated agent's contract with the platform
// (skills/agent-building): every value comes from the org's model connection,
// so the agent names no provider, URL or model of its own.
const (
	modelEndpointEnvVar = "MODEL_ENDPOINT"
	modelNameEnvVar     = "MODEL_NAME"
	modelAPIKeyEnvVar   = "MODEL_API_KEY"
	// modelAPIFormatEnvVar is the API the agent's client speaks: the
	// connection's format, `anthropic` or `openai-compatible`, on both paths.
	modelAPIFormatEnvVar = "MODEL_API_FORMAT"
	// modelAPIAuthSchemeEnvVar is how the key is presented on the DIRECT path
	// (`x-api-key` or `bearer`). An Anthropic-format host other than
	// Anthropic's own API takes the key as a Bearer token, which the Anthropic
	// SDK sends only when asked to. The governed path leaves it unset: there
	// modelAPIKeyHeaderEnvVar names the one header the proxy reads.
	modelAPIAuthSchemeEnvVar = "MODEL_API_AUTH_SCHEME"

	// modelAPIKeyHeaderEnvVar / ampModelAPIKeyHeader are a HACK, and carry an
	// expiry date.
	//
	// Agent Manager's per-agent LLM proxy authenticates on a header of its own
	// choosing — `API-Key` — and that name is not configurable today. The
	// clients an AEP agent is built on send their credential as `x-api-key`
	// (Anthropic format) or `Authorization: Bearer` (OpenAI-compatible), and
	// the proxy reads neither, so a governed agent's request would arrive at
	// the proxy unauthenticated on every format. Naming the header here, and having
	// the agent template send the key under whatever name it finds, is what
	// bridges the two until Agent Manager makes the proxy's header
	// configurable — which its team has confirmed it will.
	//
	// WHEN THAT LANDS: stop setting this variable. The agent template already
	// falls back to the SDK's own default when it is unset, so every agent
	// reverts with no code change. Delete these two constants and the branch in
	// ModelAccessEnvVars that emits them.
	modelAPIKeyHeaderEnvVar = "MODEL_API_KEY_HEADER"
	ampModelAPIKeyHeader    = "API-Key"

	// The three variables Agent Manager's instrumentation contract defines for
	// an externally-hosted agent. An agent exports spans by POSTing to
	// ${AMP_OTEL_ENDPOINT}/v1/traces with `x-amp-api-key: ${AMP_AGENT_API_KEY}`.
	//
	// Composed ONLY when the agent has a stored tracing token — see
	// ai_agent_model_access.go, which explains why naming an absent secret
	// would stop the pod rather than merely stop the traces.
	ampOTelEndpointEnvVar = "AMP_OTEL_ENDPOINT"
	ampAgentAPIKeyEnvVar  = "AMP_AGENT_API_KEY"

	// otelServiceNameEnvVar names the agent in every span it emits.
	//
	// PLATFORM-OWNED, like MODEL_NAME, and for a sharper reason than tidiness.
	// OpenTelemetry's default resource is `unknown_service:node`, so an agent
	// that does not set one emits traces indistinguishable from every other
	// agent in the org — the spans are correct and the trace view is useless.
	// The component name is the identity AEP already governs by, so it is the
	// one the platform supplies rather than asking each generated agent to
	// invent it.
	//
	// OTEL_SERVICE_NAME is OpenTelemetry's own standard variable, not an AEP
	// invention: an SDK that runs resource detection picks it up with no code
	// at all, and building.md has the agent read it explicitly for the SDKs
	// that do not.
	otelServiceNameEnvVar = "OTEL_SERVICE_NAME"

	// TRACELOOP_TRACE_CONTENT decides whether an agent's spans carry message
	// content: prompts, completions, tool arguments and results. `true`
	// matches Agent Manager's own default, so a trace shows what the model was
	// told and what it answered. The value is always set explicitly, so the
	// decision stays the platform's and never an SDK default the agent
	// inherits; `false` keeps the tree, timings and token counts and drops only
	// the text. Content is the agent's most sensitive traffic — see
	// delivery/agentgovernance/design/governed-observability.md.
	traceloopTraceContentEnvVar = "TRACELOOP_TRACE_CONTENT"
	traceloopTraceContentValue  = "true"

	// modelAccessSecretRefName is the org-scoped SecretReference every
	// ai-agent component's MODEL_API_KEY points at — one per org, upserted
	// (not per component), since every agent shares the organisation's one
	// model connection key (ADR-0016, ADR-0038) and there is nothing per-agent
	// to provision.
	modelAccessSecretRefName = "ai-agent-model-access"
	// modelAccessSecretRefRefresh mirrors pushExternalSecret's cadence for
	// the same underlying credential.
	modelAccessSecretRefRefresh = "5m"
)

type componentService struct {
	client        openchoreo.ComponentClient
	artifactStore *spec.ArtifactStore
	// repoSvc + buildCredSvc are used by TriggerBuild to resolve the org's
	// github-pat SecretReference the build references. Optional — nil means
	// no reference (tests / unit-only flows).
	repoSvc      sourcecontrol.RepoService
	buildCredSvc BuildSecretStager
	// aiGatewayBindings resolves the environment's Agent Manager AI gateway.
	// Nil on a deployment with no Agent Manager, which composes the pre-AMP
	// direct-key path.
	aiGatewayBindings AIGatewayBindingReader
	// agentRecordName names an agent in Agent Manager, for the Deployments
	// page's link to it. See SetAgentRecordNamer.
	agentRecordName func(project, component string) string
	// guardrailOutcomes reads what the last deploy did with an agent's
	// declared guardrails. See SetGuardrailOutcomes.
	guardrailOutcomes GuardrailOutcomeReader
	// modelKeyResolver + secretRefClient back ModelAccessEnvVars, which the
	// deploy stage calls while composing an ai-agent's ReleaseBinding (see
	// ai_agent_model_access.go). Optional — nil means "not configured" (tests /
	// unit-only flows, or a deployment that hasn't wired the composition root
	// yet).
	modelKeyResolver ModelKeyResolver
	secretRefClient  secretmanagersvc.OpenChoreoSecretReferenceClient
	// autoRCADisabled turns the default auto-RCA alert rule off for this
	// deployment (no SRE handoff configured). Zero value = on.
	autoRCADisabled bool
}

// AutoRCASwitch is how the composition root hands the component service the
// deployment's auto-RCA switch (on when the SRE handoff is configured). It is a port of its
// own rather than a ComponentService method: that interface is what the HTTP
// handlers hold, and a wiring switch is not theirs to flip.
type AutoRCASwitch interface {
	SetAutoRCAEnabled(enabled bool)
}

var _ AutoRCASwitch = (*componentService)(nil)

// SetAutoRCAEnabled sets whether EnsureComponent attaches the default auto-RCA
// alert rule. DeploymentService takes the same value for the trait's
// per-environment config.
func (s *componentService) SetAutoRCAEnabled(enabled bool) {
	s.autoRCADisabled = !enabled
}

// NewComponentService builds the component service. repoSvc, buildCredSvc,
// modelKeyResolver, and secretRefClient may be nil in tests / unit-only
// flows; production wiring passes all four so TriggerBuild can name the org's
// github-pat SecretReference and ModelAccessEnvVars can compose MODEL_*
// for ai-agent components.
func NewComponentService(client openchoreo.ComponentClient, artifactStore *spec.ArtifactStore, repoSvc sourcecontrol.RepoService, buildCredSvc BuildSecretStager, modelKeyResolver ModelKeyResolver, secretRefClient secretmanagersvc.OpenChoreoSecretReferenceClient) ComponentService {
	return &componentService{
		client:           client,
		artifactStore:    artifactStore,
		repoSvc:          repoSvc,
		buildCredSvc:     buildCredSvc,
		modelKeyResolver: modelKeyResolver,
		secretRefClient:  secretRefClient,
	}
}

// SetAIGatewayBindings wires the reader that tells ModelAccessEnvVars whether an
// agent's model access is governed by Agent Manager.
//
// A setter rather than a constructor parameter, matching DeploymentService's
// SetModelAccess and for the same reason: it is optional, every existing caller
// composes correctly without it, and a deployment with no Agent Manager passes
// nothing.
func (s *componentService) SetAIGatewayBindings(r AIGatewayBindingReader) {
	s.aiGatewayBindings = r
}

func (s *componentService) ListComponents(ctx context.Context, orgName, projectName string, limit int, cursor string) (*gen.ComponentList, error) {
	list, err := s.client.ListComponents(ctx, orgName, projectName, limit, cursor)
	if err != nil {
		return nil, err
	}
	return list, nil
}

func (s *componentService) GetComponent(ctx context.Context, orgName, projectName, componentName string) (*gen.Component, error) {
	comp, err := s.client.GetComponent(ctx, orgName, projectName, componentName)
	if err != nil {
		return nil, err
	}
	return comp, nil
}

func (s *componentService) CreateComponent(ctx context.Context, orgName, projectName string, req *openchoreo.CreateComponentRequest) (*gen.Component, error) {
	comp, err := s.client.CreateComponent(ctx, orgName, projectName, req)
	if err != nil {
		return nil, err
	}
	return comp, nil
}

// EnsureComponent provisions the OpenChoreo Component CR (one per design
// component) needed for the build to fire when the merge push arrives.
// AutoBuild=false (every build is driven by the BFF pinning a WorkflowRun to the
// merge SHA) and AutoDeploy=false (every deploy is driven by the run
// supervisor's deploy stage pinning a ReleaseBinding).
//
// It is an UPSERT, not a create-if-absent. Two things depend on that:
//
//   - The trait SHAPE is frozen into the ComponentRelease cut from the build's
//     Workload, so a design edit that toggles `exposesAPI.auth` has to reach the
//     CR BEFORE the build. Asserting only at create meant the first component
//     ever built carried the right traits and every later edit silently did not.
//   - A component created while the platform still relied on AutoDeploy carries
//     autoDeploy=true. Left alone, OC's controller would keep promoting releases
//     underneath the deploy stage.
//
// Reads the design facts (app path, component type, api-security) via the
// artifact store and the repo row via repoSvc; both are the existing feature
// ports.
func (s *componentService) EnsureComponent(ctx context.Context, orgName, projectName, componentName string) error {
	if s.artifactStore == nil {
		return fmt.Errorf("ensure component: artifact store not configured")
	}
	if s.repoSvc == nil {
		return fmt.Errorf("ensure component: repo service not configured")
	}
	comp, err := spec.ResolveDesignComponent(ctx, s.artifactStore, orgName, projectName, componentName)
	if err != nil {
		return fmt.Errorf("ensure component: resolve design component %q: %w", componentName, err)
	}
	repo, err := s.repoSvc.GetRepo(ctx, orgName, projectName)
	if err != nil || repo == nil {
		return fmt.Errorf("ensure component: resolve project repo for %s/%s: %w", orgName, projectName, err)
	}

	k8sName := k8sname.ToK8sName(comp.Name)
	// Dockerfile context/path: the component's app path (repo-relative), or the
	// repo root when unset. Mirrors the legacy pre-flight.
	dockerContext := comp.AppPath
	dockerFilePath := "Dockerfile"
	if dockerContext != "" {
		dockerFilePath = dockerContext + "/Dockerfile"
	} else {
		dockerContext = "."
	}
	branch := repo.DefaultBranch
	if branch == "" {
		branch = "main"
	}
	// The trait SHAPE only — the per-environment config half of the same
	// projection lands on the ReleaseBinding at deploy, because it needs a
	// release to bind to. One function computes both so they cannot disagree.
	//
	// The operation table is part of the SHAPE (a trait parameter, one value
	// for every environment), so it is written HERE, before the build cuts the
	// release that freezes the Component's trait list.
	desired := DesiredDeploymentFor(DeploymentInputs{
		Component:       *comp,
		ComponentName:   k8sName,
		Audience:        ProjectAudience(orgName, projectName),
		AutoRCADisabled: s.autoRCADisabled,
	})
	if desired.APIOperationsProblem != "" {
		slog.WarnContext(ctx, "ensure component: OpenAPI contract not projected onto gateway operations; "+
			"the API keeps the trait's /* default (every operation needs a token, none needs a scope)",
			"org", orgName, "project", projectName, "component", comp.Name,
			"problem", desired.APIOperationsProblem)
	}
	for _, note := range desired.APIOperationsNotes {
		slog.InfoContext(ctx, "ensure component: operation left out of the gateway table",
			"org", orgName, "project", projectName, "component", comp.Name, "note", note)
	}
	desiredSpec := openchoreo.ComponentSpecDesired{
		Traits:     desired.Traits,
		AutoBuild:  false,
		AutoDeploy: false,
	}

	// repository.secretRef stays empty here: each build WorkflowRun names the
	// org's github-pat SecretReference itself (TriggerBuild), so the
	// Component's workflow param carries none.
	if _, err := s.CreateComponent(ctx, orgName, projectName, &openchoreo.CreateComponentRequest{
		Name:        k8sName,
		DisplayName: comp.Name,
		Description: comp.Name,
		Type:        ocEntrypoint(comp.ComponentType),
		AutoBuild:   desiredSpec.AutoBuild,
		AutoDeploy:  desiredSpec.AutoDeploy,
		Workflow: &openchoreo.ComponentWorkflowSpec{
			Kind: "ClusterWorkflow",
			Name: openchoreo.BuilderClusterWorkflow,
			Parameters: &openchoreo.ComponentWorkflowParameters{
				Repository: &openchoreo.WorkflowRepository{
					URL:       repo.RepoURL,
					SecretRef: "",
					AppPath:   comp.AppPath,
					Revision:  &openchoreo.WorkflowRevision{Branch: branch},
				},
				Docker: &openchoreo.DockerParameters{Context: dockerContext, FilePath: dockerFilePath},
			},
		},
		Traits: desiredSpec.Traits,
	}); err != nil {
		return fmt.Errorf("ensure component: create OC component %q: %w", k8sName, err)
	}
	// The create above is a no-op on an existing component (the client refetches
	// on 409), so the desired spec is re-asserted unconditionally rather than
	// only on the create path — see the upsert note above.
	if err := s.client.ApplyComponentSpec(ctx, orgName, projectName, k8sName, desiredSpec); err != nil {
		return fmt.Errorf("ensure component: apply spec for %q: %w", k8sName, err)
	}
	slog.InfoContext(ctx, "ensure component: OC Component ensured", "org", orgName, "project", projectName, "component", k8sName)
	return nil
}

// ocEntrypoint maps a design component type to its OC Component entrypoint
// type. AEP's component types ARE OpenChoreo's (minus the `deployment/`
// prefix — see spec.ComponentTypeWebApplication), so this is a prefix
// re-attachment, not a translation. Unknown kinds deliberately fall back to
// deployment/service.
func ocEntrypoint(componentType string) string {
	switch componentType {
	case spec.ComponentTypeWebApplication:
		return "deployment/web-application"
	case spec.ComponentTypeAIAgent:
		return "deployment/ai-agent"
	default:
		return "deployment/service"
	}
}

// GetComponentOpenAPI reads the `specs/design/` tree via the ArtifactStore
// (assembling per-component design.json + openapi.yaml into the in-memory
// design) and returns the OpenAPI spec for the named component. The URL
// param is the k8s-shaped slug; we match it against k8sname.ToK8sName(design.Name)
// so callers can use the same identifier they use everywhere else (build,
// deploy, configs). Returns ErrComponentNotFound when no design exists or
// no component matches, ErrComponentNotService when the component exists
// but isn't a "service".
func (s *componentService) GetComponentOpenAPI(ctx context.Context, orgName, projectName, componentName string) (*gen.ComponentOpenAPI, error) {
	if s.artifactStore == nil {
		return nil, fmt.Errorf("artifact store not configured")
	}
	design, err := s.artifactStore.ReadDesign(ctx, orgName, projectName)
	if err != nil {
		if spec.IsNotFound(err) {
			return nil, ErrComponentNotFound
		}
		return nil, fmt.Errorf("read design: %w", err)
	}
	if design == nil {
		return nil, ErrComponentNotFound
	}
	for _, c := range design.Components {
		if k8sname.ToK8sName(c.Name) != componentName {
			continue
		}
		if c.ComponentType != spec.ComponentTypeService {
			return &gen.ComponentOpenAPI{
				ComponentName: componentName,
				ComponentType: c.ComponentType,
			}, ErrComponentNotService
		}
		return &gen.ComponentOpenAPI{
			ComponentName: componentName,
			ComponentType: c.ComponentType,
			Spec:          c.OpenAPISpec,
		}, nil
	}
	return nil, ErrComponentNotFound
}

func (s *componentService) ListDeployments(ctx context.Context, orgName, projectName, componentName string) (*gen.DeploymentList, error) {
	list, err := s.client.ListDeployments(ctx, orgName, projectName, componentName)
	if err != nil {
		return nil, err
	}
	s.withAgentManagerLinks(ctx, orgName, projectName, componentName, list)
	s.withGuardrailOutcomes(ctx, orgName, projectName, componentName, list)
	return list, nil
}

func (s *componentService) TriggerBuild(ctx context.Context, orgName, projectName, componentName string) (*gen.WorkflowRun, error) {
	// The build references the org's github-pat SecretReference by name
	// (StageBuildSecret returns that name after checking the repo belongs to
	// the org); nothing is written per run. The shared dockerfile-builder
	// workflow's checkout-source synthesises the git Secret from the
	// reference. Manual triggers from the console go through this path; the
	// webhook-driven dispatch path uses workflowRunService.dispatchBuild.
	runName := openchoreo.NewBuildRunName(projectName, componentName)
	buildSecretRef := ""
	if s.repoSvc != nil && s.buildCredSvc != nil {
		repo, err := s.repoSvc.GetRepo(ctx, orgName, projectName)
		switch {
		case err != nil:
			slog.WarnContext(ctx, "trigger-build: GetRepo failed; proceeding without git secret (build will fail at clone)",
				"orgName", orgName, "projectName", projectName, "error", err)
		case repo == nil || repo.RepoSlug == "":
			slog.WarnContext(ctx, "trigger-build: no repo / repoSlug; proceeding without git secret",
				"orgName", orgName, "projectName", projectName)
		default:
			secretRef, sErr := s.buildCredSvc.StageBuildSecret(ctx, orgName, repo.RepoSlug, runName)
			if sErr != nil {
				return nil, fmt.Errorf("trigger-build: stage-build-secret: %w", sErr)
			}
			buildSecretRef = secretRef
		}
	}
	run, err := s.client.TriggerBuild(ctx, orgName, projectName, componentName, buildSecretRef, runName)
	if err != nil {
		return nil, err
	}
	return run, nil
}

func (s *componentService) ListBuilds(ctx context.Context, orgName, projectName, componentName string, limit int, cursor string) (*gen.WorkflowRunList, error) {
	list, err := s.client.ListWorkflowRuns(ctx, orgName, projectName, componentName, limit, cursor)
	if err != nil {
		return nil, err
	}
	return list, nil
}

// GetBuildLogs reads one build's log live from OpenChoreo, after a cursor, and
// reports whether that read is the whole of it.
//
// The build's state is read BEFORE the log, deliberately. A build that finishes
// between the two reads is then reported as still running, and the caller polls
// once more and gets the tail — whereas reading the state last could declare a
// log complete while the lines written in between were never returned. The same
// read is the access check: the run must be the path's component's.
func (s *componentService) GetBuildLogs(ctx context.Context, orgName, projectName, componentName, buildName, cursor string) (*gen.BuildLogs, error) {
	after, err := parseLogCursor(cursor)
	if err != nil {
		return nil, err
	}
	run, err := s.client.GetWorkflowRun(ctx, orgName, buildName)
	if errors.Is(err, openchoreo.ErrNotFound) {
		return nil, ErrBuildExpired
	}
	if err != nil {
		return nil, fmt.Errorf("%w: read build: %w", ErrLogSourceUnavailable, err)
	}
	if run.ProjectName != projectName || run.ComponentName != componentName {
		return nil, ErrBuildNotInComponent
	}

	// The read reaches back past the cursor; the filter below drops what it re-reads.
	lines, err := s.client.GetWorkflowRunLogs(ctx, orgName, buildName, after)
	switch {
	case errors.Is(err, openchoreo.ErrNotFound) && run.Completed:
		// Deleted between the two reads: past its TTL.
		return nil, ErrBuildExpired
	case errors.Is(err, openchoreo.ErrNotFound):
		// Created, but its Argo workflow is not there yet: nothing written.
		lines = nil
	case err != nil:
		return nil, fmt.Errorf("%w: read build log: %w", ErrLogSourceUnavailable, err)
	}

	out := &gen.BuildLogs{Logs: []gen.BuildLogEntry{}, Complete: run.Completed}
	var newest time.Time
	for _, l := range lines {
		if l.Timestamp.IsZero() {
			// Unordered against the cursor; kept on the first read only, or every
			// tail read would repeat it.
			if after.IsZero() {
				out.Logs = append(out.Logs, gen.BuildLogEntry{Log: l.Log})
			}
			continue
		}
		if !l.Timestamp.After(after) {
			continue
		}
		out.Logs = append(out.Logs, gen.BuildLogEntry{Log: l.Log, Timestamp: logStamp(l.Timestamp)})
		if l.Timestamp.After(newest) {
			newest = l.Timestamp
		}
	}
	if !newest.IsZero() {
		out.NextCursor = logStamp(newest)
	}
	return out, nil
}

// logStamp is a line's time on the wire, at full precision. The cursor is the
// newest line's stamp: opaque to the client, which carries back what it was
// handed, and parsed back here by parseLogCursor.
func logStamp(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func parseLogCursor(cursor string) (time.Time, error) {
	if cursor == "" {
		return time.Time{}, nil
	}
	t, err := time.Parse(time.RFC3339Nano, cursor)
	if err != nil {
		return time.Time{}, ErrInvalidLogCursor
	}
	return t, nil
}
