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

// COMPONENT tier (bff-component-testing.md §4): the REAL design service behind
// the REAL production handler chain — global middleware → faked auth at the
// jwt.WithClaims seam → orgensure → Huma parsing/validation → the tenant gate
// in ENFORCE → mapDesignError — driven in-process via the componenttest
// harness. The store is the REAL artifacts.NewArtifactStore decorator; only its
// out-of-process artifact service (git) is faked at the interface. The agents
// client is nil here: the streaming generate op is an SSE side-effect proven at
// the unit tier (design_service_more_test.go), not an on-wire JSON contract.
//
// Body shapes are asserted against the harvested goldens (testdata/harvest/
// golden/) by FIELD SET — the low-maintenance contract, values scrubbed. Both
// the goldens and the served responses carry Huma's `$schema` link field; it is
// normalised away on both sides so the comparison asserts the design feature's
// own business field set, not Huma's schema-link injection (an infra concern).
//
// External test package: the harness imports api, which imports design — an
// in-package test file would be an import cycle.
package design_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/api"
	"github.com/wso2/aep/aep-api/internal/clients/agents"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts/artifactstest"
	"github.com/wso2/aep/aep-api/internal/feature/design"
	"github.com/wso2/aep/aep-api/internal/platform/componenttest"
)

const goldenDir = "../../../testdata/harvest/golden"

// validDesignTree is a well-formed working-tree map the REAL store assembles.
func validDesignTree() map[string]string {
	return map[string]string{
		artifacts.DesignRootFile:            "---\nsourceSpec: v1\n---\n\nOverview prose.\n",
		"components/hello-api/design.json":  "{\n  \"name\": \"hello-api\",\n  \"type\": \"service\",\n  \"language\": \"Go\",\n  \"description\": \"Build it.\",\n  \"dependencies\": []\n}\n",
		"components/hello-api/openapi.yaml": "openapi: 3.0.3\n",
	}
}

// happyReads returns a fake artifact service wired for the read-side ops:
// working tree + one tagged version, with the tag files equal to the tree
// (HasUnsavedChanges=false). Callers override fields for error cases.
func happyReads() *artifactstest.FakeArtifactService {
	return &artifactstest.FakeArtifactService{
		ListDesignFilesFunc: func(_ context.Context, _, _ string) (map[string]string, error) {
			return validDesignTree(), nil
		},
		ListDesignVersionsFunc: func(_ context.Context, _, _ string) ([]artifacts.DesignVersionInfo, error) {
			return []artifacts.DesignVersionInfo{{Tag: "v1-1", RequirementsVersion: 1, DesignRevision: 1, CommitHash: "d81ceeb"}}, nil
		},
		GetDesignAtTagFunc: func(_ context.Context, _, _, _ string) (map[string]string, error) {
			return validDesignTree(), nil
		},
	}
}

// newHarness assembles the real chain around the REAL design service; the
// agents client is nil (SSE generate is unit-tier), only the artifact service
// (git) is faked.
func newHarness(t *testing.T, fake *artifactstest.FakeArtifactService) *componenttest.Harness {
	t.Helper()
	var agentsClient agents.Client // nil — generate op not exercised here
	svc := design.NewDesignService(artifacts.NewArtifactStore(fake), agentsClient, fake)
	return componenttest.New(t, componenttest.Options{Deps: api.HumaDeps{DesignSvc: svc}})
}

// dropSchema removes Huma's infra `$schema` key so the design feature's own
// contract is what the field-set comparison asserts.
func dropSchema(keys []string) []string {
	out := make([]string, 0, len(keys))
	for _, k := range keys {
		if k == "$schema" {
			continue
		}
		out = append(out, k)
	}
	return out
}

func assertFieldSetMatchesGolden(t *testing.T, body, goldenName string) {
	t.Helper()
	got := dropSchema(componenttest.FieldSet(t, body))
	want := dropSchema(componenttest.GoldenFieldSet(t, filepath.Join(goldenDir, goldenName)))
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("%s field set drifted from golden:\n got %v\nwant %v", goldenName, got, want)
	}
}

func TestDesignComponent_GetMatchesGoldenFieldSet(t *testing.T) {
	t.Parallel()
	h := newHarness(t, happyReads())

	resp := h.AsOrg("acme").Get("/api/v1/projects/hello-world-api/design")
	if resp.Code != 200 {
		t.Fatalf("get design: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	assertFieldSetMatchesGolden(t, resp.Body.String(), "get_design.json")

	// Semantics: an approved, tagged design with no unsaved drift.
	var got map[string]any
	if err := json.Unmarshal(resp.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got["status"] != "approved" || got["sourceSpec"] != "v1" || got["hasUnsavedChanges"] != false {
		t.Fatalf("get design semantics drifted: %s", resp.Body.String())
	}
}

func TestDesignComponent_BundleMatchesGoldenFieldSet(t *testing.T) {
	t.Parallel()
	h := newHarness(t, happyReads())

	resp := h.AsOrg("acme").Get("/api/v1/projects/hello-world-api/design/bundle")
	if resp.Code != 200 {
		t.Fatalf("get bundle: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	assertFieldSetMatchesGolden(t, resp.Body.String(), "get_design_bundle.json")
}

func TestDesignComponent_BundleAtTagMatchesGoldenFieldSet(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		GetDesignAtTagFunc: func(_ context.Context, _, _, _ string) (map[string]string, error) {
			return validDesignTree(), nil
		},
	}
	h := newHarness(t, fake)

	resp := h.AsOrg("acme").Get("/api/v1/projects/hello-world-api/design/versions/v1-1/bundle")
	if resp.Code != 200 {
		t.Fatalf("bundle at tag: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	assertFieldSetMatchesGolden(t, resp.Body.String(), "get_design_bundle_at_tag.json")
}

func TestDesignComponent_VersionsMatchesGolden(t *testing.T) {
	t.Parallel()
	fake := &artifactstest.FakeArtifactService{
		ListDesignVersionsFunc: func(_ context.Context, _, _ string) ([]artifacts.DesignVersionInfo, error) {
			return []artifacts.DesignVersionInfo{{Tag: "v1-1", RequirementsVersion: 1, DesignRevision: 1, CommitHash: "d81ceeb"}}, nil
		},
	}
	h := newHarness(t, fake)

	resp := h.AsOrg("acme").Get("/api/v1/projects/hello-world-api/design/versions")
	if resp.Code != 200 {
		t.Fatalf("versions: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	// The versions golden is a bare JSON array; compare the element field set.
	got := firstElementKeys(t, resp.Body.Bytes())
	want := goldenFirstElementKeys(t, filepath.Join(goldenDir, "get_design_versions.json"))
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("versions element field set drifted:\n got %v\nwant %v", got, want)
	}
	if !strings.Contains(resp.Body.String(), `"tagName":"v1-1"`) || !strings.Contains(resp.Body.String(), `"sourceSpec":"v1"`) {
		t.Fatalf("versions row semantics drifted: %s", resp.Body.String())
	}
}

func TestDesignComponent_UpdateFileHappyAndValidation(t *testing.T) {
	t.Parallel()
	fake := happyReads()
	fake.PutFileFunc = func(context.Context, string, string, string, string, string) (*artifacts.PutResult, error) {
		return &artifacts.PutResult{SHA: "sha"}, nil
	}
	h := newHarness(t, fake)

	// Happy: writing a file returns the refreshed bundle.
	resp := h.AsOrg("acme").Put(
		"/api/v1/projects/hello-world-api/design/files/components/hello-api/design.json",
		`{"content":"# hello-api\n\nnew body"}`,
	)
	if resp.Code != 200 {
		t.Fatalf("update file: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if fs := dropSchema(componenttest.FieldSet(t, resp.Body.String())); strings.Join(fs, ",") != "design,files" {
		t.Fatalf("update-file must return the bundle {design,files}, got %v", fs)
	}

	// Validation: the body's `content` is a required schema property — a body
	// missing it is a Huma 422 that never reaches the service.
	resp = h.AsOrg("acme").Put(
		"/api/v1/projects/hello-world-api/design/files/components/hello-api/design.json",
		`{}`,
	)
	if resp.Code != 422 {
		t.Fatalf("missing content: want 422, got %d body=%s", resp.Code, resp.Body.String())
	}
	p := componenttest.DecodeProblem(t, resp.Body.String())
	if len(p.Errors) == 0 || !strings.Contains(p.Errors[0].Message, "expected required property content to be present") {
		t.Fatalf("422 shape drifted: %s", resp.Body.String())
	}
}

func TestDesignComponent_DeleteComponentHappy(t *testing.T) {
	t.Parallel()
	fake := happyReads()
	fake.DeleteDesignDirectoryFunc = func(context.Context, string, string, string) error { return nil }
	h := newHarness(t, fake)

	resp := h.AsOrg("acme").Delete("/api/v1/projects/hello-world-api/design/components/hello-api")
	if resp.Code != 200 {
		t.Fatalf("delete component: want 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if fs := dropSchema(componenttest.FieldSet(t, resp.Body.String())); strings.Join(fs, ",") != "design,files" {
		t.Fatalf("delete-component must return the bundle {design,files}, got %v", fs)
	}
}

// TestDesignComponent_ErrorMapping drives every design error branch that maps
// to an HTTP status through the real chain:
//   - the two mapDesignError branches (opaque→500, ErrDesignNotFound→404), and
//   - the two inline branches the save/bundle-at-tag handlers carry themselves
//     (ErrSpecNotApproved→409, artifact-not-found→404).
//
// Note on the mapDesignError 404: in production the read ops fold a missing
// artifact into an empty 200, so a store returning ErrDesignNotFound to the
// handler is the only way to reach it — injected here to prove the mapping.
func TestDesignComponent_ErrorMapping(t *testing.T) {
	t.Parallel()

	t.Run("opaque read error maps to 500 without leaking", func(t *testing.T) {
		t.Parallel()
		fake := &artifactstest.FakeArtifactService{
			ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
				return nil, errors.New("pg: connection refused")
			},
		}
		resp := newHarness(t, fake).AsOrg("acme").Get("/api/v1/projects/web/design")
		if resp.Code != 500 {
			t.Fatalf("want 500, got %d body=%s", resp.Code, resp.Body.String())
		}
		if p := componenttest.DecodeProblem(t, resp.Body.String()); p.Detail != "internal error" {
			t.Fatalf("500 detail: got %q", p.Detail)
		}
		if strings.Contains(resp.Body.String(), "connection refused") {
			t.Fatalf("500 body leaks internals: %s", resp.Body.String())
		}
	})

	t.Run("design-not-found maps to 404", func(t *testing.T) {
		t.Parallel()
		fake := &artifactstest.FakeArtifactService{
			ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
				return nil, artifacts.ErrDesignNotFound
			},
		}
		resp := newHarness(t, fake).AsOrg("acme").Get("/api/v1/projects/web/design/bundle")
		if resp.Code != 404 {
			t.Fatalf("want 404, got %d body=%s", resp.Code, resp.Body.String())
		}
		if p := componenttest.DecodeProblem(t, resp.Body.String()); p.Detail != "design not found" {
			t.Fatalf("404 detail: got %q", p.Detail)
		}
	})

	t.Run("save without a requirements baseline is 409", func(t *testing.T) {
		t.Parallel()
		fake := &artifactstest.FakeArtifactService{
			ListDesignFilesFunc: func(context.Context, string, string) (map[string]string, error) {
				return validDesignTree(), nil
			},
			SaveDesignFunc: func(context.Context, string, string, artifacts.SaveRequest) (*artifacts.DesignSaveResult, error) {
				return nil, errors.New("save failed: no requirements baseline exists")
			},
		}
		resp := newHarness(t, fake).AsOrg("acme").Post("/api/v1/projects/web/design/save", "")
		if resp.Code != 409 {
			t.Fatalf("want 409, got %d body=%s", resp.Code, resp.Body.String())
		}
		if p := componenttest.DecodeProblem(t, resp.Body.String()); !strings.Contains(p.Detail, "no v<N> baseline") {
			t.Fatalf("409 detail drifted: %q", p.Detail)
		}
	})

	t.Run("bundle at a missing tag is 404", func(t *testing.T) {
		t.Parallel()
		fake := &artifactstest.FakeArtifactService{
			GetDesignAtTagFunc: func(context.Context, string, string, string) (map[string]string, error) {
				return nil, artifacts.ErrArtifactNotFound
			},
		}
		resp := newHarness(t, fake).AsOrg("acme").Get("/api/v1/projects/web/design/versions/v9-9/bundle")
		if resp.Code != 404 {
			t.Fatalf("want 404, got %d body=%s", resp.Code, resp.Body.String())
		}
		if p := componenttest.DecodeProblem(t, resp.Body.String()); p.Detail != "design not found" {
			t.Fatalf("404 detail: got %q", p.Detail)
		}
	})
}

func TestDesignComponent_NoClaimsDeniedByEnforceGate(t *testing.T) {
	t.Parallel()
	h := newHarness(t, happyReads())

	resp := h.NoAuth().Get("/api/v1/projects/hello-world-api/design")
	if resp.Code != 401 {
		t.Fatalf("no-claims: want the gate's ENFORCE 401, got %d body=%s", resp.Code, resp.Body.String())
	}
	p := componenttest.DecodeProblem(t, resp.Body.String())
	if p.Status != 401 || len(p.Errors) == 0 || !strings.Contains(p.Errors[0].Message, "authentication required") {
		t.Fatalf("gate 401 problem shape: %s", resp.Body.String())
	}
}

// --- array-golden helpers ----------------------------------------------------

func firstElementKeys(t *testing.T, body []byte) []string {
	t.Helper()
	var arr []map[string]any
	if err := json.Unmarshal(body, &arr); err != nil {
		t.Fatalf("body is not a JSON array: %v\n%s", err, body)
	}
	if len(arr) == 0 {
		t.Fatalf("array body is empty: %s", body)
	}
	return sortedKeys(arr[0])
}

func goldenFirstElementKeys(t *testing.T, path string) []string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("golden %s: %v", path, err)
	}
	return firstElementKeys(t, raw)
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
