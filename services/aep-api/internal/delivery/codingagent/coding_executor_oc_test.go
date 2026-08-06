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

package codingagent

import (
	"context"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

// chainRecorder is the OC create-chain fake under the brief's name so the
// path-selection tests read clearly. Same package as fakeOCSurface.
type chainRecorder = fakeOCSurface

func (r *chainRecorder) client() OCJobSurface { return r }

// newOCDispatchExecutor is newCodingDispatchExecutor with the OC path wired and
// the proxy DELIBERATELY also configured — the OC path must win, because it is
// the only one that works in cloud after this phase.
func newOCDispatchExecutor(rec *chainRecorder) *CodingExecutor {
	anthropic, github := fullSecretRefs()
	e := newCodingDispatchExecutor(anthropic, github, nil, true)
	e.WithOCDispatch(NewOCDispatcher(rec.client()).WithImage("ghcr.io/wso2/aep/remote-worker:latest"))
	return e
}

// TestDispatch_OCPathWinsOverTheProxy pins the selection: with an OC dispatcher
// wired, a milestone cycle goes through OpenChoreo and the proxy is never
// consulted.
func TestDispatch_OCPathWinsOverTheProxy(t *testing.T) {
	rec := &chainRecorder{}
	e := newOCDispatchExecutor(rec)

	runName, err := e.Dispatch(context.Background(), codingMilestoneDispatch())
	if err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	if !strings.HasPrefix(runName, "ca-") {
		t.Errorf("run name = %q, want the ca- prefix (the watcher discriminator)", runName)
	}
	if len(rec.calls) == 0 {
		t.Fatal("the OC chain was never walked — the proxy path was taken instead")
	}
	if rec.create.Name != runName {
		t.Errorf("component name %q != returned run name %q", rec.create.Name, runName)
	}
}

// TestDispatch_ValidationCycleNoLongerRefusesWithoutTheProxy is the deletion
// this task makes real: validation used to be refused outright unless the
// cluster-gateway-proxy path was configured, because the fallback carried no
// task kind and no deadline. The OC path carries both.
func TestDispatch_ValidationCycleNoLongerRefusesWithoutTheProxy(t *testing.T) {
	rec := &chainRecorder{}
	e := newOCDispatchExecutor(rec)
	e.proxy = nil // no proxy at all

	req := codingMilestoneDispatch()
	req.Kind = delivery.CycleKindValidation
	req.IssueNumber = 77

	if _, err := e.Dispatch(context.Background(), req); err != nil {
		t.Fatalf("a validation cycle must dispatch on the OC path: %v", err)
	}
	var kind string
	for _, ev := range rec.load.Env {
		if ev.Key == "AEP_TASK_KIND" {
			kind = ev.Value
		}
	}
	if kind != validationTaskKind {
		t.Errorf("AEP_TASK_KIND = %q, want %q", kind, validationTaskKind)
	}
	if rec.create.Parameters["activeDeadlineSeconds"] != int(validationDeadlineSeconds) {
		t.Errorf("validation deadline = %v, want %d", rec.create.Parameters["activeDeadlineSeconds"], validationDeadlineSeconds)
	}
	if rec.create.DisplayName != "Validation cycle — milestone #1 v1" {
		t.Errorf("displayName = %q", rec.create.DisplayName)
	}
}

// TestDispatch_OCPathStillRequiresTheOrgsSecretRefs: refs-only means the run
// cannot start without them, and the message must name which one is missing.
func TestDispatch_OCPathStillRequiresTheOrgsSecretRefs(t *testing.T) {
	rec := &chainRecorder{}
	anthropic, github := fullSecretRefs()
	anthropic.SecretRefName = nil
	anthropic.SMAPISecretRefName = nil
	e := newCodingDispatchExecutor(anthropic, github, nil, false)
	e.WithOCDispatch(NewOCDispatcher(rec.client()).WithImage("runner:1"))

	_, err := e.Dispatch(context.Background(), codingMilestoneDispatch())
	if err == nil {
		t.Fatal("expected an error when the anthropic secret ref is missing")
	}
	if !strings.Contains(err.Error(), "anthropic") {
		t.Errorf("error must name the missing credential, got %v", err)
	}
	if len(rec.calls) != 0 {
		t.Errorf("nothing may be created before the refs resolve, saw %v", rec.calls)
	}
}
