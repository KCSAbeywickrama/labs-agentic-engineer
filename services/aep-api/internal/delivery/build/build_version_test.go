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
	"fmt"
	"testing"

	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// The name is the user's, and it is the tag that gets cut (console ADR-0030):
// the build hands it to the tagger verbatim.
func TestBuild_CutsTheVersionTheUserNamed(t *testing.T) {
	spy := newPlanSpy()
	tagger := &fakeTagger{res: &spec.SpecSaveResult{Status: spec.SpecSaveApproved, Tag: "payments-v2", Version: 2}}
	svc := withPlanPath(newSvc(fakeRepos{}, tagger), spy)

	resp := newHarness(t, svc).AsOrg("acme").
		Post("/api/v1/projects/shop/build", `{"version":"payments-v2"}`)

	if resp.Code != 200 {
		t.Fatalf("build: got %d body=%s", resp.Code, resp.Body.String())
	}
	if tagger.version != "payments-v2" {
		t.Errorf("tagger asked to cut %q, want payments-v2 — the name is not the platform's to change", tagger.version)
	}
	if out := decodeBody[gen.BuildResponse](t, resp.Body.String()); out.Tag != "payments-v2" {
		t.Errorf("tag = %q, want payments-v2", out.Tag)
	}
	// The milestone is the version's, so it carries the version's NAME.
	if got := spy.milestones(); len(got) != 1 || got[0] != "payments-v2" {
		t.Fatalf("milestones created = %v, want [payments-v2]", got)
	}
}

// A name somebody already used comes back as a conflict — never as a build on
// a quietly different tag.
func TestBuild_ANameAlreadyInUseIsAConflict(t *testing.T) {
	spy := newPlanSpy()
	tagger := &fakeTagger{err: fmt.Errorf("%w: %q", spec.ErrVersionNameTaken, "v2")}
	svc := withPlanPath(newSvc(fakeRepos{}, tagger), spy)

	resp := newHarness(t, svc).AsOrg("acme").
		Post("/api/v1/projects/shop/build", `{"version":"v2"}`)

	if resp.Code != 409 {
		t.Fatalf("build with a taken name: got %d, want 409 — body=%s", resp.Code, resp.Body.String())
	}
	if len(spy.milestones()) != 0 {
		t.Errorf("a refused name claimed a milestone: %v", spy.milestones())
	}
}

// A name a tag cannot hold is refused before anything is claimed.
func TestBuild_AMalformedNameIsABadRequest(t *testing.T) {
	spy := newPlanSpy()
	tagger := &fakeTagger{err: fmt.Errorf("%w: %s", spec.ErrVersionNameInvalid,
		"use letters, digits, dot, dash and underscore")}
	svc := withPlanPath(newSvc(fakeRepos{}, tagger), spy)

	resp := newHarness(t, svc).AsOrg("acme").
		Post("/api/v1/projects/shop/build", `{"version":"my version"}`)

	if resp.Code != 400 {
		t.Fatalf("build with a malformed name: got %d, want 400 — body=%s", resp.Code, resp.Body.String())
	}
}

// A build that names nothing takes the platform's suggestion — the ordinary
// click, and every build the platform starts for itself.
func TestBuild_NoNameLeavesTheSuggestionToTheTagger(t *testing.T) {
	spy := newPlanSpy()
	tagger := &fakeTagger{res: &spec.SpecSaveResult{Status: spec.SpecSaveApproved, Tag: "v4", Version: 4}}
	svc := withPlanPath(newSvc(fakeRepos{}, tagger), spy)

	code, body := postBuild(t, svc, "shop")

	if code != 200 {
		t.Fatalf("build: got %d body=%s", code, body)
	}
	if tagger.version != "" {
		t.Errorf("tagger asked to cut %q, want the empty suggestion", tagger.version)
	}
}
