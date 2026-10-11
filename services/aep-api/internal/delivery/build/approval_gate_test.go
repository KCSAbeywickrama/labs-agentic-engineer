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

package build_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/delivery/build"
	"github.com/wso2/aep/aep-api/internal/platform/componenttest"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// The approval gate (approval_gate.go): the run provisions a platform resource
// only from the build's approval for it, and its deploy gate waits on every
// one the design declares, so a build that would deploy against a resource
// nobody provisioned or approved is refused before anything is committed.

// handledStatus is the preflight's "already handled" reading: true for a
// resource provisioned or in flight. It records each read.
type handledStatus struct {
	handled map[string]bool
	reads   []string
}

func (s *handledStatus) Ready(_ context.Context, _, _, dep string) (bool, error) {
	s.reads = append(s.reads, dep)
	return s.handled[dep], nil
}

// countingDeriver counts the pre-tag design derivations: each one commits to HEAD.
type countingDeriver struct{ calls int }

func (d *countingDeriver) DerivePlatformResourceFactsAtHead(context.Context, string, string) error {
	d.calls++
	return nil
}

// lunchDesign: an API on a database and a sign-in resource, and a web app on
// the same sign-in resource.
func lunchDesign() *gateDesign {
	return &gateDesign{comps: []spec.DesignComponent{
		{Name: "lunch-api", ComponentType: spec.ComponentTypeService, Dependencies: []spec.Dependency{
			{Kind: spec.DependencyKindPlatformResource, Name: "lunch-db", ResourceType: "postgres-cnpg"},
			{Kind: spec.DependencyKindPlatformResource, Name: "user-auth", ResourceType: "thunder-app"},
		}},
		{Name: "lunch-web", ComponentType: spec.ComponentTypeWebApplication, Dependencies: []spec.Dependency{
			{Kind: spec.DependencyKindPlatformResource, Name: "user-auth", ResourceType: "thunder-app"},
		}},
	}}
}

type approvalHarness struct {
	svc     *build.Service
	spy     *planSpy
	tagger  *fakeTagger
	deriver *countingDeriver
	status  *handledStatus
}

func newApprovalHarness(handled map[string]bool) approvalHarness {
	design := lunchDesign()
	h := approvalHarness{
		spy:     newPlanSpy(),
		tagger:  &fakeTagger{res: &spec.SpecSaveResult{Tag: "v1", Status: spec.SpecSaveApproved}},
		deriver: &countingDeriver{},
		status:  &handledStatus{handled: handled},
	}
	h.svc = withPlanPath(build.NewService(build.Deps{
		Repos: fakeRepos{}, Tagger: h.tagger, Design: design,
		Coord: build.NewInputsCoordinator(nil, h.deriver, design),
	}), h.spy)
	h.svc.SetProvisionStatus(h.status)
	return h
}

func (h approvalHarness) post(t *testing.T, body string) (int, string) {
	t.Helper()
	resp := newHarness(t, h.svc).AsOrg("acme").Post("/api/v1/projects/lunch/build", body)
	return resp.Code, resp.Body.String()
}

// The live-walk bug: a build sent with no approvals while the design's
// resources were never provisioned. Refused with each resource named once,
// and nothing committed, tagged or claimed.
func TestBuild_ApprovalGate_UnprovisionedResourcesWithoutApproval_409(t *testing.T) {
	h := newApprovalHarness(nil)

	code, body := h.post(t, `{"inputs":[]}`)
	if code != 409 {
		t.Fatalf("status = %d, want 409 (body=%s)", code, body)
	}
	e := componenttest.DecodeEnvelope(t, body)
	if e.Code != "platform_resources_not_approved" {
		t.Fatalf("code = %q, want platform_resources_not_approved", e.Code)
	}
	if !strings.Contains(e.Message, "lunch-db, user-auth") {
		t.Errorf("message = %q, want it to name lunch-db and user-auth", e.Message)
	}
	var named []string
	for _, d := range e.Details {
		named = append(named, strings.SplitN(d.Message, ":", 2)[0])
	}
	if strings.Join(named, ",") != "lunch-db,user-auth" {
		t.Errorf("details name %v, want each resource once: [lunch-db user-auth]", named)
	}
	if h.deriver.calls != 0 || h.tagger.called != 0 || len(h.spy.milestones()) != 0 {
		t.Errorf("a refused build did work: derived=%d tagged=%d milestones=%v",
			h.deriver.calls, h.tagger.called, h.spy.milestones())
	}
}

// An approval names the dependency, as provisioning keys the resource: one
// approval covers every component that consumes it. The approvals ride on to
// the run, which provisions from them, and an approved resource is not read.
func TestBuild_ApprovalGate_ApprovedResourcesBuild(t *testing.T) {
	h := newApprovalHarness(nil)

	code, body := h.post(t, `{"inputs":[
		{"component":"lunch-api","dependency":"lunch-db","kind":"platform-resource","approved":true,"parameters":{"instances":1}},
		{"component":"lunch-web","dependency":"user-auth","kind":"platform-resource","approved":true}
	]}`)
	if code != 200 {
		t.Fatalf("status = %d, want 200 (body=%s)", code, body)
	}
	if len(h.status.reads) != 0 {
		t.Errorf("read the readiness of approved resources: %v", h.status.reads)
	}
	started := h.spy.startedRuns()
	if len(started) != 1 {
		t.Fatalf("started %d runs, want 1", len(started))
	}
	var approved []string
	for _, in := range started[0].ProvisionInputs {
		if in.Kind == "platform-resource" && in.Approved {
			approved = append(approved, in.Dependency)
		}
	}
	if strings.Join(approved, ",") != "lunch-db,user-auth" {
		t.Errorf("run carries approvals for %v, want [lunch-db user-auth]", approved)
	}
}

// A rebuild or a retry of a version whose resources are provisioned, or still
// provisioning, carries no approval and is not refused for it.
func TestBuild_ApprovalGate_HandledResourcesNeedNoApproval(t *testing.T) {
	h := newApprovalHarness(map[string]bool{"lunch-db": true, "user-auth": true})

	if code, body := h.post(t, `{}`); code != 200 {
		t.Fatalf("status = %d, want 200 (body=%s)", code, body)
	}
	if h.tagger.called != 1 {
		t.Errorf("tagged %d times, want 1", h.tagger.called)
	}
}

// An input that does not approve is no approval; only the resource still
// missing one is named.
func TestBuild_ApprovalGate_UnapprovedInputIsNoApproval(t *testing.T) {
	h := newApprovalHarness(map[string]bool{"lunch-db": true})

	code, body := h.post(t, `{"inputs":[{"component":"lunch-api","dependency":"user-auth","kind":"platform-resource","approved":false}]}`)
	if code != 409 {
		t.Fatalf("status = %d, want 409 (body=%s)", code, body)
	}
	if e := componenttest.DecodeEnvelope(t, body); len(e.Details) != 1 || !strings.HasPrefix(e.Details[0].Message, "user-auth:") {
		t.Errorf("details = %+v, want user-auth alone", e.Details)
	}
}

// The provider-build auto-kick approves nothing, so it is refused rather than
// started into a deploy that cannot succeed.
func TestStartProjectBuild_UnprovisionedResources_Refused(t *testing.T) {
	h := newApprovalHarness(map[string]bool{"user-auth": true})

	err := h.svc.StartProjectBuild(context.Background(), "acme", "lunch")
	var refused *build.UnapprovedResourcesError
	if !errors.As(err, &refused) || strings.Join(refused.Resources, ",") != "lunch-db" {
		t.Fatalf("err = %v, want the refusal naming lunch-db", err)
	}
	if h.tagger.called != 0 || len(h.spy.admittedRuns()) != 0 {
		t.Errorf("a refused auto-kick did work: tagged=%d admitted=%d", h.tagger.called, len(h.spy.admittedRuns()))
	}
}
