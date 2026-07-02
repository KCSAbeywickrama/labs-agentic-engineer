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

// UNIT tier: classifyCodingAgentRun — the coding-agent watcher's terminal-state
// mapper. Was previously untested (only build_watcher's classifyRun had unit
// coverage). Success is deliberately a NON-event (it rides the GitHub
// pr.ready_for_review webhook), so only terminal-failed maps to a transition.

import (
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/contracts"
	"github.com/wso2/aep/aep-api/models"
)

func TestClassifyCodingAgentRun_NilAndIncomplete(t *testing.T) {
	if ev, _ := classifyCodingAgentRun(nil); ev != "" {
		t.Fatalf("nil run must yield no event, got %q", ev)
	}
	// Not Completed → no event regardless of Status string.
	for _, status := range []string{"Pending", "Running", openchoreo.ReasonWorkflowFailed} {
		run := &models.WorkflowRun{Status: status, Completed: false}
		if ev, _ := classifyCodingAgentRun(run); ev != "" {
			t.Fatalf("incomplete %q must yield no event, got %q", status, ev)
		}
	}
}

func TestClassifyCodingAgentRun_SucceededIsNonEvent(t *testing.T) {
	// A succeeded coding-agent run is observed but NOT acted on — the task
	// advances via the GitHub webhook, not the watcher.
	run := &models.WorkflowRun{Status: openchoreo.ReasonWorkflowSucceeded, Completed: true}
	if ev, _ := classifyCodingAgentRun(run); ev != "" {
		t.Fatalf("succeeded run must be a non-event, got %q", ev)
	}
}

func TestClassifyCodingAgentRun_TerminalFailure(t *testing.T) {
	run := &models.WorkflowRun{Status: openchoreo.ReasonWorkflowFailed, Completed: true}
	ev, msg := classifyCodingAgentRun(run)
	if ev != contracts.TaskEventCodingAgentFailed {
		t.Fatalf("completed non-succeeded run must map to coding_agent.failed, got %q", ev)
	}
	if msg == "" {
		t.Fatal("terminal failure must carry a non-empty message")
	}
}
