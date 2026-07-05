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
	"strings"
	"testing"
)

// The embedded task-breakdown skill must load with its frontmatter name and a
// non-empty body — this is the default the BFF pushes on every plan/detail call.
func TestLoadTaskBreakdownSkill(t *testing.T) {
	sk := loadTaskBreakdownSkill()
	if sk == nil {
		t.Fatal("expected embedded task-breakdown skill, got nil")
	}
	if sk.Name != "task-breakdown" {
		t.Fatalf("skill name = %q, want task-breakdown", sk.Name)
	}
	if strings.TrimSpace(sk.Description) == "" {
		t.Fatal("skill description is empty")
	}
	if !strings.Contains(sk.Body, "topological order") {
		t.Fatalf("skill body missing expected guidance; body = %q", sk.Body)
	}
}

// buildPlanRequest / buildDetailRequest must attach the pushed skill so the
// task-planner receives the breakdown guidance on both phases.
func TestBuildRequestsPushTaskBreakdownSkill(t *testing.T) {
	plan := buildPlanRequest("proj", "spec", nil, DesignDiff{}, "", nil, "fresh", nil)
	if plan.TaskBreakdownSkill == nil || plan.TaskBreakdownSkill.Name != "task-breakdown" {
		t.Fatalf("plan request did not push the task-breakdown skill: %+v", plan.TaskBreakdownSkill)
	}
}
