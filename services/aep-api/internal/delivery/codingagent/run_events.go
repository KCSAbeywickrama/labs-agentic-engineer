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

// run_events.go — one cycle's feed as v2 RunEvents, the cycle state read
// beside it, and the platform's own notices on it.
//
// The feed itself is the CycleFeed's (cycle_feed.go): the pod's log while the
// pod exists, the observability plane's once it is gone, numbered by the
// producer's own seq so either source serves the same events. The reader
// delegates to it; what lives here is the reader's surface (the feed, its
// `recording` and its `boot`) and the shape of a platform-authored notice.
// The only notice the feed mixes in is a gap: platform STATE (a log that
// cannot be read, a runner still starting) rides the cycle record instead.

import (
	"context"
	"time"

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/gen"
)

// CycleEvents returns the next slice of one run CYCLE's feed after cursor, the
// ATTEMPT those events belong to, and the cursor to carry into the next poll.
// One call serves one attempt; the cursor rolls to the next attempt once the
// current one has nothing new and a later one exists — so a viewer replays
// attempt 1 whole, then attempt 2, which is how the console renders them.
//
// run is the cycle's run row (its cancel stamp marks a cancelled cycle whose
// close did not carry the reason); nil is allowed.
//
// It reports no `final` flag and no truncation flag, unlike its v1 sibling: the
// run progress stream settles on the RUN's state, not on a cycle's log, and the
// facts a caller would have taken from those flags are on the feed itself — a
// `notice` for a gap, and the run's own `run_settled`.
func (r *AgentProgressReader) CycleEvents(ctx context.Context, run *delivery.MilestoneRun, cycle *delivery.RunCycle, cursor string) ([]gen.RunEvent, int, string, error) {
	if r == nil || r.feed == nil || cycle == nil || cycle.JobRef == "" {
		return nil, 0, cursor, nil
	}
	return r.feed.Events(ctx, run, cycle, cursor)
}

// CycleBoot is RunCycleView.boot for the cycle: where its current attempt is
// in starting its runner, as the feed's last read (CycleEvents) found it. nil
// once the attempt has spoken, on an ended cycle, and on a reader with no feed.
// It reads nothing itself, so a stream asks for it right after CycleEvents.
func (r *AgentProgressReader) CycleBoot(cycle *delivery.RunCycle) *gen.RunCycleBoot {
	if r == nil || r.feed == nil {
		return nil
	}
	return r.feed.Boot(cycle)
}

// RecordingState is what the platform can serve of this cycle's feed, for
// RunCycleView.recording. It is a different question from what the cycle DID,
// and one a client has to ask before presenting a feed as the story of a cycle.
// A reader with no feed serves none: `unavailable`.
func (r *AgentProgressReader) RecordingState(cycle *delivery.RunCycle) gen.RunCycleViewRecording {
	if r == nil || r.feed == nil {
		return gen.RunCycleViewRecordingUnavailable
	}
	return r.feed.State(cycle)
}

// platformNotice is a marker the PLATFORM put on the feed, not something a
// producer said. Three things mark it as such and each is deliberate:
//
//   - the negative, STABLE seq (seqGapBase less the position): a client dedups
//     on (cycle, attempt, seq) and a producer's seqs are positive, so the same
//     position re-derived every tick, or read from the other source, collapses
//     to one row;
//   - `at`, the instant the platform DERIVED this marker, passed in by the
//     caller that derived it — see below;
//   - `agentId: lead`. The field is required and there is no honest third value:
//     any id other than `lead` names a SPAWNED agent under the contract, so a
//     made-up one would make a console open a row for an agent that does not
//     exist.
//
// `at` is a parameter and not a `time.Now()` in here because the caller always
// knows a truer instant than this function could read: a gap takes the clock of
// the line after it, which is the same on every read and from either source.
//
// IT MUST BE A REAL INSTANT. These markers used to carry no timestamp at all, on
// the reasoning that a recorded marker is ordered by its position in the file
// and needs no clock of its own — and ordering is indeed `seq`'s job, the
// contract says so. But `RunEvent.ts` is required and generates as a
// `time.Time`, so "no timestamp" was never on the wire: Go's zero value
// marshalled as `0001-01-01T00:00:00Z`, a well-formed date no consumer can tell
// from a real one. Because these notices belong to the lead, a console
// subtracting one from the clock showed the lead agent as 2026 years old (`1065409035m47s`)
// while its two children read `2m45s` and `2m25s`, and drew the lead's timeline
// lane across the whole axis. A field a producer cannot honestly fill has to be
// absent; this one cannot be absent, so it is filled honestly.
func platformNotice(at time.Time, seq int64, level gen.RunEventLevel, detail string) gen.RunEvent {
	return gen.RunEvent{
		V:       gen.RunEventVTwo,
		Seq:     seq,
		TS:      at.UTC(),
		Kind:    gen.RunEventKindNotice,
		AgentID: leadAgentID,
		Level:   level,
		Detail:  capText(detail, capLongText),
	}
}
