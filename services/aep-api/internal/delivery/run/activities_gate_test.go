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

package run

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/temporal"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

type stubGate struct {
	unconfigured []string
	provisioning []string
	err          error
}

func (g stubGate) DeploymentReadiness(context.Context, string, string, string) ([]string, []string, error) {
	return g.unconfigured, g.provisioning, g.err
}

// recordingRuns is a RunStore that records only the two writes this file cares
// about, so a test can assert which of them the park chose.
type recordingRuns struct {
	RunStore
	states []string
	parks  []struct {
		reason string
		deps   []string
	}
}

func (r *recordingRuns) SetState(_ context.Context, _, state string) error {
	r.states = append(r.states, state)
	return nil
}

func (r *recordingRuns) SetWaiting(_ context.Context, _, reason string, deps []string) error {
	r.parks = append(r.parks, struct {
		reason string
		deps   []string
	}{reason, deps})
	return nil
}

// TestCheckDeployReadiness_UnwiredFailsClosed is the one activity in this
// package that must NOT degrade to "nothing to do". Every other optional
// collaborator's worst case is work not happening; this one's worst case is a
// deploy that publishes an application with empty credentials — the exact
// outcome the gate exists to prevent. Non-retryable, because waiting does not
// wire a port.
func TestCheckDeployReadiness_UnwiredFailsClosed(t *testing.T) {
	acts := NewActivities(Deps{})

	_, err := acts.CheckDeployReadiness(context.Background(), DeployGateInput{OrgID: "acme", ProjectID: "shop"})

	require.Error(t, err, "an unwired gate must refuse, never wave the deploy through")
	var appErr *temporal.ApplicationError
	require.True(t, errors.As(err, &appErr))
	require.True(t, appErr.NonRetryable(), "retrying cannot wire a missing port")
}

// TestCheckDeployReadiness_ReportsBothBlockersSeparately: the workflow treats
// the two differently — it polls one and parks on the other — so the activity
// must not collapse them into a single "not ready".
func TestCheckDeployReadiness_ReportsBothBlockersSeparately(t *testing.T) {
	acts := NewActivities(Deps{DeployGate: stubGate{
		unconfigured: []string{"stripe"},
		provisioning: []string{"postgres"},
	}})

	verdict, err := acts.CheckDeployReadiness(context.Background(), DeployGateInput{OrgID: "acme", ProjectID: "shop"})

	require.NoError(t, err)
	require.Equal(t, []string{"stripe"}, verdict.Unconfigured)
	require.Equal(t, []string{"postgres"}, verdict.Provisioning)
}

// TestCheckDeployReadiness_ReadErrorIsRetryable: a gate that could not be READ
// is a blip, not a verdict. It must surface as an ordinary retryable error so
// Temporal's policy answers it — the non-retryable refusal above is reserved for
// the one cause repeating cannot change.
func TestCheckDeployReadiness_ReadErrorIsRetryable(t *testing.T) {
	acts := NewActivities(Deps{DeployGate: stubGate{err: errors.New("openchoreo unreachable")}})

	_, err := acts.CheckDeployReadiness(context.Background(), DeployGateInput{OrgID: "acme", ProjectID: "shop"})

	require.Error(t, err)
	var appErr *temporal.ApplicationError
	if errors.As(err, &appErr) {
		require.False(t, appErr.NonRetryable(), "a read failure is a blip; retrying is the right answer")
	}
}

// TestCheckDeployReadiness_ANoWriteTargetGateIsNonRetryable: a gate that can
// never be read (the composition root marks a project with no write target
// delivery.ErrNoWriteTarget as well as delivery.ErrDeployPermanent) is an
// answer, not a blip, so the run fails with its cause instead of retrying or
// parking on it.
func TestCheckDeployReadiness_ANoWriteTargetGateIsNonRetryable(t *testing.T) {
	acts := NewActivities(Deps{DeployGate: stubGate{err: noWriteTargetCause()}})

	_, err := acts.CheckDeployReadiness(context.Background(), DeployGateInput{OrgID: "acme", ProjectID: "shop"})

	var appErr *temporal.ApplicationError
	require.True(t, errors.As(err, &appErr), "want an ApplicationError, got %v", err)
	require.True(t, appErr.NonRetryable(), "no retry makes a missing write target appear")
	require.Equal(t, delivery.ErrTypeNoWriteTarget, appErr.Type(), "the workflow settles the run on this type")
	require.Contains(t, appErr.Error(), "no write target", "the cause must survive to the run failure")
}

// TestCheckDeployReadiness_RecordsTheCauseOfAGateThatCanNeverOpen: the run
// settles failed on no-write-target, and the record is what tells a reader why.
// A retryable read failure records nothing: the next attempt may heal it.
func TestCheckDeployReadiness_RecordsTheCauseOfAGateThatCanNeverOpen(t *testing.T) {
	runs := &failureRuns{}
	acts := NewActivities(Deps{Runs: runs, DeployGate: stubGate{err: noWriteTargetCause()}})

	_, _ = acts.CheckDeployReadiness(context.Background(), DeployGateInput{OrgID: "acme", ProjectID: "shop", RunID: "run-1"})

	require.Len(t, runs.recorded, 1)
	got := runs.recorded[0]
	require.Equal(t, delivery.RunFailureCodeNoWriteTarget, got.Code)
	require.Equal(t, delivery.RunPhaseDeploying, got.Phase)
	require.True(t, got.Permanent)
	require.Contains(t, got.Detail, "no write target for acme/shop")

	runs.recorded = nil
	acts = NewActivities(Deps{Runs: runs, DeployGate: stubGate{err: errors.New("openchoreo unreachable")}})
	_, _ = acts.CheckDeployReadiness(context.Background(), DeployGateInput{OrgID: "acme", ProjectID: "shop", RunID: "run-1"})
	require.Empty(t, runs.recorded, "a blip is not a failure to record")
}

// TestCheckDeployReadiness_OtherPermanentFailuresAreNotNoWriteTarget: the
// record keys on the no-write-target sentinel itself, not on "permanent". Any
// other permanent deploy answer keeps the generic type and records nothing
// under a code that would name the wrong cause.
func TestCheckDeployReadiness_OtherPermanentFailuresAreNotNoWriteTarget(t *testing.T) {
	runs := &failureRuns{}
	cause := fmt.Errorf("%w: component orders is gone from the design", delivery.ErrDeployPermanent)
	acts := NewActivities(Deps{Runs: runs, DeployGate: stubGate{err: cause}})

	_, err := acts.CheckDeployReadiness(context.Background(), DeployGateInput{OrgID: "acme", ProjectID: "shop", RunID: "run-1"})

	var appErr *temporal.ApplicationError
	require.True(t, errors.As(err, &appErr), "want an ApplicationError, got %v", err)
	require.Equal(t, errTypePermanentDeploy, appErr.Type())
	require.Empty(t, runs.recorded, "only a missing write target is recorded as one")
}

// stubDeployer answers every promote with err.
type stubDeployer struct {
	Deployer
	err error
}

func (d stubDeployer) Deploy(context.Context, string, string, []delivery.DeployTarget) ([]delivery.ComponentDeploy, error) {
	return nil, d.err
}

type failingDeployments struct{ err error }

func (d failingDeployments) DeploymentState(context.Context, string, string, []string) ([]delivery.ComponentDeploy, error) {
	return nil, d.err
}

// TestDeployActivities_RecordAndTypeANoWriteTarget: the promote, the readiness
// poll and the version read each resolve the write target, so each meets the
// fault the gate does and must answer it the same way: typed for the workflow,
// recorded for the reader.
func TestDeployActivities_RecordAndTypeANoWriteTarget(t *testing.T) {
	calls := map[string]func(*Activities) error{
		"PromoteWave": func(a *Activities) error {
			_, err := a.PromoteWave(context.Background(), PromoteInput{
				OrgID: "acme", ProjectID: "shop", RunID: "run-1",
				Targets: []delivery.DeployTarget{{Component: "orders", CommitSHA: "aaa1"}},
			})
			return err
		},
		"PollDeployments": func(a *Activities) error {
			_, err := a.PollDeployments(context.Background(), WaitSetInput{
				OrgID: "acme", ProjectID: "shop", RunID: "run-1", Components: []string{"orders"},
			})
			return err
		},
		"ReadVersionState": func(a *Activities) error {
			_, err := a.ReadVersionState(context.Background(), ProjectRef{OrgID: "acme", ProjectID: "shop", RunID: "run-1"})
			return err
		},
	}
	for name, call := range calls {
		t.Run(name, func(t *testing.T) {
			runs := &failureRuns{}
			acts := NewActivities(Deps{
				Runs:        runs,
				Deploy:      stubDeployer{err: noWriteTargetCause()},
				Deployments: failingDeployments{err: noWriteTargetCause()},
				Design:      stubDesign{paths: map[string]string{"orders": "services/orders"}},
				Builds:      stubBuilds{},
			})

			err := call(acts)

			var appErr *temporal.ApplicationError
			require.True(t, errors.As(err, &appErr), "want an ApplicationError, got %v", err)
			require.True(t, appErr.NonRetryable())
			require.Equal(t, delivery.ErrTypeNoWriteTarget, appErr.Type())
			require.Len(t, runs.recorded, 1)
			require.Equal(t, delivery.RunFailureCodeNoWriteTarget, runs.recorded[0].Code)
			require.Equal(t, delivery.RunPhaseDeploying, runs.recorded[0].Phase)
		})
	}
}

// TestSetRunState_RoutesTheParksExplanationToSetWaiting pins the routing in
// SetRunState. The reason and the dependency names have to reach the row through
// SetWaiting — the ONE write that carries both — or the console reads a
// `waiting` row whose explanation never landed.
func TestSetRunState_RoutesTheParksExplanationToSetWaiting(t *testing.T) {
	runs := &recordingRuns{}
	acts := NewActivities(Deps{Runs: runs})
	ctx := context.Background()

	require.NoError(t, acts.SetRunState(ctx, SetRunStateInput{
		RunID:                "run-1",
		State:                delivery.RunStateWaiting,
		WaitingReason:        delivery.RunWaitingOnExternalValues,
		BlockingDependencies: []string{"stripe", "twilio"},
	}))
	require.Len(t, runs.parks, 1)
	require.Equal(t, delivery.RunWaitingOnExternalValues, runs.parks[0].reason)
	require.Equal(t, []string{"stripe", "twilio"}, runs.parks[0].deps)
	require.Empty(t, runs.states, "an explained park must not also take the plain SetState path")

	// A park with NO explanation is the ordinary between-cycles one and still
	// goes through SetState — routing it to SetWaiting would blank the reason of
	// a run that the gate had just parked.
	require.NoError(t, acts.SetRunState(ctx, SetRunStateInput{
		RunID: "run-1", State: delivery.RunStateWaiting,
	}))
	require.Equal(t, []string{delivery.RunStateWaiting}, runs.states)
	require.Len(t, runs.parks, 1)
}
