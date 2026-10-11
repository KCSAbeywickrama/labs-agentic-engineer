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
	"errors"
	"fmt"
	"iter"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/aestudiotools"
	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/platform/taskplan"
)

// planDrainIdleTimeout aborts a Plan turn's stream when no event arrives for
// this long. The pod sends a keep-alive every 15 s while the turn runs, so a
// longer silence means a hung pod, and the planning activity would otherwise
// hold its 30-minute timeout for a turn that is not coming back. Keep-alives
// reset it like any other event: a turn reading files for minutes is alive.
const planDrainIdleTimeout = 90 * time.Second

// errPlanTurnSilent is a Plan turn whose stream sent nothing, not even a
// keep-alive, for planDrainIdleTimeout. Retryable: the next attempt reattaches
// or starts afresh.
var errPlanTurnSilent = errors.New("plan: the turn sent nothing for the idle deadline")

// planTap reads a Plan turn's event stream from the org's AE Studio pod and
// keeps the last ok planBuild it carries. The pod projects the agent's ok
// results to `task-op` events; a later one replaces an earlier one, so the
// checklist is the planner's final word. The tap writes nothing: the build
// issue is minted once the turn has completed.
type planTap struct {
	// ctx carries the activity's progress beat.
	ctx  context.Context
	plan *taskplan.BuildPlanOk
}

func newPlanTap(ctx context.Context) *planTap { return &planTap{ctx: ctx} }

// Stream reads the turn's events to the end and reports how the turn ended:
// nil for a completed turn, an aestudiotools.TurnFailedError carrying the
// pod's code (and a provider_limit's reset time) for a failed one (the
// planning activity's retry policy reads it), the stream's own error when it
// broke off, or errPlanTurnSilent when the idle watchdog fired.
//
// Every event, keep-alives included, resets the watchdog and reports progress
// on t.ctx, which the planning activity turns into a heartbeat. On expiry the
// watchdog calls abort, which must end the stream (cancel the context the
// stream was started under, closing its body).
func (t *planTap) Stream(events iter.Seq2[aestudiotools.TurnEvent, error], abort func()) error {
	var silent atomic.Bool
	alive := make(chan struct{}, 1)
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		timer := time.NewTimer(planDrainIdleTimeout)
		defer timer.Stop()
		for {
			select {
			case <-stop:
				return
			case <-alive:
				timer.Reset(planDrainIdleTimeout)
			case <-timer.C:
				silent.Store(true)
				abort()
				return
			}
		}
	}()

	for ev, err := range events {
		if silent.Load() {
			return errPlanTurnSilent
		}
		if err != nil {
			return err
		}
		select {
		case alive <- struct{}{}:
		default:
		}
		delivery.ReportProgress(t.ctx)
		switch ev.Type {
		case aestudiotools.EventTaskOp:
			t.consume(ev)
		case aestudiotools.EventResult:
			if ev.Status != "completed" {
				return fmt.Errorf("plan: %w", &aestudiotools.TurnFailedError{Code: ev.Code, ResetAt: ev.ResetAt})
			}
			return nil
		}
	}
	if silent.Load() {
		return errPlanTurnSilent
	}
	return errors.New("plan: the turn stream ended without a result")
}

// consume keeps a build op's checklist. The pod sends only the agent's ok
// planBuild results; the decoder still refuses anything that is not one, so a
// malformed op replaces nothing.
func (t *planTap) consume(ev aestudiotools.TurnEvent) {
	if ev.Op != "build" {
		slog.WarnContext(t.ctx, "plan tap: unknown task-op skipped", "op", ev.Op)
		return
	}
	out, err := taskplan.DecodeBuildPlanOk(ev.Output)
	if err != nil {
		slog.WarnContext(t.ctx, "plan tap: undecodable planBuild op skipped", "error", err)
		return
	}
	t.plan = out
}
