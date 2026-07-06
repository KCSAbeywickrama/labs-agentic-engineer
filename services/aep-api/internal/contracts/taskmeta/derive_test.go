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

package taskmeta

import (
	"testing"
	"time"
)

func TestDerive(t *testing.T) {
	base := time.Date(2026, 7, 4, 12, 0, 0, 0, time.UTC)
	at := func(mins int) time.Time { return base.Add(time.Duration(mins) * time.Minute) }
	coding := func(s ExecutionStatus, mins int) ExecutionFact {
		return ExecutionFact{Kind: KindCoding, Status: s, CreatedAt: at(mins)}
	}
	build := func(s ExecutionStatus, mins int) ExecutionFact {
		return ExecutionFact{Kind: KindBuild, Status: s, CreatedAt: at(mins)}
	}
	ops := func(s ExecutionStatus, mins int) ExecutionFact {
		return ExecutionFact{Kind: KindOps, Status: s, CreatedAt: at(mins)}
	}

	tests := []struct {
		name  string
		facts GitHubFacts
		execs []ExecutionFact
		want  DerivedStatus
	}{
		// pending
		{"open no execs", GitHubFacts{IssueOpen: true}, nil, StatusPending},
		{"open coding succeeded no PR is transient pending", GitHubFacts{IssueOpen: true}, []ExecutionFact{coding(ExecSucceeded, 0)}, StatusPending},
		{"open coding canceled is pending not failed", GitHubFacts{IssueOpen: true}, []ExecutionFact{coding(ExecCanceled, 0)}, StatusPending},

		// in_progress
		{"active coding queued", GitHubFacts{IssueOpen: true}, []ExecutionFact{coding(ExecQueued, 0)}, StatusInProgress},
		{"active coding running", GitHubFacts{IssueOpen: true}, []ExecutionFact{coding(ExecRunning, 0)}, StatusInProgress},

		// failed
		{"latest coding failed", GitHubFacts{IssueOpen: true}, []ExecutionFact{coding(ExecFailed, 0)}, StatusFailed},
		{"retry running supersedes earlier failure", GitHubFacts{IssueOpen: true}, []ExecutionFact{coding(ExecFailed, 0), coding(ExecRunning, 5)}, StatusInProgress},
		{"latest failure supersedes earlier running", GitHubFacts{IssueOpen: true}, []ExecutionFact{coding(ExecRunning, 0), coding(ExecFailed, 5)}, StatusFailed},

		// ready_for_review / rejected / in_progress ordering
		{"pr open", GitHubFacts{IssueOpen: true, PR: PROpen}, []ExecutionFact{coding(ExecSucceeded, 0)}, StatusReadyForReview},
		// an open PR (ready_for_review) sits above an active retry.
		{"open PR beats active retry", GitHubFacts{IssueOpen: true, PR: PROpen}, []ExecutionFact{coding(ExecRunning, 10)}, StatusReadyForReview},
		{"pr closed unmerged", GitHubFacts{IssueOpen: true, PR: PRClosedUnmerged}, nil, StatusRejected},
		// a rejected PR still beats a merely FAILED retry.
		{"rejected PR wins over later failed retry", GitHubFacts{IssueOpen: true, PR: PRClosedUnmerged}, []ExecutionFact{coding(ExecFailed, 10)}, StatusRejected},
		// but an ACTIVE retry beats a stale rejected PR (amended precedence).
		{"active retry beats rejected PR", GitHubFacts{IssueOpen: true, PR: PRClosedUnmerged}, []ExecutionFact{coding(ExecFailed, 0), coding(ExecRunning, 10)}, StatusInProgress},

		// merged / building / deployed / failed
		{"merged no build", GitHubFacts{IssueOpen: true, PR: PRMerged}, nil, StatusMerged},
		{"merged build running", GitHubFacts{IssueOpen: true, PR: PRMerged}, []ExecutionFact{build(ExecRunning, 0)}, StatusBuilding},
		{"merged build succeeded", GitHubFacts{IssueOpen: true, PR: PRMerged}, []ExecutionFact{build(ExecSucceeded, 0)}, StatusDeployed},
		// amended: a merged PR whose latest build FAILED surfaces failed (retry visibility).
		{"merged build failed surfaces failed", GitHubFacts{IssueOpen: true, PR: PRMerged}, []ExecutionFact{build(ExecFailed, 0)}, StatusFailed},
		{"merged build canceled stays merged", GitHubFacts{IssueOpen: true, PR: PRMerged}, []ExecutionFact{build(ExecCanceled, 0)}, StatusMerged},
		// latest build wins: an earlier failed build superseded by a running retry → building.
		{"merged build failed then retry running", GitHubFacts{IssueOpen: true, PR: PRMerged}, []ExecutionFact{build(ExecFailed, 0), build(ExecRunning, 5)}, StatusBuilding},
		// overlap: a merged PR is irreversible — wins over a later issue-close.
		{"merged wins over issue close", GitHubFacts{IssueOpen: false, PR: PRMerged}, []ExecutionFact{build(ExecSucceeded, 0)}, StatusDeployed},

		// abandoned
		{"closed no merge", GitHubFacts{IssueOpen: false}, nil, StatusAbandoned},
		// overlap: closed issue with an open PR → abandoned (above the review gate).
		{"closed issue with open PR is abandoned", GitHubFacts{IssueOpen: false, PR: PROpen}, nil, StatusAbandoned},
		{"closed issue with closed-unmerged PR is abandoned", GitHubFacts{IssueOpen: false, PR: PRClosedUnmerged}, nil, StatusAbandoned},

		// on_hold — wins over everything.
		{"hold beats merged", GitHubFacts{IssueOpen: true, HoldPresent: true, PR: PRMerged}, []ExecutionFact{build(ExecSucceeded, 0)}, StatusOnHold},
		{"hold beats abandoned", GitHubFacts{IssueOpen: false, HoldPresent: true}, nil, StatusOnHold},
		{"hold beats in_progress", GitHubFacts{IssueOpen: true, HoldPresent: true}, []ExecutionFact{coding(ExecRunning, 0)}, StatusOnHold},

		// ops
		{"ops running", GitHubFacts{IssueOpen: true}, []ExecutionFact{ops(ExecRunning, 0)}, StatusInProgress},
		{"ops failed", GitHubFacts{IssueOpen: true}, []ExecutionFact{ops(ExecFailed, 0)}, StatusFailed},
		{"ops succeeded is deployed", GitHubFacts{IssueOpen: true}, []ExecutionFact{ops(ExecSucceeded, 0)}, StatusDeployed},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Derive(tt.facts, tt.execs); got != tt.want {
				t.Fatalf("Derive(%+v, %v) = %q; want %q", tt.facts, tt.execs, got, tt.want)
			}
		})
	}
}
