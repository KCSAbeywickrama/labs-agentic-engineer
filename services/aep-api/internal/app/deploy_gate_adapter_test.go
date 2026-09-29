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

package app

import (
	"context"
	"errors"
	"testing"

	"go.temporal.io/sdk/temporal"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/delivery/run"
	"github.com/wso2/aep/aep-api/internal/dependencies/provisioning"
)

type failingWriteTarget struct{ err error }

func (f failingWriteTarget) Resolve(context.Context, string, string) (string, error) {
	return "", f.err
}
func (f failingWriteTarget) OrgDefaultRoot(context.Context, string) (string, error) { return "", f.err }

func checkDeployReadiness(t *testing.T, cause error) error {
	t.Helper()
	prov := provisioning.NewService(provisioning.Deps{WriteTargets: failingWriteTarget{err: cause}})
	acts := run.NewActivities(run.Deps{DeployGate: deployGate{prov: prov}})
	_, err := acts.CheckDeployReadiness(context.Background(), run.ProjectRef{OrgID: "acme", ProjectID: "shop"})
	return err
}

// A project with no write target fails the deploy gate for good: the adapter
// marks it permanent and the activity says so to Temporal, so the run fails
// with the cause instead of parking on values or retrying forever.
func TestDeployGate_NoWriteTargetIsNonRetryable(t *testing.T) {
	cause := &openchoreo.ErrNoWriteTarget{Org: "acme", Project: "shop", Cause: openchoreo.ErrPipelineRefMissing}

	err := checkDeployReadiness(t, cause)

	var appErr *temporal.ApplicationError
	if !errors.As(err, &appErr) || !appErr.NonRetryable() {
		t.Fatalf("want a non-retryable ApplicationError, got %v", err)
	}
	if !errors.Is(err, cause) {
		t.Fatalf("the cause must survive: %v", err)
	}
}

// A transient resolve failure is a blip: returned plain so Temporal retries it.
func TestDeployGate_TransientResolveFailureIsRetryable(t *testing.T) {
	blip := errors.New("openchoreo: 503")

	err := checkDeployReadiness(t, blip)

	if !errors.Is(err, blip) {
		t.Fatalf("want the transient error, got %v", err)
	}
	var appErr *temporal.ApplicationError
	if errors.As(err, &appErr) && appErr.NonRetryable() {
		t.Fatalf("a transient failure must stay retryable, got %v", err)
	}
}
