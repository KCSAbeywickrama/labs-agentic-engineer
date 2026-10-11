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
	"encoding/json"
	"errors"
	"iter"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/aestudiotools"
	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// buildOK is an ok planBuild result naming the items, each on one component.
func buildOK(items ...string) string {
	var rows []string
	for _, it := range items {
		rows = append(rows, `{"item":"`+it+`","components":["order-service"],"note":"Build `+it+`."}`)
	}
	return `{"ok":true,"op":"build","items":[` + strings.Join(rows, ",") + `]}`
}

// taskOp is one task-op line of the pod's turn stream: the ok output of a
// planBuild call, op taken from it.
func taskOp(output string) aestudiotools.TurnEvent {
	var head struct {
		Op string `json:"op"`
	}
	_ = json.Unmarshal([]byte(output), &head)
	return aestudiotools.TurnEvent{Type: aestudiotools.EventTaskOp, Op: head.Op, Output: json.RawMessage(output)}
}

var (
	keepAlive = aestudiotools.TurnEvent{Type: aestudiotools.EventKeepAlive}
	completed = aestudiotools.TurnEvent{Type: aestudiotools.EventResult, Status: "completed"}
)

// turn is a pod turn stream of evs, ending with a completed result unless
// evs ends with a result of its own.
func turn(evs ...aestudiotools.TurnEvent) iter.Seq2[aestudiotools.TurnEvent, error] {
	if len(evs) == 0 || evs[len(evs)-1].Type != aestudiotools.EventResult {
		evs = append(evs, completed)
	}
	return func(yield func(aestudiotools.TurnEvent, error) bool) {
		for _, ev := range evs {
			if !yield(ev, nil) {
				return
			}
		}
	}
}

func noAbort() {}

func itemsOf(t *testing.T, tap *planTap) []string {
	t.Helper()
	if tap.plan == nil {
		return nil
	}
	var out []string
	for _, it := range tap.plan.Items {
		out = append(out, it.Item)
	}
	return out
}

// The last ok planBuild is the checklist: a later call replaces an earlier one,
// and an op that is not an ok planBuild replaces nothing.
func TestPlanTap_KeepsTheLastBuildPlan(t *testing.T) {
	tap := newPlanTap(context.Background())
	err := tap.Stream(turn(
		taskOp(buildOK("F1")),
		taskOp(`{"ok":false,"op":"build","code":"MISSING_ITEM"}`),
		taskOp(buildOK("foundation", "F1")),
		taskOp(`{"ok":true,"op":"plan","component":"a","title":"t"}`),
	), noAbort)
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	if got := strings.Join(itemsOf(t, tap), " "); got != "foundation F1" {
		t.Fatalf("plan = %q, want the last ok planBuild", got)
	}
}

// A failed turn is an error, carrying the pod's code; what it planned before
// failing is never written (the service mints only after a completed turn).
func TestPlanTap_AFailedTurnIsAnError(t *testing.T) {
	tap := newPlanTap(context.Background())
	err := tap.Stream(turn(
		taskOp(buildOK("F1")),
		aestudiotools.TurnEvent{Type: aestudiotools.EventResult, Status: "failed", Code: "shutdown"},
	), noAbort)
	var failed *aestudiotools.TurnFailedError
	if !errors.As(err, &failed) || failed.Code != "shutdown" {
		t.Fatalf("err = %v, want a TurnFailedError with the pod's code", err)
	}
}

// A provider_limit result's reset time rides on the error, so the planning
// activity can wait until then.
func TestPlanTap_AProviderLimitCarriesTheResetTime(t *testing.T) {
	resetAt := time.Date(2026, 10, 4, 10, 15, 0, 0, time.UTC)
	tap := newPlanTap(context.Background())

	err := tap.Stream(turn(
		aestudiotools.TurnEvent{Type: aestudiotools.EventResult, Status: "failed", Code: aestudiotools.TurnCodeProviderLimit, ResetAt: resetAt},
	), noAbort)
	var failed *aestudiotools.TurnFailedError
	if !errors.As(err, &failed) || !failed.ProviderLimited() || !failed.ResetAt.Equal(resetAt) {
		t.Fatalf("err = %v, want a provider_limit TurnFailedError reset at %v", err, resetAt)
	}
}

// A stream that breaks (the adapter yields an error: the pod went away, a
// malformed line) is an error, never a quiet success.
func TestPlanTap_ABrokenStreamIsAnError(t *testing.T) {
	tap := newPlanTap(context.Background())
	broken := func(yield func(aestudiotools.TurnEvent, error) bool) {
		if !yield(keepAlive, nil) {
			return
		}
		yield(aestudiotools.TurnEvent{}, sourcecontrol.ErrAEStudioUnavailable)
	}

	if err := tap.Stream(broken, noAbort); !errors.Is(err, sourcecontrol.ErrAEStudioUnavailable) {
		t.Fatalf("err = %v, want the stream's error", err)
	}
}

// Every event — keep-alives included — reports progress, so the planning
// activity heartbeats per event rather than only on its own clock.
func TestPlanTap_EveryEventReportsProgress(t *testing.T) {
	var beats atomic.Int32
	ctx := delivery.WithProgress(context.Background(), func() { beats.Add(1) })
	tap := newPlanTap(ctx)

	if err := tap.Stream(turn(keepAlive, taskOp(buildOK("F1")), keepAlive), noAbort); err != nil {
		t.Fatalf("Stream: %v", err)
	}
	if got := beats.Load(); got != 4 { // two keep-alives, one task-op, the result
		t.Fatalf("progress beats = %d, want 4 (one per event)", got)
	}
}

// silentUntilAborted is a turn that sends nothing until abort is called.
func silentUntilAborted(aborted <-chan struct{}) iter.Seq2[aestudiotools.TurnEvent, error] {
	return func(yield func(aestudiotools.TurnEvent, error) bool) {
		<-aborted
		yield(aestudiotools.TurnEvent{}, context.Canceled)
	}
}

// A turn that goes silent past the idle deadline — no task-op, no keep-alive
// — is aborted, so a hung pod cannot pin the planning activity for its whole
// 30-minute timeout. The abort ends the stream (closing its body) and is
// reported as its own error, not as the read error the abort caused.
func TestPlanTap_IdleWatchdogAbortsASilentTurn(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		tap := newPlanTap(context.Background())
		aborted := make(chan struct{})
		start := time.Now()

		err := tap.Stream(silentUntilAborted(aborted), func() { close(aborted) })

		if !errors.Is(err, errPlanTurnSilent) {
			t.Fatalf("err = %v, want errPlanTurnSilent", err)
		}
		if waited := time.Since(start); waited != planDrainIdleTimeout {
			t.Fatalf("aborted after %v, want exactly the %v idle deadline", waited, planDrainIdleTimeout)
		}
	})
}

// A Plan turn that reads files for two minutes sends only keep-alives in that
// time. They are proof of life: the watchdog resets on each, so the turn is NOT
// aborted and the plan sent after the quiet stretch is kept.
func TestPlanTap_KeepAlivesHoldAQuietTurnOpen(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		tap := newPlanTap(context.Background())
		abortCalled := false
		quiet := func(yield func(aestudiotools.TurnEvent, error) bool) {
			for elapsed := time.Duration(0); elapsed < 2*time.Minute; elapsed += 15 * time.Second {
				time.Sleep(15 * time.Second)
				if !yield(keepAlive, nil) {
					return
				}
			}
			if !yield(taskOp(buildOK("F1")), nil) {
				return
			}
			yield(completed, nil)
		}

		if err := tap.Stream(quiet, func() { abortCalled = true }); err != nil {
			t.Fatalf("Stream: %v", err)
		}
		if abortCalled {
			t.Fatal("a turn sending keep-alives was aborted")
		}
		if got := strings.Join(itemsOf(t, tap), " "); got != "F1" {
			t.Fatalf("plan = %q, want the plan sent after the quiet stretch", got)
		}
	})
}

// The Turn socket's golden stream (packages/contracts/sockets/ae-studio/turn/
// golden/completed.ndjson) is what the pod sends, ae-studio-tools relays
// unchanged and this tap consumes: its second planBuild replaces its first,
// with no op skipped as undecodable.
func TestPlanTap_TheGoldenStreamKeepsItsLastPlan(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "..", "packages", "contracts", "sockets", "ae-studio", "turn", "golden", "completed.ndjson"))
	if err != nil {
		t.Fatal(err)
	}
	var evs []aestudiotools.TurnEvent
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		var ev struct {
			Type, Op, Status, Code string
			Output                 json.RawMessage
		}
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			t.Fatalf("golden line %q: %v", line, err)
		}
		evs = append(evs, aestudiotools.TurnEvent{Type: ev.Type, Op: ev.Op, Output: ev.Output, Status: ev.Status, Code: ev.Code})
	}
	tap := newPlanTap(context.Background())

	if err := tap.Stream(turn(evs...), noAbort); err != nil {
		t.Fatalf("Stream: %v", err)
	}
	if got := strings.Join(itemsOf(t, tap), " "); got != "foundation F1" {
		t.Fatalf("plan = %q, want the golden stream's second planBuild", got)
	}
}
