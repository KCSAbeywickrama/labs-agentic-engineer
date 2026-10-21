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

package seed

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/aestudiotools/aestudiotest"
	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/platform/apierr"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// UNIT tier for the seed-project slice over the real seed service and the
// in-memory pod: the one part is read whole, and the service's answers land
// on the envelope with the contract's codes.

var projectRef = sourcecontrol.RepoRef{Org: "default", Owner: "acme", Repo: "greeter"}

type repoRows struct{ row *sourcecontrol.GitRepository }

func (r repoRows) GetByOrgAndProjectID(_ context.Context, org, project string) (*sourcecontrol.GitRepository, error) {
	if r.row == nil || r.row.OrgID != org || r.row.ProjectID != project {
		return nil, nil
	}
	return r.row, nil
}

type ledger struct{ newest *spec.AgentTurn }

func (l ledger) Newest(context.Context, string, string) (*spec.AgentTurn, error) {
	return l.newest, nil
}

func newHandler(t *testing.T, l ledger) (*Handler, *aestudiotest.Fake) {
	t.Helper()
	pod := aestudiotest.New()
	raw, err := spec.MarshalDescriptor(spec.NewDescriptor("greeter", "", "2026-10-21T07:00:00Z"))
	if err != nil {
		t.Fatal(err)
	}
	pod.SeedRepo(projectRef, map[string]string{spec.DescriptorPath: string(raw)})
	row := &sourcecontrol.GitRepository{OrgID: "default", ProjectID: "p", RepoURL: "https://github.com/acme/greeter"}
	return New(spec.NewSeedService(pod, repoRows{row: row}, l)), pod
}

func goodTree() map[string]string {
	return map[string]string{
		"manifest.json": `{"format":"aespecs/1","producer":{"name":"code-to-spec","version":"1.0"},"product":"Greeter",` +
			`"source":{"repository":"local checkout","commit":"abcdef1"},"createdAt":"2026-10-21T08:00:00Z"}`,
		"specs/requirements/prd.md":                  "# Greeter\n\n## Features\n\n- [F1 Greeting](features/F1-greeting.md)\n",
		"specs/requirements/features/F1-greeting.md": "# F1 Greeting\n\n## User Stories\n\n- F1.1 As a visitor, I am greeted. *assumed*\n",
		"specs/design/domain-model.md":               "# Data\n\n```mermaid\nerDiagram\n```\n",
	}
}

func zipOf(t *testing.T, tree map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, content := range tree {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// request is the strict server's view of an upload of project "p": a
// multipart reader with the given parts, in order.
func request(t *testing.T, parts map[string][]byte) gen.SeedProjectRequestObject {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for field, content := range parts {
		part, err := w.CreateFormFile(field, "allocations.aespecs")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return gen.SeedProjectRequestObject{ProjectName: "p", Body: multipart.NewReader(&buf, w.Boundary())}
}

func ctx() context.Context { return tenant.WithBoundOrg(context.Background(), "default") }

func envelope(t *testing.T, err error) *apierr.Error {
	t.Helper()
	var e *apierr.Error
	if !errors.As(err, &e) {
		t.Fatalf("err = %v, want an envelope", err)
	}
	return e
}

func TestSeedProject_SeedsAndAnswers204(t *testing.T) {
	h, pod := newHandler(t, ledger{})
	res, err := h.SeedProject(ctx(), request(t, map[string][]byte{bundleField: zipOf(t, goodTree())}))
	if err != nil {
		t.Fatalf("SeedProject: %v", err)
	}
	if _, ok := res.(gen.SeedProject204Response); !ok {
		t.Fatalf("response = %T, want 204", res)
	}
	raw, _, err := pod.ReadFile(context.Background(), projectRef, "", "specs/requirements/prd.md")
	if err != nil || !strings.HasPrefix(string(raw), "# Greeter") {
		t.Fatalf("prd.md at tip = %q, %v", raw, err)
	}
}

func TestSeedProject_ABadBundleIs400WithItsReason(t *testing.T) {
	h, _ := newHandler(t, ledger{})
	tree := goodTree()
	tree["src/main.go"] = "package main"
	_, err := h.SeedProject(ctx(), request(t, map[string][]byte{bundleField: zipOf(t, tree)}))
	e := envelope(t, err)
	if e.Status != http.StatusBadRequest || e.Code != codeBundleRejected || !strings.Contains(e.Message, "src/main.go") {
		t.Fatalf("envelope = %+v", e)
	}

	_, err = h.SeedProject(ctx(), request(t, map[string][]byte{bundleField: []byte("not a zip")}))
	if e := envelope(t, err); e.Status != http.StatusBadRequest || e.Code != codeBundleRejected {
		t.Fatalf("envelope = %+v", e)
	}
}

func TestSeedProject_RejectedContentIs400WithItsReason(t *testing.T) {
	h, _ := newHandler(t, ledger{})
	tree := goodTree()
	tree["specs/requirements/prd.md"] = "\n"
	_, err := h.SeedProject(ctx(), request(t, map[string][]byte{bundleField: zipOf(t, tree)}))
	e := envelope(t, err)
	if e.Status != http.StatusBadRequest || e.Code != codeBundleRejected || !strings.Contains(e.Message, "prd.md") {
		t.Fatalf("envelope = %+v", e)
	}
}

func TestSeedProject_AfterATurnIs409(t *testing.T) {
	h, _ := newHandler(t, ledger{newest: &spec.AgentTurn{ID: "t1"}})
	_, err := h.SeedProject(ctx(), request(t, map[string][]byte{bundleField: zipOf(t, goodTree())}))
	if e := envelope(t, err); e.Status != http.StatusConflict || e.Code != codeAlreadyStarted {
		t.Fatalf("envelope = %+v", e)
	}
}

func TestSeedProject_MissingPartIs400(t *testing.T) {
	h, _ := newHandler(t, ledger{})
	_, err := h.SeedProject(ctx(), request(t, map[string][]byte{"files": []byte("x")}))
	if e := envelope(t, err); e.Status != http.StatusBadRequest || !strings.Contains(e.Message, bundleField) {
		t.Fatalf("envelope = %+v", e)
	}
}
