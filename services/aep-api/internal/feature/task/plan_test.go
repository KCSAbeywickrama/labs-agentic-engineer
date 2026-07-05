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

package task

import (
	"context"
	"io"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/agentsvc"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
)

// planDesign mirrors the REAL DesignReader contract (artifacts.ArtifactStore):
// ListDesignFiles/ListRequirements return paths RELATIVE to their spec roots
// (`design.md`, `components/<name>/design.json`) — NOT full repo paths. The
// e2e-found regression: plan.go copied these keys verbatim into the turn
// snapshot, so the agent's known-components set (derived from the
// `specs/design/components/<name>/` prefix) was always empty and every
// planTask failed UNKNOWN_COMPONENT.
type planDesign struct{ design, req map[string]string }

func (f planDesign) ReadDesign(context.Context, string, string) (*artifacts.DesignFile, error) {
	return &artifacts.DesignFile{}, nil
}
func (f planDesign) ListRequirements(context.Context, string, string) (map[string]string, error) {
	return f.req, nil
}
func (f planDesign) ListDesignFiles(context.Context, string, string) (map[string]string, error) {
	return f.design, nil
}

type planVersions struct{}

func (planVersions) ListRequirementsVersions(context.Context, string, string) ([]artifacts.RequirementsVersionInfo, error) {
	return []artifacts.RequirementsVersionInfo{{Tag: "requirements-v1"}}, nil
}
func (planVersions) ListDesignVersions(context.Context, string, string) ([]artifacts.DesignVersionInfo, error) {
	return []artifacts.DesignVersionInfo{{Tag: "design-v1"}}, nil
}
func (planVersions) GetRequirementsAtTag(context.Context, string, string, string) (map[string]string, error) {
	return map[string]string{}, nil
}
func (planVersions) GetDesignAtTag(context.Context, string, string, string) (map[string]string, error) {
	return map[string]string{}, nil
}

// capturingTurn records the TurnRequest and returns an already-finished stream.
type capturingTurn struct{ req *agentsvc.TurnRequest }

func (c *capturingTurn) Turn(_ context.Context, _, _, _ string, req agentsvc.TurnRequest) (io.ReadCloser, error) {
	c.req = &req
	return io.NopCloser(strings.NewReader("data: [DONE]\n\n")), nil
}

// TestStartPlan_SnapshotCarriesFullSpecPaths pins the snapshot-key contract:
// the plan turn's files map must anchor design/requirements content at the
// full `specs/...` repo paths the task-plan toolset derives components from.
func TestStartPlan_SnapshotCarriesFullSpecPaths(t *testing.T) {
	turn := &capturingTurn{}
	svc := NewPlanService(
		fakeRepos{repo: defaultRepo()},
		planDesign{
			design: map[string]string{
				"design.md":                              "# design",
				"components/hello-world-api/design.json": `{"name":"hello-world-api"}`,
			},
			req: map[string]string{"requirements.md": "# reqs"},
		},
		planVersions{},
		nil, // no lineage diff
		func(context.Context, string) (string, error) { return "sk-test", nil },
		nil, // no org skills
		turn,
		newFakeIssues(),
	)

	session, err := svc.StartPlan(context.Background(), "org1", "proj1")
	if err != nil {
		t.Fatalf("StartPlan: %v", err)
	}
	defer session.Stream(io.Discard, func() {})

	if turn.req == nil {
		t.Fatal("turn was never started")
	}
	for _, want := range []string{
		"specs/design/design.md",
		"specs/design/components/hello-world-api/design.json",
		"specs/requirements/requirements.md",
	} {
		if _, ok := turn.req.Files[want]; !ok {
			t.Errorf("snapshot missing full-path key %q (keys: %v)", want, keysOf(turn.req.Files))
		}
	}
	for _, stripped := range []string{"design.md", "components/hello-world-api/design.json", "requirements.md"} {
		if _, ok := turn.req.Files[stripped]; ok {
			t.Errorf("snapshot carries stripped key %q — components would derive empty", stripped)
		}
	}
	if turn.req.Toolset != "task-plan" {
		t.Errorf("toolset = %q, want task-plan", turn.req.Toolset)
	}
}

func keysOf(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
