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

package orgcreds

// DBTEST tier: the OrgDisconnectService cascade, exercised with a REAL
// CredentialService (honest tier-fit — NewOrgDisconnectService takes the
// concrete *CredentialService, not an interface, so faking it would prove
// nothing; ADR-0003 Pilot B). Real Postgres + real TaskRepository; only the
// out-of-process GitHub IssueService and the pure task-state transition are
// substituted. Pins Phase A (existence check → ErrOrgNotFound), Phase B/C
// (per-task comment + terminal transition + cause stamping), and Phase D
// (credential finalize).

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// fakeIssueSvc records CommentIssue calls; the other IssueService methods
// aren't reached by the disconnect cascade and panic if called.
type fakeIssueSvc struct {
	comments []issueComment
}

type issueComment struct {
	orgID, projectID, body string
	number                 int
}

func (f *fakeIssueSvc) CommentIssue(_ context.Context, orgID, projectID string, number int, body string) error {
	f.comments = append(f.comments, issueComment{orgID, projectID, body, number})
	return nil
}
func (f *fakeIssueSvc) CreateIssue(context.Context, string, string, gitrepo.CreateIssueRequest) (*gitrepo.IssueResult, error) {
	panic("fakeIssueSvc: CreateIssue not expected")
}
func (f *fakeIssueSvc) ListIssues(context.Context, string, string, []string) ([]gitrepo.IssueInfo, error) {
	panic("fakeIssueSvc: ListIssues not expected")
}
func (f *fakeIssueSvc) CloseIssue(context.Context, string, string, int, string) error {
	panic("fakeIssueSvc: CloseIssue not expected")
}
func (f *fakeIssueSvc) EditIssueBody(context.Context, string, string, int, string) error {
	panic("fakeIssueSvc: EditIssueBody not expected")
}

// applyAbandon is the injected task-state transition: every non-terminal task
// cascades to abandoned (the org.disconnected event target).
func applyAbandon(models.TaskStatus) (models.TaskStatus, error) {
	return models.TaskStatusAbandoned, nil
}

func TestOrgDisconnect_Cascade_DB(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	gh := patHappyGitHub(t, "ada", "Ada", "ada@x.io")
	credSvc, _ := newCredSvcDB(t, db, gh)
	if _, err := credSvc.Connect(ctx, "acme", ConnectRequest{Kind: "user-pat", PAT: "ghp", GitHubLogin: "ada"}); err != nil {
		t.Fatalf("connect: %v", err)
	}

	taskRepo := repositories.NewTaskRepository(db)
	task := &models.ComponentTask{
		OrgID:         "acme",
		ProjectID:     "web",
		ComponentName: "svc-a",
		Status:        string(models.TaskStatusPending),
		IssueNumber:   7,
	}
	if err := taskRepo.Create(ctx, task); err != nil {
		t.Fatalf("seed task: %v", err)
	}

	issues := &fakeIssueSvc{}
	svc := NewOrgDisconnectService(taskRepo, db, credSvc, issues, applyAbandon)

	if err := svc.Disconnect(ctx, "acme", "manual.disconnect", false); err != nil {
		t.Fatalf("disconnect cascade: %v", err)
	}

	// Phase D: the credential row is finalized.
	if row := getRow(t, db, "acme"); row.Status != "disconnected" {
		t.Fatalf("credential row status: %q", row.Status)
	}
	// Phase C: the task cascaded to a terminal status with the cause stamped.
	got, err := taskRepo.GetByID(ctx, task.ID)
	if err != nil {
		t.Fatalf("reload task: %v", err)
	}
	if got.Status != string(models.TaskStatusAbandoned) {
		t.Fatalf("task status: %q", got.Status)
	}
	if got.Cause == nil || *got.Cause != "manual.disconnect" {
		t.Fatalf("task cause: %v", got.Cause)
	}
	// Phase B: a best-effort abandonment comment was posted on the issue.
	if len(issues.comments) != 1 {
		t.Fatalf("comment calls: %+v", issues.comments)
	}
	c := issues.comments[0]
	if c.orgID != "acme" || c.projectID != "web" || c.number != 7 || !strings.Contains(c.body, "abandoned") {
		t.Fatalf("comment args: %+v", c)
	}
}

func TestOrgDisconnect_NotConnected_DB(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	credSvc, _ := newCredSvcDB(t, db, newStubGitHub(t))
	svc := NewOrgDisconnectService(repositories.NewTaskRepository(db), db, credSvc, &fakeIssueSvc{}, applyAbandon)

	// No credential row → Phase A surfaces ErrOrgNotFound (controller maps to
	// an idempotent not_connected 200).
	if err := svc.Disconnect(ctx, "ghost", "manual.disconnect", false); !errors.Is(err, ErrOrgNotFound) {
		t.Fatalf("want ErrOrgNotFound, got %v", err)
	}
}
