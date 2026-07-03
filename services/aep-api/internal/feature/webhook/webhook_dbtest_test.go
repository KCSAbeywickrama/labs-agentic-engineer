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

package webhook

// DBTEST tier (skips under -short; the DB lane runs it): the SQL-shaped webhook
// behavior against a pristine per-test Postgres (dbtest.New). Two centerpieces:
//
//   - DeliveryStore dedup — the PK-on-delivery_id "at-most-once" guarantee that
//     is inherently SQL-shaped (a unique-violation on the second INSERT is what
//     distinguishes a fresh delivery from a replay). Cannot be faked.
//   - The App-installation lifecycle handlers over a REAL orgcreds.CredentialService
//     + REAL TaskRepository — status flips, selected-repo merges, and the
//     installation.deleted → disconnect cascade that abandons the org's in-flight
//     tasks. The cascade's org scoping and terminal-cause stamping are proven
//     against real rows.
//
// SEAM (honest tier-fit): the reach-reconciliation cascade in
// handleReposRemoved gates task abandonment behind ListInstallationRepos, which
// mints an App installation token against a HARD-CODED api.github.com URL (no
// injectable transport on AppTokenMinter.httpClient). That confirm leg is
// therefore un-interceptable in-process → integration-owned. We prove the
// reachable halves here: Phase A (selected-repo merge) runs, and the safety
// property that a FAILED GitHub confirmation skips the cascade (tasks untouched).
// The positive abandon-projection it would run is the same org+project-scoped
// ApplyTaskEvent proven by handleDeleted below + task_dbtest_test.go +
// orgcreds/org_disconnect_dbtest_test.go.

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/wso2/aep/aep-api/internal/credentials"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/feature/orgcreds"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// ============================================================================
// DeliveryStore — PK-on-delivery_id dedup
// ============================================================================

func TestDeliveryStore_Persist_FirstDeliveryIsCreated(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	store := NewDeliveryStore(db)

	res, err := store.Persist(ctx, "delivery-1", "org-acme", "push", "", []byte(`{"ref":"refs/heads/main"}`))
	if err != nil {
		t.Fatalf("Persist: %v", err)
	}
	if !res.Created || res.AlreadyProcessed {
		t.Fatalf("first delivery must be Created (not AlreadyProcessed), got %+v", res)
	}

	// The dedup row AND the split payload row are both written.
	var deliv models.WebhookDelivery
	if err := db.Where("delivery_id = ?", "delivery-1").First(&deliv).Error; err != nil {
		t.Fatalf("delivery row must exist: %v", err)
	}
	if deliv.OcOrgID != "org-acme" || deliv.Event != "push" || deliv.ProcessedAt != nil {
		t.Fatalf("delivery row shape wrong: %+v", deliv)
	}
	var payload models.WebhookPayload
	if err := db.Where("delivery_id = ?", "delivery-1").First(&payload).Error; err != nil {
		t.Fatalf("payload row must exist alongside the delivery: %v", err)
	}
	// jsonb canonicalizes formatting on write, so compare JSON semantics, not
	// bytes (the model documents "Handlers re-parse on read").
	var got, want map[string]any
	if err := json.Unmarshal(payload.Payload, &got); err != nil {
		t.Fatalf("persisted payload is not valid JSON: %v (%s)", err, payload.Payload)
	}
	if err := json.Unmarshal([]byte(`{"ref":"refs/heads/main"}`), &want); err != nil {
		t.Fatalf("unmarshal expectation: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("payload not persisted (JSON-equal): got %s", payload.Payload)
	}
}

func TestDeliveryStore_Persist_DuplicateBeforeProcessingReRuns(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	store := NewDeliveryStore(db)

	if _, err := store.Persist(ctx, "dup-1", "org-acme", "push", "", []byte(`{}`)); err != nil {
		t.Fatalf("first Persist: %v", err)
	}
	// Same delivery_id, processed_at still NULL (handler hasn't finished): the PK
	// unique-violation is caught and reported as neither Created nor
	// AlreadyProcessed → the receiver RE-RUNS the (idempotent) handler.
	res, err := store.Persist(ctx, "dup-1", "org-acme", "push", "", []byte(`{}`))
	if err != nil {
		t.Fatalf("duplicate Persist must not error, got %v", err)
	}
	if res.Created || res.AlreadyProcessed {
		t.Fatalf("un-processed duplicate must be (Created=false, AlreadyProcessed=false), got %+v", res)
	}
}

func TestDeliveryStore_Persist_DuplicateAfterProcessingIsDeduped(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	store := NewDeliveryStore(db)

	if _, err := store.Persist(ctx, "done-1", "org-acme", "pull_request", "closed", []byte(`{}`)); err != nil {
		t.Fatalf("first Persist: %v", err)
	}
	if err := store.MarkProcessed(ctx, "done-1"); err != nil {
		t.Fatalf("MarkProcessed: %v", err)
	}
	// Replay of finished work: the existing row has processed_at set → dedup.
	// This is the assertion that catches a broken PK-dedup (a mutation that lets
	// the second INSERT succeed would re-run the handler → double-process).
	res, err := store.Persist(ctx, "done-1", "org-acme", "pull_request", "closed", []byte(`{}`))
	if err != nil {
		t.Fatalf("replay Persist: %v", err)
	}
	if !res.AlreadyProcessed {
		t.Fatalf("a replay of processed work must be AlreadyProcessed, got %+v", res)
	}
}

func TestDeliveryStore_MarkProcessed_ClearsErrorAndStampsTime(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	store := NewDeliveryStore(db)

	if _, err := store.Persist(ctx, "mp-1", "org-acme", "push", "", []byte(`{}`)); err != nil {
		t.Fatalf("Persist: %v", err)
	}
	if err := store.MarkFailed(ctx, "mp-1", "boom"); err != nil {
		t.Fatalf("MarkFailed: %v", err)
	}
	if err := store.MarkProcessed(ctx, "mp-1"); err != nil {
		t.Fatalf("MarkProcessed: %v", err)
	}

	var row models.WebhookDelivery
	if err := db.Where("delivery_id = ?", "mp-1").First(&row).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if row.ProcessedAt == nil {
		t.Fatal("MarkProcessed must stamp processed_at")
	}
	if row.ProcessError != "" {
		t.Fatalf("MarkProcessed must clear a prior process_error, got %q", row.ProcessError)
	}
}

func TestDeliveryStore_MarkFailed_RecordsErrorLeavesUnprocessed(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	store := NewDeliveryStore(db)

	if _, err := store.Persist(ctx, "mf-1", "org-acme", "push", "", []byte(`{}`)); err != nil {
		t.Fatalf("Persist: %v", err)
	}
	if err := store.MarkFailed(ctx, "mf-1", "image push denied"); err != nil {
		t.Fatalf("MarkFailed: %v", err)
	}

	var row models.WebhookDelivery
	if err := db.Where("delivery_id = ?", "mf-1").First(&row).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	// process_error recorded for audit; processed_at stays NULL so a GitHub
	// redelivery re-enters the handler.
	if row.ProcessError != "image push denied" {
		t.Fatalf("process_error = %q; want the recorded message", row.ProcessError)
	}
	if row.ProcessedAt != nil {
		t.Fatal("a failed delivery must remain unprocessed (processed_at NULL)")
	}
}

func TestDeliveryStore_Persist_EmptyDeliveryIDRejected(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	ctx := context.Background()
	store := NewDeliveryStore(db)

	if _, err := store.Persist(ctx, "", "org-acme", "push", "", []byte(`{}`)); err == nil {
		t.Fatal("an empty delivery id must be rejected (it is the dedup PK)")
	}
}

// ============================================================================
// App-installation lifecycle handlers — real CredentialService + TaskRepository
// ============================================================================

// fakeIssueSvc records CommentIssue calls; the rest of the IssueService surface
// is not reached by these cascades and panics if called.
type fakeIssueSvc struct {
	comments []string
}

func (f *fakeIssueSvc) CommentIssue(_ context.Context, _ string, _ string, _ int, body string) error {
	f.comments = append(f.comments, body)
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

// credAESKey is a fixed 32-byte AES-256 key for the real credential store. The
// tested handler paths never read/write it (app-installation Disconnect GCs only
// user-pat store keys), but wiring the real store keeps the CredentialService
// exactly as production constructs it.
const credAESKey = "0123456789abcdef0123456789abcdef"

// newInstallCredSvc builds a real CredentialService over the dbtest DB in
// no-App mode (nil key material): the DB-only routing/status/merge methods the
// installation handlers use run for real; the GitHub-touching mint path returns
// ErrAppNotConfigured (never nil-derefs), which is exactly the un-interceptable
// confirm leg documented above.
func newInstallCredSvc(t *testing.T, db *gorm.DB) *orgcreds.CredentialService {
	t.Helper()
	store, err := credentials.NewDBStore(db, []byte(credAESKey))
	if err != nil {
		t.Fatalf("NewDBStore: %v", err)
	}
	minter, err := credentials.NewAppTokenMinter(nil)
	if err != nil {
		t.Fatalf("NewAppTokenMinter: %v", err)
	}
	return orgcreds.NewCredentialService(db, store, minter, "", "", "", nil)
}

// insertAppRow inserts an app-installation org_credentials row directly,
// satisfying the schema CHECKs (installation_id NOT NULL, webhook_secrets NULL).
func insertAppRow(t *testing.T, db *gorm.DB, ocOrgID string, installID int64, status string, selected []string) {
	t.Helper()
	id := installID
	row := models.OrgCredential{
		OcOrgID:        ocOrgID,
		Kind:           "app-installation",
		GitHubLogin:    ocOrgID + "-org",
		IdentityName:   "AEP Bot",
		IdentityEmail:  "bot@aep.dev",
		IdentityLogin:  "aep[bot]",
		InstallationID: &id,
		SelectedRepos:  models.JSONStringList(selected),
		Status:         status,
		ConnectedAt:    time.Now().UTC(),
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatalf("insert app row %s: %v", ocOrgID, err)
	}
}

func loadCred(t *testing.T, db *gorm.DB, ocOrgID string) models.OrgCredential {
	t.Helper()
	var row models.OrgCredential
	if err := db.Where("oc_org_id = ?", ocOrgID).First(&row).Error; err != nil {
		t.Fatalf("load cred %s: %v", ocOrgID, err)
	}
	return row
}

// dispatch wires the real installation handlers on a fresh Router and dispatches
// one event through it — exactly the receiver's dispatch leg.
func dispatchInstall(t *testing.T, db *gorm.DB, credSvc *orgcreds.CredentialService, issues gitrepo.IssueService, event, payload string) error {
	t.Helper()
	router := NewRouter()
	RegisterInstallationHandlers(router, db, credSvc, issues, repositories.NewTaskRepository(db))
	return router.Dispatch(context.Background(), event, []byte(payload))
}

func TestInstall_Suspend_Unsuspend_FlipStatus(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	credSvc := newInstallCredSvc(t, db)
	insertAppRow(t, db, "acme", 999, "active", nil)

	if err := dispatchInstall(t, db, credSvc, &fakeIssueSvc{}, "installation", `{"action":"suspend","installation":{"id":999}}`); err != nil {
		t.Fatalf("suspend dispatch: %v", err)
	}
	if got := loadCred(t, db, "acme").Status; got != "suspended" {
		t.Fatalf("installation.suspend must flip status to suspended, got %q", got)
	}

	if err := dispatchInstall(t, db, credSvc, &fakeIssueSvc{}, "installation", `{"action":"unsuspend","installation":{"id":999}}`); err != nil {
		t.Fatalf("unsuspend dispatch: %v", err)
	}
	if got := loadCred(t, db, "acme").Status; got != "active" {
		t.Fatalf("installation.unsuspend must flip status back to active, got %q", got)
	}
}

func TestInstall_ReposAdded_MergesSelectedRepos(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	credSvc := newInstallCredSvc(t, db)
	insertAppRow(t, db, "acme", 888, "active", []string{"acme/web"})

	err := dispatchInstall(t, db, credSvc, &fakeIssueSvc{}, "installation_repositories",
		`{"action":"added","installation":{"id":888},"repositories_added":[{"full_name":"acme/new"}]}`)
	if err != nil {
		t.Fatalf("added dispatch: %v", err)
	}

	got := map[string]bool{}
	for _, r := range loadCred(t, db, "acme").SelectedRepos {
		got[r] = true
	}
	if !got["acme/web"] || !got["acme/new"] {
		t.Fatalf("added repo must be merged into selected_repos, got %v", got)
	}
}

func TestInstall_ReposRemoved_PhaseAMergesAndConfirmFailSkipsCascade(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	credSvc := newInstallCredSvc(t, db)
	insertAppRow(t, db, "acme", 777, "active", []string{"acme/web", "acme/api"})

	// A repo mapping + a live task under (acme, web): the cascade WOULD abandon it
	// if GitHub confirmed the removal.
	if err := repositories.NewRepoRepository(db).Create(context.Background(), &models.GitRepository{
		OrgID: "acme", ProjectID: "web", Status: "ready", RepoURL: "https://github.com/acme/web.git",
	}); err != nil {
		t.Fatalf("seed repo: %v", err)
	}
	taskRepo := repositories.NewTaskRepository(db)
	task := &models.ComponentTask{OrgID: "acme", ProjectID: "web", ComponentName: "svc", Status: string(models.TaskStatusInProgress)}
	if err := taskRepo.Create(context.Background(), task); err != nil {
		t.Fatalf("seed task: %v", err)
	}

	err := dispatchInstall(t, db, credSvc, &fakeIssueSvc{}, "installation_repositories",
		`{"action":"removed","installation":{"id":777},"repositories_removed":[{"full_name":"acme/web"}]}`)
	if err != nil {
		t.Fatalf("removed dispatch: %v", err)
	}

	// Phase A ran: acme/web is gone from selected_repos.
	for _, r := range loadCred(t, db, "acme").SelectedRepos {
		if r == "acme/web" {
			t.Fatal("Phase A must remove acme/web from selected_repos")
		}
	}
	// Safety property: the GitHub confirm leg failed (no-App minter →
	// ErrAppNotConfigured), so the cascade is SKIPPED — the task is untouched.
	// A forged/unconfirmable removal must never abandon in-flight work.
	got, err := taskRepo.GetByID(context.Background(), task.ID)
	if err != nil {
		t.Fatalf("reload task: %v", err)
	}
	if got.Status != string(models.TaskStatusInProgress) {
		t.Fatalf("unconfirmed removal must NOT abandon the task, got %q", got.Status)
	}
}

func TestInstall_Deleted_CascadesDisconnectAndAbandonsTasks(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	credSvc := newInstallCredSvc(t, db)
	ctx := context.Background()
	insertAppRow(t, db, "acme", 555, "active", nil)
	// A decoy org that shares nothing but must prove the cascade is org-scoped.
	insertAppRow(t, db, "evil", 556, "active", nil)

	taskRepo := repositories.NewTaskRepository(db)
	seed := func(org, status string, issue int) string {
		task := &models.ComponentTask{OrgID: org, ProjectID: "web", ComponentName: "svc", Status: status, IssueNumber: issue}
		if err := taskRepo.Create(ctx, task); err != nil {
			t.Fatalf("seed task: %v", err)
		}
		return task.ID
	}
	pendingID := seed("acme", string(models.TaskStatusPending), 7)
	deployedID := seed("acme", string(models.TaskStatusDeployed), 8) // terminal — must NOT cascade
	evilID := seed("evil", string(models.TaskStatusInProgress), 9)   // other org — must NOT cascade

	issues := &fakeIssueSvc{}
	if err := dispatchInstall(t, db, credSvc, issues, "installation", `{"action":"deleted","installation":{"id":555}}`); err != nil {
		t.Fatalf("deleted dispatch: %v", err)
	}

	// The org's credential row is finalized to disconnected (Phase D).
	if got := loadCred(t, db, "acme").Status; got != "disconnected" {
		t.Fatalf("installation.deleted must finalize the row to disconnected, got %q", got)
	}
	// The non-terminal task cascaded to abandoned with the installation.deleted cause.
	pending, _ := taskRepo.GetByID(ctx, pendingID)
	if pending.Status != string(models.TaskStatusAbandoned) {
		t.Fatalf("pending task must cascade to abandoned, got %q", pending.Status)
	}
	if pending.Cause == nil || *pending.Cause != "installation.deleted" {
		t.Fatalf("cascade must stamp the installation.deleted cause, got %v", pending.Cause)
	}
	// Terminal + other-org tasks are untouched.
	if deployed, _ := taskRepo.GetByID(ctx, deployedID); deployed.Status != string(models.TaskStatusDeployed) {
		t.Fatalf("terminal task must be untouched, got %q", deployed.Status)
	}
	if ev, _ := taskRepo.GetByID(ctx, evilID); ev.Status != string(models.TaskStatusInProgress) {
		t.Fatalf("other org's task must NOT be cascaded, got %q", ev.Status)
	}
	// A best-effort abandonment comment was posted on the task's issue.
	if len(issues.comments) != 1 || !strings.Contains(issues.comments[0], "abandoned") {
		t.Fatalf("expected one abandonment comment, got %v", issues.comments)
	}
}

func TestInstall_Deleted_NoMatchingOrgAcksNoop(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	credSvc := newInstallCredSvc(t, db)
	// No org bound to installation 12345 → the handler resolves NotFound and
	// acks noop (returns nil) rather than erroring.
	err := dispatchInstall(t, db, credSvc, &fakeIssueSvc{}, "installation", `{"action":"deleted","installation":{"id":12345}}`)
	if err != nil {
		t.Fatalf("installation.deleted for an unknown install must ack noop, got %v", err)
	}
}
