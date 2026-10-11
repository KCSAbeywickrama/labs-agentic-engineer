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
	"testing"

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// buildMilestone is a milestone with one open build issue and a bug.
type buildMilestone struct {
	counts sourcecontrol.MilestoneIssueCounts
	issues []sourcecontrol.IssueInfo
	listed int
}

func (m *buildMilestone) MilestoneIssueCounts(context.Context, string, string, int) (*sourcecontrol.MilestoneIssueCounts, error) {
	c := m.counts
	return &c, nil
}

func (m *buildMilestone) ListMilestoneIssues(_ context.Context, _, _ string, f sourcecontrol.MilestoneIssuesFilter) ([]sourcecontrol.IssueInfo, error) {
	m.listed++
	if f.State != "open" || f.Number != 7 {
		return nil, nil
	}
	return m.issues, nil
}

func (m *buildMilestone) CloseMilestone(context.Context, string, string, int) error { return nil }

// The poll counts the unticked items of the version's build issue, and only
// its: a bug's body is not a checklist even when it holds a task list, and
// neither is another development issue's, which is not the version's plan.
func TestPollMilestone_CountsTheBuildIssuesUncheckedItems(t *testing.T) {
	buildLabel := sourcecontrol.DedupeLabel(delivery.DedupeKeyBuildIssue("p", 7))
	m := &buildMilestone{
		counts: sourcecontrol.MilestoneIssueCounts{OpenAgentWork: 3, OpenDevelopment: 2, OpenTotal: 3},
		issues: []sourcecontrol.IssueInfo{
			{Number: 10, Labels: []string{delivery.LabelAgentWork, delivery.KindDevelopment, buildLabel},
				Body: "- [x] **foundation** Shared setup: `api`.\n- [ ] **F1** Claims: `api`.\n- [ ] **F2** Approvals: `api`.\n"},
			{Number: 11, Labels: []string{delivery.LabelAgentWork, delivery.KindBug}, Body: "- [ ] **F9** not a build item\n"},
			{Number: 12, Labels: []string{delivery.LabelAgentWork, delivery.KindDevelopment}, Body: "- [ ] **F8** filed by hand\n"},
		},
	}
	snap, err := NewActivities(Deps{Milestones: m}).PollMilestone(context.Background(), MilestoneRef{OrgID: "o", ProjectID: "p", MilestoneNumber: 7})
	if err != nil {
		t.Fatal(err)
	}
	if snap.OpenBuildItems != 2 || snap.DevWork != 3 {
		t.Fatalf("snapshot = %+v, want 2 open build items beside a working set of 3", snap)
	}

	m.counts.OpenDevelopment = 0
	m.listed = 0
	snap, _ = NewActivities(Deps{Milestones: m}).PollMilestone(context.Background(), MilestoneRef{MilestoneNumber: 7})
	if snap.OpenBuildItems != 0 || m.listed != 0 {
		t.Fatalf("no open planned work: items %d, listed %d times, want no second read", snap.OpenBuildItems, m.listed)
	}
}

// A green cycle that ticks a build item leaves the issue counts as they were,
// and has still progressed.
func TestNoProgress_ATickedItemIsProgress(t *testing.T) {
	before := progressUnits(1, MilestoneSnapshot{OpenBuildItems: 3})
	ticked := progressUnits(1, MilestoneSnapshot{OpenBuildItems: 2})
	if noProgress(cycleGreen, before, ticked) {
		t.Fatal("a cycle that ticked an item read as no progress")
	}
	if !noProgress(cycleGreen, before, before) {
		t.Fatal("a cycle that ticked nothing and closed nothing read as progress")
	}
}
