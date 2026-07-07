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

// Component tier for the unified progress endpoint: the REAL Huma handler (via
// componenttest, tenant gate in ENFORCE) over GET
// /projects/{p}/executions/{id}/progress, with only the executions store faked.
// Proves the HTTP contract — the ProgressResponse shape, the terminal `final`
// flag, the no-claims 401, and the org fence: an execution owned by another org
// resolves (nil,nil) through GetByIDScoped and surfaces as 404, the S2S/read
// IDOR fence tasks-github-native §9.1 relies on.
package execution_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/wso2/aep/aep-api/internal/api"
	"github.com/wso2/aep/aep-api/internal/contracts"
	"github.com/wso2/aep/aep-api/internal/contracts/taskmeta"
	"github.com/wso2/aep/aep-api/internal/feature/execution"
	"github.com/wso2/aep/aep-api/internal/platform/componenttest"
	"github.com/wso2/aep/aep-api/models"
)

// fakeLookup fences GetByIDScoped to one org — a cross-org read misses
// (nil, nil), exactly as the repository does.
type fakeLookup struct {
	org string
	row *models.Execution
}

func (f fakeLookup) GetByIDScoped(_ context.Context, orgID, id string) (*models.Execution, error) {
	if orgID != f.org || f.row == nil || f.row.ID != id {
		return nil, nil
	}
	return f.row, nil
}

func newProgressHarness(t *testing.T, lookup execution.ExecutionLookup) *componenttest.Harness {
	t.Helper()
	// oc nil: a terminal coding execution reports terminal-ness without an OC
	// WorkflowRun read (build-step reads are the build kind's path).
	svc := execution.NewProgressService(lookup, nil)
	return componenttest.New(t, componenttest.Options{Deps: api.HumaDeps{ExecProgress: svc}})
}

const progressPath = "/api/v1/projects/widgets/executions/e1/progress"

func TestProgress_Terminal_ReturnsFinal(t *testing.T) {
	row := &models.Execution{ID: "e1", OrgID: "acme", ProjectID: "widgets",
		Kind: string(taskmeta.KindCoding), Status: string(taskmeta.ExecSucceeded)}
	h := newProgressHarness(t, fakeLookup{org: "acme", row: row})

	rec := h.AsOrg("acme").Get(progressPath)
	if rec.Code != http.StatusOK {
		t.Fatalf("progress: code %d (%s)", rec.Code, rec.Body.String())
	}
	var resp contracts.ProgressResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode progress: %v\n%s", err, rec.Body.String())
	}
	if !resp.Final {
		t.Errorf("a succeeded execution must report final=true, got %+v", resp)
	}
	if resp.SchemaVersion == 0 {
		t.Errorf("progress must carry a schema version, got %+v", resp)
	}
}

func TestProgress_CrossTenant_404(t *testing.T) {
	// The execution belongs to acme; a caller scoped to evil must 404 (the org
	// fence, not a leak of "exists but forbidden").
	row := &models.Execution{ID: "e1", OrgID: "acme", ProjectID: "widgets",
		Kind: string(taskmeta.KindCoding), Status: string(taskmeta.ExecRunning)}
	h := newProgressHarness(t, fakeLookup{org: "acme", row: row})

	if rec := h.AsOrg("evil").Get(progressPath); rec.Code != http.StatusNotFound {
		t.Fatalf("cross-tenant progress: code %d, want 404 (%s)", rec.Code, rec.Body.String())
	}
}

func TestProgress_NoAuth_401(t *testing.T) {
	h := newProgressHarness(t, fakeLookup{org: "acme"})
	if rec := h.NoAuth().Get(progressPath); rec.Code != http.StatusUnauthorized {
		t.Errorf("no-auth progress: code %d, want 401", rec.Code)
	}
}
