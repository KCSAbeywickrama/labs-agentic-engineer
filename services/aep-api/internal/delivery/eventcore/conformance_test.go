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

package eventcore

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

// wiredWorkload is a workload.yaml that consumes the resource its design declares.
const wiredWorkload = `apiVersion: openchoreo.dev/v1alpha1
metadata:
  name: todo-api
endpoints:
  - name: http
    type: HTTP
    port: 9090
dependencies:
  resources:
    - ref: todo-webapp-todo-db
      envBindings:
        host: TODO_DB_HOST
        password: TODO_DB_PASSWORD
`

// sqliteWorkload is what the incident actually shipped: endpoints only, no
// resource consumed, so OpenChoreo injects nothing and the code quietly persists
// somewhere else.
const sqliteWorkload = `apiVersion: openchoreo.dev/v1alpha1
metadata:
  name: todo-api
endpoints:
  - name: http
    type: HTTP
    port: 9090
`

func conformanceRun() *delivery.MilestoneRun {
	return &delivery.MilestoneRun{OrgID: "acme", ProjectID: "todo-webapp", MilestoneNumber: 1}
}

// declares one platform resource for todo-api under App Path "todo-api".
func declaringDesign() fakeDesign {
	return fakeDesign{declared: map[string]ComponentResources{
		"todo-api": {AppPath: "todo-api", Refs: []string{"todo-webapp-todo-db"}},
	}}
}

func conformanceEvents(design fakeDesign, workloads fakeWorkloads) (*Events, *fakeIssues) {
	issues := newFakeIssues()
	return New(Ports{Issues: issues, Design: design, Workloads: workloads}), issues
}

func mintedTitles(f *fakeIssues) []string {
	var out []string
	for _, req := range f.created {
		out = append(out, req.Title)
	}
	return out
}

// THE INCIDENT, caught deterministically. The design declares postgres; the
// shipped workload.yaml declares no resource at all. The image builds and the pod
// starts, so nothing else in the platform would ever notice.
func TestConformance_MintsWhenAResourceIsNotConsumed(t *testing.T) {
	e, issues := conformanceEvents(declaringDesign(),
		fakeWorkloads{byPath: map[string]string{"todo-api/workload.yaml": sqliteWorkload}})

	e.checkWiringConformance(context.Background(), conformanceRun(), "todo-api")

	if len(issues.created) != 1 {
		t.Fatalf("want one fix issue, got %d: %v", len(issues.created), mintedTitles(issues))
	}
	req := issues.created[0]
	if want := "Wire the declared resources for todo-api"; req.Title != want {
		t.Errorf("title = %q, want %q", req.Title, want)
	}
	if !delivery.HasLabel(req.Labels, delivery.LabelAgentWork) {
		t.Error("the issue must be agent work, or no cycle picks it up")
	}
	if req.Milestone == nil || *req.Milestone != 1 {
		t.Error("the issue must join the run's milestone")
	}
	for _, want := range []string{
		"todo-webapp-todo-db",                          // names the missing ref
		"specs/design/components/todo-api/design.json", // where the answer already is
		"`wiring`",               // ... and what to read there
		"todo-api/workload.yaml", // where it goes
		"in-process store",       // name the substitution to undo
		"do not remove the dependency from the design", // no cheating the check
	} {
		if !strings.Contains(req.Body, want) {
			t.Errorf("issue body missing %q:\n%s", want, req.Body)
		}
	}
}

// A conformant component mints nothing — the check must be silent in the normal
// case or it is noise every merge.
func TestConformance_SilentWhenTheResourceIsConsumed(t *testing.T) {
	e, issues := conformanceEvents(declaringDesign(),
		fakeWorkloads{byPath: map[string]string{"todo-api/workload.yaml": wiredWorkload}})

	e.checkWiringConformance(context.Background(), conformanceRun(), "todo-api")

	if len(issues.created) != 0 {
		t.Errorf("a conformant component must mint nothing, got %v", mintedTitles(issues))
	}
}

// Redelivered webhooks and a second merge touching the same component must not
// pile up issues. The dedupe key is (component, refs).
func TestConformance_DedupesAcrossRedelivery(t *testing.T) {
	e, issues := conformanceEvents(declaringDesign(),
		fakeWorkloads{byPath: map[string]string{"todo-api/workload.yaml": sqliteWorkload}})

	for i := 0; i < 3; i++ {
		e.checkWiringConformance(context.Background(), conformanceRun(), "todo-api")
	}

	if len(issues.created) != 1 {
		t.Errorf("three passes must file one issue, got %d: %v", len(issues.created), mintedTitles(issues))
	}
	if issues.created[0].DedupeKey == "" {
		t.Error("the mint must carry a dedupe key — that is what makes redelivery safe")
	}
}

// Nothing declared, nothing to conform to. This is every component without a
// resource dependency, i.e. most of them.
func TestConformance_NoDeclaredResourcesIsNotAViolation(t *testing.T) {
	e, issues := conformanceEvents(
		fakeDesign{declared: map[string]ComponentResources{"todo-webapp": {AppPath: "todo-webapp"}}},
		fakeWorkloads{byPath: map[string]string{"todo-webapp/workload.yaml": sqliteWorkload}})

	e.checkWiringConformance(context.Background(), conformanceRun(), "todo-webapp")

	if len(issues.created) != 0 {
		t.Errorf("a component declaring no resources must mint nothing, got %v", mintedTitles(issues))
	}
}

// The check is a safety net, and a net that can fail the fan-out is worse than
// the hole it covers: every unavailable input is a logged no-op, and a component
// with no workload.yaml at all is the build's louder failure, not this one's.
func TestConformance_DegradesToNoOp(t *testing.T) {
	cases := map[string]struct {
		design    fakeDesign
		workloads fakeWorkloads
	}{
		"design read fails": {
			fakeDesign{err: errors.New("github down")},
			fakeWorkloads{byPath: map[string]string{"todo-api/workload.yaml": sqliteWorkload}},
		},
		"workload read fails": {
			declaringDesign(),
			fakeWorkloads{err: errors.New("github down")},
		},
		"no workload.yaml shipped": {
			declaringDesign(),
			fakeWorkloads{byPath: map[string]string{}},
		},
		"component absent from the design": {
			fakeDesign{declared: map[string]ComponentResources{}},
			fakeWorkloads{byPath: map[string]string{"todo-api/workload.yaml": sqliteWorkload}},
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			e, issues := conformanceEvents(tc.design, tc.workloads)
			e.checkWiringConformance(context.Background(), conformanceRun(), "todo-api")
			if len(issues.created) != 0 {
				t.Errorf("want a silent no-op, got %v", mintedTitles(issues))
			}
		})
	}
}

// An unwired port must not turn the check into a panic on the fan-out path.
func TestConformance_UnwiredPortsAreSafe(t *testing.T) {
	New(Ports{Issues: newFakeIssues()}).
		checkWiringConformance(context.Background(), conformanceRun(), "todo-api")
	New(Ports{Issues: newFakeIssues(), Design: declaringDesign()}).
		checkWiringConformance(context.Background(), conformanceRun(), "todo-api")
	New(Ports{}).checkWiringConformance(context.Background(), nil, "todo-api")
}

// The ref comparison itself. An App-Path-relative read and an unparseable
// descriptor are the two cases where a naive implementation goes wrong: the first
// looks in the wrong place, the second silently reports conformance for a file
// OpenChoreo cannot read at all.
func TestMissingResourceRefs(t *testing.T) {
	declared := []string{"p-db", "p-cache"}
	cases := map[string]struct {
		yaml string
		want []string
	}{
		"both consumed":       {"dependencies:\n  resources:\n    - ref: p-db\n    - ref: p-cache\n", nil},
		"one consumed":        {"dependencies:\n  resources:\n    - ref: p-db\n", []string{"p-cache"}},
		"none consumed":       {"endpoints:\n  - name: http\n", []string{"p-cache", "p-db"}},
		"empty resources":     {"dependencies:\n  resources: []\n", []string{"p-cache", "p-db"}},
		"endpoints only":      {"dependencies:\n  endpoints:\n    - component: x\n", []string{"p-cache", "p-db"}},
		"unparseable yaml":    {"dependencies: [oh no\n  resources:\n", []string{"p-cache", "p-db"}},
		"ref with whitespace": {"dependencies:\n  resources:\n    - ref: \"  p-db  \"\n", []string{"p-cache"}},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			got := missingResourceRefs(declared, tc.yaml)
			if strings.Join(got, ",") != strings.Join(tc.want, ",") {
				t.Errorf("missing = %v, want %v", got, tc.want)
			}
		})
	}
}

// A component that builds from the repo root reads workload.yaml at the root, not
// at "/workload.yaml".
func TestConformance_RootAppPathReadsRepoRoot(t *testing.T) {
	e, issues := conformanceEvents(
		fakeDesign{declared: map[string]ComponentResources{
			"mono": {AppPath: "", Refs: []string{"todo-webapp-todo-db"}},
		}},
		fakeWorkloads{byPath: map[string]string{"workload.yaml": wiredWorkload}})

	e.checkWiringConformance(context.Background(), conformanceRun(), "mono")

	if len(issues.created) != 0 {
		t.Errorf("a root-App-Path component's workload.yaml must be read at the repo root, got %v", mintedTitles(issues))
	}
}
