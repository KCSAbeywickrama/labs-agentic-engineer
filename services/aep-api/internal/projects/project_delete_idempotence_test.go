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

package projects

import (
	"context"
	"errors"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
)

// A project delete is a cascade across five systems that fail independently:
// OpenChoreo, Temporal, the repo record, the executions rows and the run ledger.
// Only the first of them can refuse the delete. Everything after it is the
// platform's own state, and the platform's own state has NO other exit — there
// is no second endpoint that purges an execution row or ends a run supervisor.
//
// That is what these tests pin: the cascade must be re-runnable to completion,
// because the half-deleted project is the state operators actually find
// themselves in, and the retry is the only tool they have.

// TestDeleteProject_AlreadyGoneOCProjectStillTearsDownPlatformState is the
// regression for the defect that produced a run supervisor polling a deleted
// repository at attempt 300+.
//
// The OC Project going first is ordinary: a delete that got past OpenChoreo and
// then failed, an out-of-band teardown, or simply the same DELETE arriving
// twice. Treating that as a failed delete meant every retry took the same early
// return, so the supervisors were never abandoned, the repo record was never
// dropped and the executions and run rows were never purged — permanently,
// because this endpoint is the only thing that purges them.
func TestDeleteProject_AlreadyGoneOCProjectStillTearsDownPlatformState(t *testing.T) {
	t.Parallel()
	trace := &deleteTrace{}
	oc := &ocmocks.ProjectClientMock{
		DeleteProjectFunc: func(context.Context, string, string) error { return openchoreo.ErrNotFound },
	}
	repoSvc := &fakeRepoSvc{DeleteRepoFunc: func(context.Context, string, string) error {
		trace.steps = append(trace.steps, "repo")
		return nil
	}}
	execs := &fakeExecs{}
	abandoner := &fakeRunAbandoner{trace: trace}

	svc := NewProjectService(oc, repoSvc, nil, nil, execs)
	svc.SetStageSources(tracingRunRows{trace: trace}, fakeBindingsReader{})
	svc.SetRunAbandoner(abandoner)

	// "Already gone" is the requested end state, not a failure to report.
	if err := svc.DeleteProject(context.Background(), "acme", "web"); err != nil {
		t.Fatalf("an already-deleted OC project must not fail the teardown, got %v", err)
	}
	if abandoner.calls != 1 || abandoner.args != [2]string{"acme", "web"} {
		t.Errorf("run supervisors were not abandoned: calls=%d args=%v", abandoner.calls, abandoner.args)
	}
	if execs.deleteCalls != 1 || execs.deleteArgs != [2]string{"acme", "web"} {
		t.Errorf("executions purge: calls=%d args=%v, want 1 (acme,web)", execs.deleteCalls, execs.deleteArgs)
	}
	assertTeardownOrder(t, trace, "abandon", "repo", "purge")
}

// TestDeleteProject_IsIdempotent runs the whole cascade twice against a service
// that has already been fully torn down — OC answers not-found and the repo row
// is gone — and requires the second pass to succeed and to reach every step
// again.
//
// Re-running the teardown is not a no-op worth skipping: the pass that failed is
// precisely the one whose steps did not all run, so the retry has to attempt all
// of them rather than short-circuit on the parts that look done.
func TestDeleteProject_IsIdempotent(t *testing.T) {
	t.Parallel()
	trace := &deleteTrace{}
	oc := &ocmocks.ProjectClientMock{
		DeleteProjectFunc: func(context.Context, string, string) error { return openchoreo.ErrNotFound },
	}
	// The repo service reports success with nothing to delete — DeleteRepo
	// ensures absence rather than performing a removal (see its contract).
	repoSvc := &fakeRepoSvc{DeleteRepoFunc: func(context.Context, string, string) error {
		trace.steps = append(trace.steps, "repo")
		return nil
	}}
	execs := &fakeExecs{}
	abandoner := &fakeRunAbandoner{trace: trace}

	svc := NewProjectService(oc, repoSvc, nil, nil, execs)
	svc.SetStageSources(tracingRunRows{trace: trace}, fakeBindingsReader{})
	svc.SetRunAbandoner(abandoner)

	for attempt := 1; attempt <= 2; attempt++ {
		if err := svc.DeleteProject(context.Background(), "acme", "web"); err != nil {
			t.Fatalf("attempt %d: delete must be safe to re-run, got %v", attempt, err)
		}
	}
	if abandoner.calls != 2 {
		t.Errorf("abandon ran %d times across two deletes, want 2", abandoner.calls)
	}
	if execs.deleteCalls != 2 {
		t.Errorf("executions purge ran %d times across two deletes, want 2", execs.deleteCalls)
	}
	assertTeardownOrder(t, trace,
		"abandon", "repo", "purge",
		"abandon", "repo", "purge")
}

// --- webhook unregistration --------------------------------------------------

// TestDeleteProject_UnregistersWebhookBeforeDroppingTheRepoRow pins the ORDER,
// which is the only thing that makes the step possible at all: the hook id and
// the repo identity the credential resolves against both live on the repo row,
// so unregistering after DeleteRepo would have nothing left to address. The
// remote survives a project delete, so without this its webhook would go on
// posting deliveries for a project the platform has forgotten.
func TestDeleteProject_UnregistersWebhookBeforeDroppingTheRepoRow(t *testing.T) {
	t.Parallel()
	trace := &deleteTrace{}
	oc := &ocmocks.ProjectClientMock{
		DeleteProjectFunc: func(context.Context, string, string) error { return nil },
	}
	repoSvc := &fakeRepoSvc{DeleteRepoFunc: func(context.Context, string, string) error {
		trace.steps = append(trace.steps, "repo")
		return nil
	}}
	webhooks := &fakeWebhookSvc{trace: trace}
	abandoner := &fakeRunAbandoner{trace: trace}

	svc := NewProjectService(oc, repoSvc, webhooks, nil, &fakeExecs{})
	svc.SetStageSources(tracingRunRows{trace: trace}, fakeBindingsReader{})
	svc.SetRunAbandoner(abandoner)

	if err := svc.DeleteProject(context.Background(), "acme", "web"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if webhooks.unregisterCalls != 1 || webhooks.unregisterArgs != [2]string{"acme", "web"} {
		t.Fatalf("unregister: calls=%d args=%v, want 1 (acme,web)",
			webhooks.unregisterCalls, webhooks.unregisterArgs)
	}
	assertTeardownOrder(t, trace, "abandon", "webhook", "repo", "purge")
}

// TestDeleteProject_WebhookUnregisterFailureIsSwallowed: a webhook left on a
// repository is untidy, not dangerous — the event plane resolves every delivery
// through the repo row and drops what it cannot place. It must never be the
// thing that blocks a delete, least of all one whose OC half is already
// committed and cannot be undone.
func TestDeleteProject_WebhookUnregisterFailureIsSwallowed(t *testing.T) {
	t.Parallel()
	trace := &deleteTrace{}
	oc := &ocmocks.ProjectClientMock{
		DeleteProjectFunc: func(context.Context, string, string) error { return nil },
	}
	repoSvc := &fakeRepoSvc{DeleteRepoFunc: func(context.Context, string, string) error {
		trace.steps = append(trace.steps, "repo")
		return nil
	}}
	webhooks := &fakeWebhookSvc{trace: trace, UnregisterFunc: func(context.Context, string, string) error {
		return errors.New("github unreachable")
	}}
	execs := &fakeExecs{}

	svc := NewProjectService(oc, repoSvc, webhooks, nil, execs)
	svc.SetStageSources(tracingRunRows{trace: trace}, fakeBindingsReader{})

	if err := svc.DeleteProject(context.Background(), "acme", "web"); err != nil {
		t.Fatalf("webhook cleanup failure must be best-effort, got %v", err)
	}
	// Everything downstream still ran — the delete completed.
	if execs.deleteCalls != 1 {
		t.Errorf("executions purge ran %d times after a failed unregister, want 1", execs.deleteCalls)
	}
	assertTeardownOrder(t, trace, "webhook", "repo", "purge")
}

// assertTeardownOrder compares the recorded steps against the expected cascade.
// The ORDER is the contract: a supervisor abandoned after its repository is gone
// has already spent a poll on a repository that no longer exists, and one
// abandoned after its rows are purged has nothing left to identify it by.
func assertTeardownOrder(t *testing.T, trace *deleteTrace, want ...string) {
	t.Helper()
	if len(trace.steps) != len(want) {
		t.Fatalf("teardown steps = %v, want %v", trace.steps, want)
	}
	for i := range want {
		if trace.steps[i] != want[i] {
			t.Fatalf("teardown steps = %v, want %v", trace.steps, want)
		}
	}
}
