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

package codingagent

// UNIT tier: WorkflowRunService's coverable surface — the OC ComponentClient is
// moq'd (its interface has a house mock) and the task projector is faked at the
// contracts seam. The service is built via a struct literal so a test wires only
// the collaborators the path under test touches.
//
// HONEST GAP: DispatchTaskBuild's build-secret staging and RetryAuthFailedBuild's
// happy path both call *orgcreds.BuildCredentialsService (a CONCRETE dependency
// with no mockable port) and gitrepo.RepoService. Faking the world to force them
// through here would prove nothing the integration suite doesn't already
// exercise on every demo, so this file covers: (a) the paths reachable with a
// nil repoSvc+buildCredSvc (which the code explicitly guards for), (b) the moq'd
// OC-trigger surface, and (c) the pre-flight validation guards. The staged-secret
// happy path is declared integration-owned.

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/models"
)

func caTask() *models.ComponentTask {
	return &models.ComponentTask{
		ID:            "task-1",
		OrgID:         "acme",
		ProjectID:     "demo",
		ComponentName: "api",
	}
}

// ---- TriggerCodingAgent ----------------------------------------------------

func TestTriggerCodingAgent_HappyMapsParams(t *testing.T) {
	var got openchoreo.CodingAgentParams
	oc := &ocmocks.ComponentClientMock{
		TriggerCodingAgentFunc: func(_ context.Context, p openchoreo.CodingAgentParams) (*models.WorkflowRun, error) {
			got = p
			return &models.WorkflowRun{Name: "coding-agent-task-1-99"}, nil
		},
	}
	svc := &workflowRunService{ocClient: oc}

	runName, err := svc.TriggerCodingAgent(context.Background(), CodingAgentTrigger{
		Task:               caTask(),
		RepoURL:            "https://github.com/acme/demo.git",
		IdentityName:       "AEP Bot",
		IdentityEmail:      "bot@aep.dev",
		IdentityLogin:      "aep-bot",
		Prompt:             "do the thing",
		Bearer:             "task-jwt",
		GitServiceURL:      "http://git:9090",
		PlatformURL:        "http://bff:8080",
		AnthropicSecretRef: "acme-anthropic",
	})
	if err != nil {
		t.Fatalf("trigger: %v", err)
	}
	if runName != "coding-agent-task-1-99" {
		t.Fatalf("runName = %q", runName)
	}
	// The trigger struct is projected onto CodingAgentParams field-for-field.
	if got.OrgName != "acme" || got.ProjectName != "demo" || got.ComponentName != "api" || got.TaskID != "task-1" {
		t.Fatalf("identity fields not mapped: %+v", got)
	}
	if got.Prompt != "do the thing" || got.Bearer != "task-jwt" || got.PlatformURL != "http://bff:8080" {
		t.Fatalf("payload fields not mapped: %+v", got)
	}
	if got.AnthropicSecretRef != "acme-anthropic" {
		t.Fatalf("anthropic secretRef not mapped: %+v", got)
	}
}

func TestTriggerCodingAgent_Guards(t *testing.T) {
	// Each guard must reject BEFORE the OC client is touched.
	oc := &ocmocks.ComponentClientMock{
		TriggerCodingAgentFunc: func(context.Context, openchoreo.CodingAgentParams) (*models.WorkflowRun, error) {
			t.Fatal("OC client must not be called when a guard trips")
			return nil, nil
		},
	}
	svc := &workflowRunService{ocClient: oc}
	base := CodingAgentTrigger{
		Task:          caTask(),
		RepoURL:       "https://github.com/acme/demo.git",
		Bearer:        "task-jwt",
		GitServiceURL: "http://git:9090",
	}
	cases := []struct {
		name string
		mut  func(*CodingAgentTrigger)
	}{
		{"nil task", func(p *CodingAgentTrigger) { p.Task = nil }},
		{"empty bearer", func(p *CodingAgentTrigger) { p.Bearer = "" }},
		{"empty git-service URL", func(p *CodingAgentTrigger) { p.GitServiceURL = "" }},
		{"empty repo URL", func(p *CodingAgentTrigger) { p.RepoURL = "" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := base
			tc.mut(&p)
			if _, err := svc.TriggerCodingAgent(context.Background(), p); err == nil {
				t.Fatal("expected guard error")
			}
		})
	}
}

func TestTriggerCodingAgent_OCErrorWrapped(t *testing.T) {
	ocErr := errors.New("oc 500")
	oc := &ocmocks.ComponentClientMock{
		TriggerCodingAgentFunc: func(context.Context, openchoreo.CodingAgentParams) (*models.WorkflowRun, error) {
			return nil, ocErr
		},
	}
	svc := &workflowRunService{ocClient: oc}
	_, err := svc.TriggerCodingAgent(context.Background(), CodingAgentTrigger{
		Task: caTask(), RepoURL: "u", Bearer: "b", GitServiceURL: "g",
	})
	if err == nil {
		t.Fatal("want wrapped OC error, got nil")
	}
	// The service wraps with %w, so the underlying OC error stays unwrappable-to.
	if !errors.Is(err, ocErr) {
		t.Fatalf("OC error must be wrapped (errors.Is), got %v", err)
	}
	if !strings.Contains(err.Error(), "trigger coding-agent") {
		t.Fatalf("error should carry the operation context, got %q", err.Error())
	}
}

// ---- DispatchTaskBuild -----------------------------------------------------

func TestDispatchTaskBuild_IdempotentShortCircuit(t *testing.T) {
	// A task already built at this SHA with a run name recorded returns that
	// name and dispatches NOTHING (no OC call).
	oc := &ocmocks.ComponentClientMock{
		TriggerBuildAtCommitFunc: func(context.Context, string, string, string, string, string, string) (*models.WorkflowRun, error) {
			t.Fatal("must not trigger a build for an already-built SHA")
			return nil, nil
		},
	}
	svc := &workflowRunService{ocClient: oc}
	task := caTask()
	task.LastBuildSHA = "sha-abc"
	task.LastBuildRunName = "bld-existing"

	runName, err := svc.DispatchTaskBuild(context.Background(), task, "sha-abc")
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if runName != "bld-existing" {
		t.Fatalf("idempotent short-circuit must return the existing run, got %q", runName)
	}
	if len(oc.TriggerBuildAtCommitCalls()) != 0 {
		t.Fatalf("no OC trigger expected, got %d", len(oc.TriggerBuildAtCommitCalls()))
	}
}

func TestDispatchTaskBuild_HappyMarksBuildingViaProjector(t *testing.T) {
	// With no repoSvc/buildCredSvc wired (the code guards for both-nil), staging
	// is skipped and the build fires with an empty secretRef. The projector's
	// MarkBuilding is the atomic state+field write.
	oc := &ocmocks.ComponentClientMock{
		TriggerBuildAtCommitFunc: func(_ context.Context, org, proj, comp, sha, secretRef, runName string) (*models.WorkflowRun, error) {
			if secretRef != "" {
				t.Fatalf("no-staging path must pass empty secretRef, got %q", secretRef)
			}
			if sha != "sha-new" {
				t.Fatalf("sha = %q; want sha-new", sha)
			}
			return &models.WorkflowRun{Name: "bld-fresh"}, nil
		},
	}
	proj := &fakeProjector{}
	svc := &workflowRunService{ocClient: oc, projector: proj}

	runName, err := svc.DispatchTaskBuild(context.Background(), caTask(), "sha-new")
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if runName != "bld-fresh" {
		t.Fatalf("runName = %q", runName)
	}
	calls := proj.snapshot()
	if len(calls) != 1 || calls[0].method != "MarkBuilding" {
		t.Fatalf("expected one MarkBuilding call, got %+v", calls)
	}
	if calls[0].taskID != "task-1" || calls[0].sha != "sha-new" || calls[0].runName != "bld-fresh" {
		t.Fatalf("MarkBuilding args: %+v", calls[0])
	}
}

func TestDispatchTaskBuild_OCTriggerErrorPropagates(t *testing.T) {
	oc := &ocmocks.ComponentClientMock{
		TriggerBuildAtCommitFunc: func(context.Context, string, string, string, string, string, string) (*models.WorkflowRun, error) {
			return nil, errors.New("trigger boom")
		},
	}
	proj := &fakeProjector{}
	svc := &workflowRunService{ocClient: oc, projector: proj}
	if _, err := svc.DispatchTaskBuild(context.Background(), caTask(), "sha-new"); err == nil {
		t.Fatal("OC trigger error must propagate")
	}
	if len(proj.snapshot()) != 0 {
		t.Fatal("projector must not be called when the trigger fails")
	}
}

// ---- RetryAuthFailedBuild guards ------------------------------------------

func TestRetryAuthFailedBuild_NoClientConfigured(t *testing.T) {
	// nil repoSvc/buildCredSvc → refuses before any work. The happy path needs
	// a real BuildCredentialsService and is integration-owned (see file header).
	svc := &workflowRunService{}
	if _, err := svc.RetryAuthFailedBuild(context.Background(), caTask()); err == nil {
		t.Fatal("expected 'git client not configured' error")
	}
}
