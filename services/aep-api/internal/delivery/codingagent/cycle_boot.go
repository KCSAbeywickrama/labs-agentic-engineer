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

// cycle_boot.go — RunCycleView.boot: where an open cycle's current attempt is
// in starting its runner, before the agent's first event.
//
// It is STATE, not history, so it rides the cycle record and never the feed. A
// negative-seq notice per pod state used to stand in for it, and an
// append-only client could not drop one once the next state arrived: a pod that
// pulled, backed off and then started left three rows behind it.
//
// It is read on the same read that serves the cycle's feed (CycleFeed.Events)
// and remembered per cycle, so the run stream asks for it right after that read
// (Boot) and a frame's boot describes the read behind its feed, as `recording`
// does. Present only while the cycle is live, its current attempt has produced
// no event, and its pod has not finished.
//
// It follows the POD, not the log. A read whose log source fails (a container
// OpenChoreo will not serve a log for, a cluster with no observability plane)
// still read the pod's state, and boot moves with it (noteBootUnread). Whether
// the attempt has spoken is then the last successful read's answer, which the
// memo keeps: a failed read cannot see events, and must not bring back the
// boot of an attempt that already spoke.
//
// SINCE. A reader says "pulling the image for 2m", so the time has to be the
// pod's entry into the state and the same on every read. The pod's own clock is
// preferred (bootSince); a state the pod does not date (a pull backing off, a
// missing secret) takes the first read that saw it. Either is kept while the
// attempt stays in the state, and a new state or a new attempt takes a new time.

import (
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/gen"
)

// bootMemoHold forgets a remembered startup state no read has found for this
// long: the cycle's viewers left, and the next read starts it afresh. It is far
// longer than the watcher's startup grace, so an attempt still starting is
// never forgotten while anyone watches it.
const bootMemoHold = time.Hour

// cycleBoot is one open cycle's startup state as the feed's last read found it.
type cycleBoot struct {
	attempt int
	// spoke: a successful read found an event of this attempt, so it has no
	// boot however a later failed read sees its pod.
	spoke  bool
	code   gen.RunCycleBootCode
	detail string
	since  time.Time
	// seen is the last read that found it, for bootMemoHold.
	seen time.Time
}

// Boot is RunCycleView.boot for the cycle: the startup state the feed's last
// read of it found, nil when there is none — no read yet, the attempt has
// spoken, the pod finished, or the cycle is no longer live. It never reads the
// pod itself.
func (f *CycleFeed) Boot(cycle *delivery.RunCycle) *gen.RunCycleBoot {
	if f == nil || cycle == nil || !cycleLive(cycle) {
		return nil
	}
	f.mu.Lock()
	b, ok := f.boots[cycle.ID]
	f.mu.Unlock()
	if !ok || b.spoke || b.attempt != currentAttempt(cycle) {
		return nil
	}
	return &gen.RunCycleBoot{Attempt: b.attempt, Code: b.code, Detail: b.detail, Since: b.since}
}

// noteBoot remembers what one successful read says about the cycle's startup:
// the state of its current attempt's pod while that attempt has no event in
// attempts, else that the attempt has spoken.
func (f *CycleFeed) noteBoot(cycle *delivery.RunCycle, rd feedRead, attempts []feedAttempt) {
	if !cycleLive(cycle) || terminalPod(rd.pod) {
		f.forgetBoot(cycle.ID)
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if current := currentAttempt(cycle); hasAttempt(attempts, current) {
		f.sweepBoots(rd.at)
		f.boots[cycle.ID] = cycleBoot{attempt: current, spoke: true, seen: rd.at}
		return
	}
	f.setBootLocked(cycle, rd)
}

// noteBootUnread is noteBoot for a read whose LOG failed: no events to judge
// by, so the pod moves boot unless the memo already knows the attempt spoke. A
// read that never reached the pod changes nothing.
func (f *CycleFeed) noteBootUnread(cycle *delivery.RunCycle, rd feedRead) {
	if !rd.podRead {
		return
	}
	if !cycleLive(cycle) || terminalPod(rd.pod) {
		f.forgetBoot(cycle.ID)
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if prev, ok := f.boots[cycle.ID]; ok && prev.spoke && prev.attempt == currentAttempt(cycle) {
		prev.seen = rd.at
		f.boots[cycle.ID] = prev
		return
	}
	f.setBootLocked(cycle, rd)
}

// setBootLocked records the read pod's state as the current attempt's boot,
// keeping `since` while the attempt stays in the same state. f.mu is held.
func (f *CycleFeed) setBootLocked(cycle *delivery.RunCycle, rd feedRead) {
	current := currentAttempt(cycle)
	st := bootstrapState(rd.pod.Found, rd.pod.Phase, rd.pod.WaitingReason, rd.pod.Message)
	code := gen.RunCycleBootCode(st.name)
	detail := capText(redactSecrets(st.detail), capLongText)

	f.sweepBoots(rd.at)
	prev, ok := f.boots[cycle.ID]
	since := prev.since
	if !ok || prev.spoke || prev.attempt != current || prev.code != code {
		since = bootSince(cycle, rd.pod, code)
		if since.IsZero() {
			since = rd.at
		}
	}
	f.boots[cycle.ID] = cycleBoot{attempt: current, code: code, detail: detail, since: since.UTC(), seen: rd.at}
}

// sweepBoots drops what no read has found for bootMemoHold. f.mu is held.
func (f *CycleFeed) sweepBoots(now time.Time) {
	for id, b := range f.boots {
		if now.Sub(b.seen) >= bootMemoHold {
			delete(f.boots, id)
		}
	}
}

func (f *CycleFeed) forgetBoot(cycleID string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.boots, cycleID)
}

// bootSince is when the pod entered the state code names, by the cluster's own
// clock, or zero when the pod does not date it (a pull backing off and a
// missing secret are container waiting reasons, which carry no time).
//
// A runner still being scheduled dates from its pod's creation, or, with no pod
// yet, from this attempt's Job (a previous attempt's Job left in the tree is
// not it), or from the dispatch while OpenChoreo has not applied one. A pod
// with no room, or one fetching its image, dates from its PodScheduled
// transition (the scheduler's verdict, or the node it got); a booting one from
// its container's start.
func bootSince(cycle *delivery.RunCycle, pod openchoreo.RuntimePod, code gen.RunCycleBootCode) time.Time {
	switch code {
	case gen.RunCycleBootCodeRunnerScheduling:
		switch {
		case pod.Found:
			return pod.CreatedAt
		case pod.JobFound && !pod.JobCreatedAt.IsZero() && !isLeftoverJob(cycle, pod):
			return pod.JobCreatedAt
		case cycle.DispatchedAt != nil:
			return *cycle.DispatchedAt
		}
	case gen.RunCycleBootCodeRunnerUnschedulable, gen.RunCycleBootCodeRunnerPullingImage:
		if !pod.ScheduledAt.IsZero() {
			return pod.ScheduledAt
		}
		return pod.CreatedAt
	case gen.RunCycleBootCodeRunnerStarting:
		return pod.StartedAt
	}
	return time.Time{}
}

func hasAttempt(attempts []feedAttempt, number int) bool {
	for _, a := range attempts {
		if a.number == number {
			return true
		}
	}
	return false
}
