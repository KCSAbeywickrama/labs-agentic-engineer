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
	"errors"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/gen"
)

// bootT0 is the test clock's start; pod times sit before it.
var bootT0 = time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC)

// bootFeed is a feed over rt on a test clock the caller moves.
func bootFeed(rt *fakeRuntime) (*CycleFeed, *time.Time) {
	f := newTestFeed(rt, &fakeObserver{})
	clock := bootT0
	f.now = func() time.Time { return clock }
	return f, &clock
}

// readBoot runs one feed read (past the shared-read memo) and returns the
// events it served and the boot it left.
func readBoot(t *testing.T, f *CycleFeed, clock *time.Time, c *delivery.RunCycle) ([]gen.RunEvent, *gen.RunCycleBoot) {
	t.Helper()
	*clock = clock.Add(feedReadTTL + time.Second)
	evs, _, _, err := f.Events(context.Background(), nil, c, "")
	if err != nil {
		t.Fatalf("Events: %v", err)
	}
	return evs, f.Boot(c)
}

// Each pod state is one boot code, dated by the pod's own clock where the pod
// dates it and by the first read that saw it where it does not. None of them
// is an event: the feed stays empty until the runner speaks.
func TestCycleBoot_EachPodStateIsOneCode(t *testing.T) {
	created := bootT0.Add(-5 * time.Minute)
	scheduled := bootT0.Add(-4 * time.Minute)
	started := bootT0.Add(-1 * time.Minute)
	jobAt := bootT0.Add(-6 * time.Minute)
	dispatched := bootT0.Add(-7 * time.Minute)
	pod := func(phase, reason, msg string) openchoreo.RuntimePod {
		return openchoreo.RuntimePod{Found: true, Name: "p1", Phase: phase, WaitingReason: reason, Message: msg,
			CreatedAt: created, ScheduledAt: scheduled, StartedAt: started}
	}
	firstRead := bootT0.Add(feedReadTTL + time.Second)
	cases := []struct {
		name       string
		pod        openchoreo.RuntimePod
		dispatched *time.Time
		code       gen.RunCycleBootCode
		detail     string
		since      time.Time
	}{
		{"no pod, the Job applied", openchoreo.RuntimePod{JobFound: true, JobCreatedAt: jobAt}, &dispatched,
			gen.RunCycleBootCodeRunnerScheduling, "", jobAt},
		{"no pod, no Job yet", openchoreo.RuntimePod{}, &dispatched,
			gen.RunCycleBootCodeRunnerScheduling, "", dispatched},
		{"no pod, nothing dated", openchoreo.RuntimePod{}, nil,
			gen.RunCycleBootCodeRunnerScheduling, "", firstRead},
		{"pod pending, no reason", pod("Pending", "", ""), nil,
			gen.RunCycleBootCodeRunnerScheduling, "", created},
		{"no room", pod("Pending", "Unschedulable", "0/3 nodes are available: Too many pods.\nsecond line"), nil,
			gen.RunCycleBootCodeRunnerUnschedulable, "0/3 nodes are available: Too many pods.", scheduled},
		{"pulling", pod("Pending", "ContainerCreating", ""), nil,
			gen.RunCycleBootCodeRunnerPullingImage, "", scheduled},
		{"an unknown waiting reason", pod("Pending", "SomeBrandNewReason", ""), nil,
			gen.RunCycleBootCodeRunnerPullingImage, "SomeBrandNewReason", scheduled},
		{"pull backing off", pod("Pending", "ImagePullBackOff", `Back-off pulling image "ghcr.io/x/runner:1"`), nil,
			gen.RunCycleBootCodeRunnerImagePullBackOff, `Back-off pulling image "ghcr.io/x/runner:1"`, firstRead},
		{"a missing secret", pod("Pending", "CreateContainerConfigError", `secret "ca-abc" not found`), nil,
			gen.RunCycleBootCodeRunnerConfigError, `secret "ca-abc" not found`, firstRead},
		{"booting", pod("Running", "", ""), nil,
			gen.RunCycleBootCodeRunnerStarting, "", started},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rt := &fakeRuntime{pod: tc.pod}
			f, clock := bootFeed(rt)
			c := openCycle("c1", "uid-1")
			c.DispatchedAt = tc.dispatched
			evs, b := readBoot(t, f, clock, &c)
			if len(evs) != 0 {
				t.Fatalf("events %+v, want none: startup is state, not a fact", evs)
			}
			if b == nil {
				t.Fatalf("boot absent, want %s", tc.code)
			}
			if b.Code != tc.code || b.Attempt != 1 || b.Detail != tc.detail {
				t.Errorf("boot = %+v, want code %s attempt 1 detail %q", b, tc.code, tc.detail)
			}
			if !b.Since.Equal(tc.since) {
				t.Errorf("since = %s, want %s", b.Since, tc.since)
			}
		})
	}
}

// since is kept across reads while the attempt stays in the state, and a new
// code takes a new time.
func TestCycleBoot_SinceIsStableAndANewCodeTakesANewTime(t *testing.T) {
	rt := &fakeRuntime{pod: openchoreo.RuntimePod{Found: true, Name: "p1", Phase: "Pending", WaitingReason: "ErrImagePull"}}
	f, clock := bootFeed(rt)
	c := openCycle("c1", "uid-1")

	_, first := readBoot(t, f, clock, &c)
	seenAt := *clock
	// The kubelet flips between the two pull-failure reasons; both are one code.
	rt.pod.WaitingReason = "ImagePullBackOff"
	_, again := readBoot(t, f, clock, &c)
	if first == nil || again == nil || again.Code != gen.RunCycleBootCodeRunnerImagePullBackOff {
		t.Fatalf("boots %+v / %+v, want runner_image_pull_backoff twice", first, again)
	}
	if !first.Since.Equal(seenAt) || !again.Since.Equal(first.Since) {
		t.Fatalf("since %s then %s, want the first read's %s both times", first.Since, again.Since, seenAt)
	}

	rt.pod.WaitingReason = "CreateContainerConfigError"
	_, next := readBoot(t, f, clock, &c)
	if next == nil || next.Code != gen.RunCycleBootCodeRunnerConfigError || !next.Since.Equal(*clock) {
		t.Fatalf("boot %+v, want runner_config_error since %s", next, *clock)
	}

	// A re-dispatch is a new attempt in the same state: a new time too.
	c.Attempts = 2
	_, redispatched := readBoot(t, f, clock, &c)
	if redispatched == nil || redispatched.Attempt != 2 || !redispatched.Since.Equal(*clock) {
		t.Fatalf("boot %+v, want attempt 2 since %s", redispatched, *clock)
	}
}

// The runner's first line ends boot: from then on the feed tells the story.
func TestCycleBoot_AbsentOnceTheAttemptHasAnEvent(t *testing.T) {
	rt := &fakeRuntime{pod: openchoreo.RuntimePod{Found: true, Name: "p1", Phase: "Running"}}
	f, clock := bootFeed(rt)
	c := openCycle("c1", "uid-1")
	if _, b := readBoot(t, f, clock, &c); b == nil || b.Code != gen.RunCycleBootCodeRunnerStarting {
		t.Fatalf("boot %+v, want runner_starting before the first line", b)
	}

	rt.logs = toPodLines(v2Lines(t, 1))
	evs, b := readBoot(t, f, clock, &c)
	if len(evs) != 1 || evs[0].Seq != 1 {
		t.Fatalf("events %+v, want the runner's first event", evs)
	}
	if b != nil {
		t.Fatalf("boot %+v, want none once the attempt has spoken", b)
	}
}

// An ended cycle has no boot: neither from a read of it, nor from what a read
// remembered while it was still open.
func TestCycleBoot_AbsentOnAnEndedCycle(t *testing.T) {
	rt := &fakeRuntime{pod: openchoreo.RuntimePod{Found: true, Name: "p1", Phase: "Pending", WaitingReason: "ContainerCreating"}}
	f, clock := bootFeed(rt)
	c := openCycle("c1", "uid-1")
	if _, b := readBoot(t, f, clock, &c); b == nil {
		t.Fatalf("open cycle has no boot")
	}

	ended := bootT0
	c.EndedAt = &ended
	if b := f.Boot(&c); b != nil {
		t.Fatalf("boot %+v on an ended cycle, from the open read's memo", b)
	}
	if _, b := readBoot(t, f, clock, &c); b != nil {
		t.Fatalf("boot %+v on an ended cycle, from a read of it", b)
	}

	// A finished pod on a cycle not yet closed is not starting either.
	open := openCycle("c2", "uid-2")
	rt.pod = openchoreo.RuntimePod{Found: true, Name: "p2", Phase: "Failed"}
	if _, b := readBoot(t, f, clock, &open); b != nil {
		t.Fatalf("boot %+v for a finished pod", b)
	}
}

// detail is the cluster's own words, scrubbed and capped to the contract's 500.
func TestCycleBoot_DetailIsScrubbedAndCapped(t *testing.T) {
	secret := "ghp_" + strings.Repeat("a", 36)
	msg := "Failed to pull image: https://x-access-token:" + secret + "@ghcr.io/x " + strings.Repeat("z", 600)
	rt := &fakeRuntime{pod: openchoreo.RuntimePod{Found: true, Name: "p1", Phase: "Pending", WaitingReason: "ErrImagePull", Message: msg}}
	f, clock := bootFeed(rt)
	c := openCycle("c1", "uid-1")
	_, b := readBoot(t, f, clock, &c)
	if b == nil {
		t.Fatalf("boot absent")
	}
	if strings.Contains(b.Detail, secret) {
		t.Errorf("detail leaks the token: %q", b.Detail)
	}
	if n := utf8.RuneCountInString(b.Detail); n > 500 {
		t.Errorf("detail is %d runes, want at most 500", n)
	}
}

// A cycle never read has no boot, and a reader with no feed answers none.
func TestCycleBoot_NothingBeforeARead(t *testing.T) {
	f, _ := bootFeed(&fakeRuntime{})
	c := openCycle("c1", "uid-1")
	if b := f.Boot(&c); b != nil {
		t.Fatalf("boot %+v before any read", b)
	}
	if b := (&AgentProgressReader{}).CycleBoot(&c); b != nil {
		t.Fatalf("boot %+v from a reader with no feed", b)
	}
}

// Regression (e2e run 03c2c6ac): the pod sits in CreateContainerConfigError
// with nothing written, and the cluster has no observability plane. boot must
// follow the pod, whatever the pod-log read answers and whichever source the
// read falls through to, and move on when the container starts.
func TestCycleBoot_FollowsThePodWhenNoLogSourceAnswers(t *testing.T) {
	const kubelet = `Error: secret "ca-071b0590-anthropic" not found`
	podErrs := map[string]error{
		"pod log not found":       openchoreo.ErrNotFound,
		"pod log fails":           errors.New("openchoreo: 500"),
		"pod log answers empty":   nil,
		"pod log times out":       context.DeadlineExceeded,
		"pod log answers 400-ish": errors.New("openchoreo: container is waiting to start"),
	}
	observers := map[string]cycleLogQuerier{
		"no observability plane": nil,
		"observer failing":       &fakeObserver{err: errors.New(`observability: request failed: Post "http://observer.openchoreo-observability"`)},
	}
	// The tree may carry the pod without its phase; the waiting reason still
	// says what the pod is doing.
	phases := map[string]string{"pending": "Pending", "no phase in the tree": ""}
	for pname, logErr := range podErrs {
		for oname, obs := range observers {
			for phname, phase := range phases {
				t.Run(pname+"/"+oname+"/"+phname, func(t *testing.T) {
					rt := &fakeRuntime{logErr: logErr}
					f := NewCycleFeed(rt, obs, testWriteTargets(), 72*time.Hour)
					clock := bootT0
					f.now = func() time.Time { return clock }
					c := openCycle("c1", "uid-1")

					// No pod yet: scheduling.
					if _, b := readBoot(t, f, &clock, &c); b == nil || b.Code != gen.RunCycleBootCodeRunnerScheduling {
						t.Fatalf("no pod: boot %+v, want runner_scheduling", b)
					}
					// The pod exists and cannot start its container.
					rt.pod = openchoreo.RuntimePod{Found: true, Name: "p1", Phase: phase,
						WaitingReason: "CreateContainerConfigError", Message: kubelet, CreatedAt: bootT0}
					evs, b := readBoot(t, f, &clock, &c)
					if len(evs) != 0 {
						t.Fatalf("events %+v, want none", evs)
					}
					if b == nil || b.Code != gen.RunCycleBootCodeRunnerConfigError || b.Detail != kubelet {
						t.Fatalf("config error: boot %+v, want runner_config_error with the kubelet's words", b)
					}
					if st := f.State(&c); st != gen.RunCycleViewRecordingLive {
						t.Fatalf("recording %s, want live while the cycle runs", st)
					}
					// The secret lands; the container starts and has not spoken yet.
					rt.pod.Phase, rt.pod.WaitingReason, rt.pod.Message = "Running", "", ""
					rt.pod.StartedAt = clock
					if _, b := readBoot(t, f, &clock, &c); b == nil || b.Code != gen.RunCycleBootCodeRunnerStarting {
						t.Fatalf("running: boot %+v, want runner_starting", b)
					}
					if st := f.State(&c); st != gen.RunCycleViewRecordingLive {
						t.Fatalf("recording %s, want live while the cycle runs", st)
					}
				})
			}
		}
	}
}
