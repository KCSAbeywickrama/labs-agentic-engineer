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

// Same-package tests for what the run stream says about itself rather than
// about the run: `serverTime` on every frame, a `tick` frame on a quiet
// connection, and the cycle frame re-sent when its startup state moves. The
// cadences are the service's own fields, driven in milliseconds.
package runread

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/contracts"
	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/gen"
)

// pinnedNow is the clock every stamped frame in these tests reads.
var pinnedNow = time.Date(2026, 10, 16, 12, 30, 0, 0, time.UTC)

// oneCycle serves a single open coding cycle for every run.
type oneCycle struct{}

func (oneCycle) ListByRun(context.Context, string, string) ([]delivery.RunCycle, error) {
	return []delivery.RunCycle{{
		ID: "c1", OrgID: "acme", ProjectID: "widgets", RunID: "r1", Kind: delivery.CycleKindCoding,
		Attempts: 1, JobRef: "ca-c1", CreatedAt: pinnedNow.Add(-time.Minute),
	}}, nil
}

// bootLogs is a feed with one event on its first read, nothing after, and a
// boot the test moves under a lock.
type bootLogs struct {
	mu   sync.Mutex
	boot *gen.RunCycleBoot
}

func (b *bootLogs) setBoot(code gen.RunCycleBootCode, since time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.boot = &gen.RunCycleBoot{Attempt: 1, Code: code, Since: since}
}

func (b *bootLogs) clearBoot() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.boot = nil
}

func (b *bootLogs) CycleEvents(_ context.Context, _ *delivery.MilestoneRun, c *delivery.RunCycle, cursor string) ([]gen.RunEvent, int, string, error) {
	if cursor != "" {
		return nil, c.Attempts, cursor, nil
	}
	ev := gen.RunEvent{V: gen.RunEventVTwo, Seq: 1, TS: pinnedNow, Kind: gen.RunEventKindAgentProgress, AgentID: "lead"}
	return []gen.RunEvent{ev}, c.Attempts, "drained", nil
}

func (b *bootLogs) CycleBoot(*delivery.RunCycle) *gen.RunCycleBoot {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.boot == nil {
		return nil
	}
	cp := *b.boot
	return &cp
}

func (b *bootLogs) CycleProgress(context.Context, *delivery.RunCycle, int64) (*contracts.ProgressResponse, error) {
	return &contracts.ProgressResponse{}, nil
}

// liveFrames parses every `data:` JSON frame written so far.
func liveFrames(t *testing.T, raw string) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, line := range strings.Split(raw, "\n") {
		payload, ok := strings.CutPrefix(line, "data: ")
		if !ok || payload == "[DONE]" {
			continue
		}
		var f map[string]any
		if err := json.Unmarshal([]byte(payload), &f); err != nil {
			t.Fatalf("frame %q: %v", payload, err)
		}
		out = append(out, f)
	}
	return out
}

func liveRun(state string) *flipRuns {
	return &flipRuns{row: delivery.MilestoneRun{ID: "r1", OrgID: "acme", ProjectID: "widgets", State: state}}
}

// openLive starts the run stream over svc and returns its buffer and stop.
func openLive(t *testing.T, svc *ProgressService) (*syncBuffer, context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	run, err := svc.OpenRunProgressStream(ctx, "acme", "widgets", "r1")
	if err != nil {
		cancel()
		t.Fatalf("open: %v", err)
	}
	buf := &syncBuffer{}
	go run(buf, func() {})
	return buf, cancel
}

// Every frame carries the server's clock at the write: cycle, event and done
// alike, so a client can measure event ages against the platform's clock.
func TestRunProgress_EveryFrameCarriesServerTime(t *testing.T) {
	runs := liveRun(delivery.RunStateSucceeded)
	svc := NewProgressService(runs, oneCycle{}, &bootLogs{})
	svc.now = func() time.Time { return pinnedNow }
	buf := &syncBuffer{}
	run, err := svc.OpenRunProgressStream(context.Background(), "acme", "widgets", "r1")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	run(buf, func() {}) // a terminal run's stream is finite

	frames := liveFrames(t, buf.String())
	types := map[string]bool{}
	for _, f := range frames {
		types[f["type"].(string)] = true
		if got := f["serverTime"]; got != pinnedNow.Format(time.RFC3339) {
			t.Errorf("%v frame serverTime = %v, want %s", f["type"], got, pinnedNow.Format(time.RFC3339))
		}
	}
	for _, want := range []string{frameTypeCycle, frameTypeEvent, frameTypeDone} {
		if !types[want] {
			t.Errorf("no %s frame in %s", want, buf.String())
		}
	}
}

// A quiet live run sends `tick` frames, each carrying only the type and the
// server's clock, and never the `: keep-alive` comment a client cannot read.
func TestRunProgress_QuietStreamSendsTicks(t *testing.T) {
	svc := NewProgressService(liveRun(delivery.RunStateRunning), noCycles{}, nil)
	svc.tick = time.Hour // no derive after the first: the stream goes quiet
	svc.keepAlive = 10 * time.Millisecond
	svc.now = func() time.Time { return pinnedNow }
	buf, cancel := openLive(t, svc)
	defer cancel()

	waitFor(t, buf, `"type":"tick"`, time.Second)
	time.Sleep(40 * time.Millisecond)
	raw := buf.String()
	if strings.Contains(raw, "keep-alive") {
		t.Fatalf("the run stream sent a keep-alive comment\n---\n%s", raw)
	}
	ticks := 0
	for _, f := range liveFrames(t, raw) {
		if f["type"] != frameTypeTick {
			continue
		}
		ticks++
		if len(f) != 2 || f["serverTime"] != pinnedNow.Format(time.RFC3339) {
			t.Errorf("tick frame = %v, want only type and serverTime", f)
		}
	}
	if ticks < 2 {
		t.Fatalf("ticks = %d, want one per quiet window\n---\n%s", ticks, raw)
	}
}

// A stream that keeps writing is not quiet, so it sends no tick: the window
// counts from the last frame, not from the connection's start.
func TestRunProgress_BusyStreamSendsNoTick(t *testing.T) {
	logs := &bootLogs{}
	svc := NewProgressService(liveRun(delivery.RunStateRunning), oneCycle{}, logs)
	svc.tick = 2 * time.Millisecond
	svc.keepAlive = 60 * time.Millisecond
	buf, cancel := openLive(t, svc)
	defer cancel()

	// Move the boot on every derive for longer than the quiet window: each move
	// re-sends the cycle frame, so the stream is never silent for a window.
	stop := time.After(150 * time.Millisecond)
	codes := []gen.RunCycleBootCode{gen.RunCycleBootCodeRunnerScheduling, gen.RunCycleBootCodeRunnerPullingImage}
	for i := 0; ; i++ {
		select {
		case <-stop:
			if strings.Contains(buf.String(), `"type":"tick"`) {
				t.Fatalf("a busy stream sent a tick\n---\n%s", buf.String())
			}
			return
		case <-time.After(5 * time.Millisecond):
			logs.setBoot(codes[i%2], pinnedNow.Add(time.Duration(i)*time.Second))
		}
	}
}

// boot is cycle STATE: the cycle frame is re-sent each time it changes, and
// not when it does not.
func TestRunProgress_CycleFrameIsResentWhenBootChanges(t *testing.T) {
	logs := &bootLogs{}
	logs.setBoot(gen.RunCycleBootCodeRunnerScheduling, pinnedNow)
	svc := NewProgressService(liveRun(delivery.RunStateRunning), oneCycle{}, logs)
	svc.tick = 5 * time.Millisecond
	svc.keepAlive = time.Hour
	buf, cancel := openLive(t, svc)
	defer cancel()

	waitFor(t, buf, string(gen.RunCycleBootCodeRunnerScheduling), time.Second)
	time.Sleep(30 * time.Millisecond) // several derives with nothing changed
	logs.setBoot(gen.RunCycleBootCodeRunnerPullingImage, pinnedNow.Add(time.Minute))
	waitFor(t, buf, string(gen.RunCycleBootCodeRunnerPullingImage), time.Second)
	logs.clearBoot()
	time.Sleep(30 * time.Millisecond)

	var boots []any
	for _, f := range liveFrames(t, buf.String()) {
		if f["type"] != frameTypeCycle {
			continue
		}
		c := f["cycle"].(map[string]any)
		if b, ok := c["boot"].(map[string]any); ok {
			boots = append(boots, b["code"])
		} else {
			boots = append(boots, nil)
		}
	}
	want := []any{string(gen.RunCycleBootCodeRunnerScheduling), string(gen.RunCycleBootCodeRunnerPullingImage), nil}
	if len(boots) != len(want) {
		t.Fatalf("cycle frames' boots = %v, want %v (one frame per change)", boots, want)
	}
	for i := range want {
		if boots[i] != want[i] {
			t.Fatalf("cycle frames' boots = %v, want %v", boots, want)
		}
	}
}

// mutableCycles serves one open cycle whose row the test changes under a lock,
// as the JobWatcher writes startupWait onto it.
type mutableCycles struct {
	mu  sync.Mutex
	row delivery.RunCycle
}

func (m *mutableCycles) ListByRun(context.Context, string, string) ([]delivery.RunCycle, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return []delivery.RunCycle{m.row}, nil
}

func (m *mutableCycles) noteStartupWait(reason string, at time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.row.StartupWaitReason, m.row.StartupWaitSince = reason, &at
}

// quietLogs is a live feed with nothing to say: no events, no boot.
type quietLogs struct{}

func (quietLogs) CycleEvents(_ context.Context, _ *delivery.MilestoneRun, c *delivery.RunCycle, cursor string) ([]gen.RunEvent, int, string, error) {
	return nil, c.Attempts, cursor, nil
}
func (quietLogs) CycleBoot(*delivery.RunCycle) *gen.RunCycleBoot { return nil }
func (quietLogs) CycleProgress(context.Context, *delivery.RunCycle, int64) (*contracts.ProgressResponse, error) {
	return &contracts.ProgressResponse{}, nil
}

// A changed cycle RECORD is state, re-sent within one poll whether or not the
// cycle's feed has anything new: the watcher writing startupWait onto a quiet
// live cycle reaches the stream promptly.
func TestRunProgress_ChangedCycleRowIsResentOnAQuietStream(t *testing.T) {
	cycles := &mutableCycles{row: delivery.RunCycle{
		ID: "c1", OrgID: "acme", ProjectID: "widgets", RunID: "r1", Kind: delivery.CycleKindCoding,
		Attempts: 1, JobRef: "ca-c1", CreatedAt: pinnedNow.Add(-time.Minute),
	}}
	svc := NewProgressService(liveRun(delivery.RunStateRunning), cycles, quietLogs{})
	svc.tick = 10 * time.Millisecond
	svc.keepAlive = time.Hour
	buf, cancel := openLive(t, svc)
	defer cancel()

	waitFor(t, buf, `"type":"cycle"`, 2*time.Second)
	cycles.noteStartupWait("CreateContainerConfigError", pinnedNow)
	waitFor(t, buf, `"reason":"CreateContainerConfigError"`, 200*time.Millisecond)
}
