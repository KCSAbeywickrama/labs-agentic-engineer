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
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/delivery/runread"
)

// A read can take its whole timeout (OpenChoreo retrying a 5xx, an observer
// that does not answer). The run stream projects a cycle's record after its
// feed read, so a live cycle's viewer must not wait it out: it is served the
// latest completed read, and the fresh one lands on a later poll. These tests
// pin that, and that it reaches the stream as a prompt cycle frame.

// slowRuntime is a pod source whose reads can be made slow, safe to read from
// the feed's background load while the test runs.
type slowRuntime struct {
	pod  openchoreo.RuntimePod
	slow atomic.Int64 // nanoseconds every read takes; 0 is instant
}

func (s *slowRuntime) wait() { time.Sleep(time.Duration(s.slow.Load())) }

func (s *slowRuntime) ReleaseBindingName(context.Context, string, string, string, string) (string, error) {
	s.wait()
	return "rb", nil
}

func (s *slowRuntime) PodSnapshot(context.Context, string, string) (openchoreo.RuntimePod, error) {
	return s.pod, nil
}

func (s *slowRuntime) PodLogs(context.Context, string, string, string, int64) ([]openchoreo.PodLogLine, error) {
	return nil, nil
}

func (s *slowRuntime) PodEvents(context.Context, string, string, string) ([]openchoreo.RuntimeEvent, error) {
	return nil, nil
}

func TestCycleFeed_ASlowReadOfALiveCycleServesTheLatestRead(t *testing.T) {
	rt := &slowRuntime{pod: openchoreo.RuntimePod{Found: true, Name: "p1", Phase: "Pending", WaitingReason: "ContainerCreating"}}
	f := NewCycleFeed(rt, nil, testWriteTargets(), 72*time.Hour)
	c := openCycle("c1", "uid-1")
	if _, _, _, err := f.Events(context.Background(), nil, &c, ""); err != nil {
		t.Fatalf("first read: %v", err)
	}

	rt.slow.Store(int64(3 * time.Second))
	time.Sleep(feedReadTTL + 100*time.Millisecond) // past the shared read
	start := time.Now()
	f.Events(context.Background(), nil, &c, "")
	if took := time.Since(start); took > feedLiveWait+500*time.Millisecond {
		t.Fatalf("a live cycle's viewer waited %s for a slow read, want about %s", took, feedLiveWait)
	}
	if b := f.Boot(&c); b == nil {
		t.Fatalf("the latest read's boot was lost while the fresh read runs")
	}
}

func TestCycleFeed_AnEndedCycleWaitsForItsRead(t *testing.T) {
	rt := &slowRuntime{}
	f := NewCycleFeed(rt, nil, testWriteTargets(), 72*time.Hour)
	c := settledCycle("c1", "")
	f.Events(context.Background(), nil, &c, "")

	rt.slow.Store(int64(feedReadTTL + 300*time.Millisecond))
	time.Sleep(feedReadTTL + 100*time.Millisecond)
	start := time.Now()
	f.Events(context.Background(), nil, &c, "")
	if took := time.Since(start); took < feedReadTTL {
		t.Fatalf("an ended cycle was served a stale read after %s: a finished run's one pass must carry the whole log", took)
	}
}

// --- through the real run stream -------------------------------------------

type streamRuns struct{ row delivery.MilestoneRun }

func (s streamRuns) MilestoneNumberForTag(context.Context, string, string, string) (int, bool, error) {
	return 0, false, nil
}
func (s streamRuns) ListByMilestone(context.Context, string, string, int) ([]delivery.MilestoneRun, error) {
	return nil, nil
}
func (s streamRuns) GetByIDScoped(context.Context, string, string) (*delivery.MilestoneRun, error) {
	row := s.row
	return &row, nil
}

// streamCycles serves one cycle row the test changes, as the JobWatcher does.
type streamCycles struct {
	mu  sync.Mutex
	row delivery.RunCycle
}

func (s *streamCycles) ListByRun(context.Context, string, string) ([]delivery.RunCycle, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return []delivery.RunCycle{s.row}, nil
}

type streamBuffer struct {
	mu sync.Mutex
	b  strings.Builder
}

func (s *streamBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *streamBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

// The e2e shape: a quiet live run whose pod cannot start, every feed read slow,
// and the JobWatcher writing startupWait onto the cycle row. The changed record
// reaches the stream as a cycle frame within one poll, not after the read.
func TestRunStream_AChangedCycleRowIsSentWhileItsFeedReadIsSlow(t *testing.T) {
	if testing.Short() {
		t.Skip("drives the real 2s poll")
	}
	rt := &slowRuntime{pod: openchoreo.RuntimePod{Found: true, Name: "p1", Phase: "Pending", WaitingReason: "CreateContainerConfigError"}}
	reader := NewAgentProgressReader(nil, testWriteTargets(), nil).WithFeed(NewCycleFeed(rt, nil, testWriteTargets(), 72*time.Hour))
	cycles := &streamCycles{row: openCycle("c1", "uid-1")}
	runs := streamRuns{row: delivery.MilestoneRun{ID: "run-1", OrgID: "acme", ProjectID: "shop", State: delivery.RunStateRunning}}
	svc := runread.NewProgressService(runs, cycles, reader).WithRecordings(reader)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	run, err := svc.OpenRunProgressStream(ctx, "acme", "shop", "run-1")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	buf := &streamBuffer{}
	done := make(chan struct{})
	go func() { run(buf, func() {}); close(done) }()
	defer func() { cancel(); <-done }()

	waitForText(t, buf, `"code":"runner_config_error"`, 3*time.Second)
	rt.slow.Store(int64(20 * time.Second)) // every read from here on hangs

	time.Sleep(3 * time.Second) // let a slow read start and hold
	since := time.Now().UTC()
	cycles.mu.Lock()
	cycles.row.StartupWaitReason, cycles.row.StartupWaitSince = "CreateContainerConfigError", &since
	cycles.mu.Unlock()
	waitForText(t, buf, `"reason":"CreateContainerConfigError"`, 3*time.Second)
}

func waitForText(t *testing.T, buf *streamBuffer, want string, deadline time.Duration) {
	t.Helper()
	until := time.Now().Add(deadline)
	for time.Now().Before(until) {
		if strings.Contains(buf.String(), want) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("no %s within %s\n---\n%s", want, deadline, buf.String())
}
