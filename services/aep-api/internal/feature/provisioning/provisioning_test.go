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

package provisioning

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/contracts/taskmeta"
	"github.com/wso2/aep/aep-api/internal/feature/dependencies/resources"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// ---- fakes -----------------------------------------------------------------

type fakeIssues struct {
	list     []gitrepo.IssueInfo
	created  []gitrepo.CreateIssueRequest
	closed   map[int]string
	comments map[int][]string
	nextNum  int
}

func newFakeIssues(seed []gitrepo.IssueInfo) *fakeIssues {
	max := 0
	for _, i := range seed {
		if i.Number > max {
			max = i.Number
		}
	}
	return &fakeIssues{list: seed, closed: map[int]string{}, comments: map[int][]string{}, nextNum: max + 1}
}

func (f *fakeIssues) ListIssues(_ context.Context, _, _ string, _ []string) ([]gitrepo.IssueInfo, error) {
	return f.list, nil
}
func (f *fakeIssues) CreateIssue(_ context.Context, _, _ string, req gitrepo.CreateIssueRequest) (*gitrepo.IssueResult, error) {
	f.created = append(f.created, req)
	n := f.nextNum
	f.nextNum++
	f.list = append(f.list, gitrepo.IssueInfo{Number: n, Title: req.Title, Body: req.Body, State: "open", Labels: req.Labels})
	return &gitrepo.IssueResult{Number: n}, nil
}
func (f *fakeIssues) CloseIssue(_ context.Context, _, _ string, number int, comment string) error {
	f.closed[number] = comment
	for i := range f.list {
		if f.list[i].Number == number {
			f.list[i].State = "closed"
		}
	}
	return nil
}
func (f *fakeIssues) CommentIssue(_ context.Context, _, _ string, number int, body string) error {
	f.comments[number] = append(f.comments[number], body)
	return nil
}

type fakeExecStore struct {
	rows   []*models.Execution
	nextID int
}

func (f *fakeExecStore) TryAdmit(_ context.Context, e *models.Execution) (bool, *models.Execution, error) {
	for _, r := range f.rows {
		if r.Repo == e.Repo && r.IssueNumber == e.IssueNumber && r.Kind == e.Kind &&
			taskmeta.ExecutionStatus(r.Status).IsActive() {
			return false, r, nil
		}
	}
	f.nextID++
	e.ID = fmt.Sprintf("exec-%d", f.nextID)
	f.rows = append(f.rows, e)
	return true, e, nil
}
func (f *fakeExecStore) StartWithRun(_ context.Context, id, runName string) (*models.Execution, error) {
	for _, r := range f.rows {
		if r.ID == id {
			r.Status = string(taskmeta.ExecRunning)
			r.RunName = runName
			now := time.Unix(1000, 0)
			r.StartedAt = &now
			return r, nil
		}
	}
	return nil, fmt.Errorf("not found")
}
func (f *fakeExecStore) Finish(_ context.Context, id, status, reason string) (*models.Execution, error) {
	for _, r := range f.rows {
		if r.ID == id {
			r.Status = status
			r.Reason = reason
			return r, nil
		}
	}
	return nil, nil
}
func (f *fakeExecStore) ListActive(_ context.Context) ([]models.Execution, error) {
	var out []models.Execution
	for _, r := range f.rows {
		if taskmeta.ExecutionStatus(r.Status).IsActive() {
			out = append(out, *r)
		}
	}
	return out, nil
}

type fakeReeval struct{ calls int }

func (f *fakeReeval) Reevaluate(context.Context) error { f.calls++; return nil }

type fakeDesign struct{ comps []models.DesignComponent }

func (f fakeDesign) ReadDesignComponents(context.Context, string, string) ([]models.DesignComponent, error) {
	return f.comps, nil
}

type fakeRepos struct{}

func (fakeRepos) RepoFullName(context.Context, string, string) (string, error) { return "o/r", nil }

type fakeCatalog struct {
	entries   map[string]*models.ExternalResource
	consumers map[string][]repositories.ExternalResourceConsumer
	deleted   []string
}

func (f *fakeCatalog) Get(_ context.Context, _, name string) (*models.ExternalResource, error) {
	return f.entries[name], nil
}
func (f *fakeCatalog) List(_ context.Context, _ string) ([]models.ExternalResource, error) {
	out := make([]models.ExternalResource, 0, len(f.entries))
	for _, e := range f.entries {
		out = append(out, *e)
	}
	return out, nil
}
func (f *fakeCatalog) Consumers(_ context.Context, _, name string) ([]repositories.ExternalResourceConsumer, error) {
	return f.consumers[name], nil
}
func (f *fakeCatalog) Delete(_ context.Context, _, name string) error {
	f.deleted = append(f.deleted, name)
	return nil
}

type fakeExtProv struct {
	calls  int
	byEnv  map[string]resources.EnvValues
	result *resources.ProvisionResult
	err    error
}

func (f *fakeExtProv) Provision(_ context.Context, _, _, _ string, _ *models.ExternalResource, byEnv map[string]resources.EnvValues) (*resources.ProvisionResult, error) {
	f.calls++
	f.byEnv = byEnv
	if f.err != nil {
		return nil, f.err
	}
	if f.result != nil {
		return f.result, nil
	}
	return &resources.ProvisionResult{ResourceName: "o-ext", BindingByEnv: map[string]string{"development": "o-ext-development"}}, nil
}
func (f *fakeExtProv) Deprovision(context.Context, string, string, string, []string) error {
	return nil
}

type fakePlatProv struct {
	calls  int
	params map[string]string
	result *resources.PlatformProvisionResult
	err    error
}

func (f *fakePlatProv) Provision(_ context.Context, _, _, depName, _ string, params map[string]string, _ []string) (*resources.PlatformProvisionResult, error) {
	f.calls++
	f.params = params
	if f.err != nil {
		return nil, f.err
	}
	if f.result != nil {
		return f.result, nil
	}
	return &resources.PlatformProvisionResult{ResourceName: "o-" + depName, BindingByEnv: map[string]string{"development": "o-" + depName + "-development"}}, nil
}
func (f *fakePlatProv) Deprovision(context.Context, string, string, string, []string) error {
	return nil
}

type fakeBindings struct {
	byName map[string]*openchoreo.ResourceReleaseBinding
}

func (f *fakeBindings) GetBinding(_ context.Context, _, name string) (*openchoreo.ResourceReleaseBinding, error) {
	return f.byName[name], nil
}

func readyBinding(outputs ...string) *openchoreo.ResourceReleaseBinding {
	st := &openchoreo.ResourceReleaseBindingStatus{
		Conditions: []openchoreo.OCCondition{{Type: "Ready", Status: "True"}},
	}
	for _, o := range outputs {
		st.Outputs = append(st.Outputs, openchoreo.ResolvedOutput{Name: o})
	}
	return &openchoreo.ResourceReleaseBinding{Status: st}
}

// ---- fixtures --------------------------------------------------------------

func designWithDeps() []models.DesignComponent {
	return []models.DesignComponent{{
		Name: "orders",
		Dependencies: []models.Dependency{
			{Kind: models.DependencyKindExternal, Name: "stripe", Config: []models.ConfigKey{
				{Key: "api_key", Secret: true}, {Key: "region"},
			}},
			{Kind: models.DependencyKindPlatformResource, Name: "orders-db", ResourceType: "postgres-cnpg", Parameters: map[string]string{"size": "small"}},
		},
	}}
}

func newTestService(issues *fakeIssues, execs *fakeExecStore, reeval Reevaluator, design DesignReader, catalog *fakeCatalog, ext *fakeExtProv, plat *fakePlatProv, bindings *fakeBindings) *Service {
	return NewService(issues, execs, reeval, design, fakeRepos{}, catalog, ext, plat, bindings)
}

// ---- tests -----------------------------------------------------------------

func TestEnsureProvisionIssues_MintsPerDepDeduped(t *testing.T) {
	issues := newFakeIssues(nil)
	svc := newTestService(issues, &fakeExecStore{}, &fakeReeval{}, fakeDesign{comps: designWithDeps()}, &fakeCatalog{}, &fakeExtProv{}, &fakePlatProv{}, &fakeBindings{})

	if err := svc.EnsureProvisionIssues(context.Background(), "org", "proj", "v1-1"); err != nil {
		t.Fatalf("EnsureProvisionIssues: %v", err)
	}
	if len(issues.created) != 2 {
		t.Fatalf("want 2 gate issues (stripe + orders-db), got %d", len(issues.created))
	}
	// Every gate issue carries the provision class label + a GateKind block field.
	var haveConfig, haveResource bool
	for _, req := range issues.created {
		if !contains(req.Labels, taskmeta.LabelProvision) {
			t.Errorf("gate issue missing aep:provision label: %v", req.Labels)
		}
		block, err := taskmeta.ParseBlock(req.Body)
		if err != nil {
			t.Fatalf("gate issue body has no block: %v", err)
		}
		switch block.GateKind {
		case taskmeta.GateConfigCollection:
			haveConfig = true
		case taskmeta.GateResourceProvisioning:
			haveResource = true
		default:
			t.Errorf("unexpected gateKind %q", block.GateKind)
		}
	}
	if !haveConfig || !haveResource {
		t.Fatalf("want both config-collection + resource-provisioning gate kinds")
	}

	// Idempotent: a second call mints nothing new (the deps already have open issues).
	issues.created = nil
	if err := svc.EnsureProvisionIssues(context.Background(), "org", "proj", "v1-1"); err != nil {
		t.Fatalf("EnsureProvisionIssues #2: %v", err)
	}
	if len(issues.created) != 0 {
		t.Fatalf("second mint must be a no-op, created %d", len(issues.created))
	}
}

func TestSaveValues_ProvisionsAndClosesGate(t *testing.T) {
	gate := provisionGateIssue(10, "stripe", taskmeta.GateConfigCollection)
	issues := newFakeIssues([]gitrepo.IssueInfo{gate})
	execs := &fakeExecStore{}
	reeval := &fakeReeval{}
	ext := &fakeExtProv{}
	catalog := &fakeCatalog{entries: map[string]*models.ExternalResource{
		"stripe": {Name: "stripe", ConfigKeys: []models.ConfigKey{{Key: "api_key", Secret: true}, {Key: "region"}}},
	}}
	svc := newTestService(issues, execs, reeval, fakeDesign{comps: designWithDeps()}, catalog, ext, &fakePlatProv{}, &fakeBindings{})

	err := svc.SaveValues(context.Background(), "org", "org", "proj", "stripe", map[string]map[string]string{
		"development": {"api_key": "sk_live_x", "region": "us"},
	})
	if err != nil {
		t.Fatalf("SaveValues: %v", err)
	}
	if ext.calls != 1 {
		t.Fatalf("external provisioner must be called once, got %d", ext.calls)
	}
	// Values split by schema: api_key → secret, region → plain. No secret leaks
	// into the plain map.
	ev := ext.byEnv["development"]
	if ev.Secret["api_key"] != "sk_live_x" || ev.Plain["region"] != "us" {
		t.Fatalf("split-by-schema wrong: %+v", ev)
	}
	if _, leaked := ev.Plain["api_key"]; leaked {
		t.Fatalf("secret api_key leaked into the plain map")
	}
	// The gate issue is closed and the funnel re-evaluated (consumers release).
	if _, closed := issues.closed[10]; !closed {
		t.Fatalf("gate issue must be closed after external provisioning")
	}
	if reeval.calls != 1 {
		t.Fatalf("Reevaluate must be called once, got %d", reeval.calls)
	}
	// The provision Execution derives deployed (succeeded provision run).
	if r := latestProvisionRow(execs); r == nil || r.Status != string(taskmeta.ExecSucceeded) {
		t.Fatalf("want a succeeded provision run, got %+v", r)
	}
	// No secret value appears in the close comment.
	if strings.Contains(issues.closed[10], "sk_live_x") {
		t.Fatalf("secret leaked into the close comment: %q", issues.closed[10])
	}
}

func TestProvision_PlatformIsAsync_LeftRunning(t *testing.T) {
	gate := provisionGateIssue(11, "orders-db", taskmeta.GateResourceProvisioning)
	issues := newFakeIssues([]gitrepo.IssueInfo{gate})
	execs := &fakeExecStore{}
	reeval := &fakeReeval{}
	plat := &fakePlatProv{}
	svc := newTestService(issues, execs, reeval, fakeDesign{comps: designWithDeps()}, &fakeCatalog{}, &fakeExtProv{}, plat, &fakeBindings{})

	if err := svc.Provision(context.Background(), "org", "proj", "orders-db", nil, nil); err != nil {
		t.Fatalf("Provision: %v", err)
	}
	if plat.calls != 1 {
		t.Fatalf("platform provisioner must be called once, got %d", plat.calls)
	}
	// Design parameters flow through (size=small).
	if plat.params["size"] != "small" {
		t.Fatalf("design params must reach the provisioner, got %+v", plat.params)
	}
	// Async: the run is RUNNING (not finished) and the gate stays OPEN — the
	// watcher completes it.
	r := latestProvisionRow(execs)
	if r == nil || r.Status != string(taskmeta.ExecRunning) {
		t.Fatalf("platform provision run must be left running, got %+v", r)
	}
	if r.RunName != "o-orders-db-development" {
		t.Fatalf("run must pin the development binding name, got %q", r.RunName)
	}
	if _, closed := issues.closed[11]; closed {
		t.Fatalf("gate issue must stay open until the binding is ready")
	}
	if reeval.calls != 0 {
		t.Fatalf("no reevaluate before readiness, got %d", reeval.calls)
	}
}

func TestResourceWatcher_ReadyClosesGateAndReleases(t *testing.T) {
	gate := provisionGateIssue(11, "orders-db", taskmeta.GateResourceProvisioning)
	issues := newFakeIssues([]gitrepo.IssueInfo{gate})
	execs := &fakeExecStore{}
	reeval := &fakeReeval{}
	bindings := &fakeBindings{byName: map[string]*openchoreo.ResourceReleaseBinding{}}
	plat := &fakePlatProv{}
	svc := newTestService(issues, execs, reeval, fakeDesign{comps: designWithDeps()}, &fakeCatalog{}, &fakeExtProv{}, plat, bindings)

	// Provision (async) → running row pinned to the binding.
	if err := svc.Provision(context.Background(), "org", "proj", "orders-db", nil, nil); err != nil {
		t.Fatalf("Provision: %v", err)
	}
	w := NewResourceWatcher(svc, nil, time.Second)
	// Pin the clock near StartedAt (Unix 1000) so the stale bound does not fire.
	w.now = func() time.Time { return time.Unix(1000, 0).Add(time.Minute) }

	// Binding not ready yet → watcher waits (run stays running, gate open).
	bindings.byName["o-orders-db-development"] = &openchoreo.ResourceReleaseBinding{}
	if err := w.Sweep(context.Background()); err != nil {
		t.Fatalf("Sweep (not ready): %v", err)
	}
	if r := latestProvisionRow(execs); r.Status != string(taskmeta.ExecRunning) {
		t.Fatalf("run must stay running while binding not ready, got %s", r.Status)
	}

	// Binding goes Ready → watcher finishes the run, closes the gate, reevaluates.
	bindings.byName["o-orders-db-development"] = readyBinding("host", "port")
	if err := w.Sweep(context.Background()); err != nil {
		t.Fatalf("Sweep (ready): %v", err)
	}
	if r := latestProvisionRow(execs); r == nil || r.Status != string(taskmeta.ExecSucceeded) {
		t.Fatalf("ready binding must finish the run succeeded, got %+v", r)
	}
	if _, closed := issues.closed[11]; !closed {
		t.Fatalf("gate issue must be closed once the binding is ready")
	}
	if reeval.calls != 1 {
		t.Fatalf("Reevaluate must fire once on readiness, got %d", reeval.calls)
	}
}

func TestResourceWatcher_StaleFails(t *testing.T) {
	gate := provisionGateIssue(11, "orders-db", taskmeta.GateResourceProvisioning)
	issues := newFakeIssues([]gitrepo.IssueInfo{gate})
	execs := &fakeExecStore{}
	bindings := &fakeBindings{byName: map[string]*openchoreo.ResourceReleaseBinding{"o-orders-db-development": {}}}
	svc := newTestService(issues, execs, &fakeReeval{}, fakeDesign{comps: designWithDeps()}, &fakeCatalog{}, &fakeExtProv{}, &fakePlatProv{}, bindings)
	if err := svc.Provision(context.Background(), "org", "proj", "orders-db", nil, nil); err != nil {
		t.Fatalf("Provision: %v", err)
	}
	w := NewResourceWatcher(svc, nil, time.Second)
	// Jump the clock past the stale window (StartedAt was stamped at Unix 1000).
	w.now = func() time.Time { return time.Unix(1000, 0).Add(31 * time.Minute) }
	if err := w.Sweep(context.Background()); err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if r := latestProvisionRow(execs); r == nil || r.Status != string(taskmeta.ExecFailed) {
		t.Fatalf("a stale provision run must be failed, got %+v", r)
	}
}

func TestStatus_MasksOutputsToNames(t *testing.T) {
	bindings := &fakeBindings{byName: map[string]*openchoreo.ResourceReleaseBinding{
		"proj-orders-db-development": readyBinding("host", "port"),
	}}
	svc := newTestService(newFakeIssues(nil), &fakeExecStore{}, &fakeReeval{}, fakeDesign{}, &fakeCatalog{}, &fakeExtProv{}, &fakePlatProv{}, bindings)
	st, err := svc.Status(context.Background(), "org", "proj", "orders-db", "")
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if !st.Ready || st.Status != "ready" {
		t.Fatalf("want ready, got %+v", st)
	}
	if len(st.Outputs) != 2 || st.Outputs[0] != "host" {
		t.Fatalf("outputs must be the masked names, got %+v", st.Outputs)
	}
}

func TestDeleteExternalResource_InUse409(t *testing.T) {
	catalog := &fakeCatalog{consumers: map[string][]repositories.ExternalResourceConsumer{
		"stripe": {{ProjectID: "proj", ComponentName: "orders"}},
	}}
	svc := newTestService(newFakeIssues(nil), &fakeExecStore{}, &fakeReeval{}, fakeDesign{}, catalog, &fakeExtProv{}, &fakePlatProv{}, &fakeBindings{})
	if err := svc.DeleteExternalResource(context.Background(), "org", "stripe"); err != ErrExternalResourceInUse {
		t.Fatalf("in-use delete must return ErrExternalResourceInUse, got %v", err)
	}
	if len(catalog.deleted) != 0 {
		t.Fatalf("an in-use resource must not be deleted")
	}
	// No consumers → delete proceeds.
	if err := svc.DeleteExternalResource(context.Background(), "org", "unused"); err != nil {
		t.Fatalf("delete of unused resource: %v", err)
	}
	if len(catalog.deleted) != 1 || catalog.deleted[0] != "unused" {
		t.Fatalf("unused resource must be deleted, got %v", catalog.deleted)
	}
}

func TestSaveValues_WrongKind400(t *testing.T) {
	// stripe is external; asking to provision it as a platform resource is wrong-kind.
	svc := newTestService(newFakeIssues(nil), &fakeExecStore{}, &fakeReeval{}, fakeDesign{comps: designWithDeps()}, &fakeCatalog{}, &fakeExtProv{}, &fakePlatProv{}, &fakeBindings{})
	err := svc.Provision(context.Background(), "org", "proj", "stripe", nil, nil)
	if err == nil || !strings.Contains(err.Error(), resources.ErrDepWrongKind.Error()) {
		t.Fatalf("provisioning an external dep as a resource must be wrong-kind, got %v", err)
	}
}

// ---- helpers ---------------------------------------------------------------

func provisionGateIssue(number int, depName, gateKind string) gitrepo.IssueInfo {
	block := taskmeta.Block{Component: depName, GateKind: gateKind, Origin: taskmeta.OriginSpecPlan, DesignTag: "v1-1"}
	return gitrepo.IssueInfo{
		Number: number,
		Title:  "Provision " + depName,
		Body:   taskmeta.ComposeBody(block, taskmeta.Human{Rationale: "r"}),
		State:  "open",
		Labels: taskmeta.NewTaskLabels(taskmeta.ClassProvision, taskmeta.OriginSpecPlan),
	}
}

func latestProvisionRow(execs *fakeExecStore) *models.Execution {
	var last *models.Execution
	for _, r := range execs.rows {
		if r.Kind == string(taskmeta.KindProvision) {
			last = r
		}
	}
	return last
}

func contains(ss []string, want string) bool {
	for _, s := range ss {
		if s == want {
			return true
		}
	}
	return false
}
