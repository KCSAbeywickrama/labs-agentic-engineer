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

package edge

import (
	"net/http"
	"testing"

	"github.com/wso2/aep/ae-studio-tools/internal/turns/turnstest"
)

const threadPath = "/internal/v1/repos/acme-gh/greeter/issues/7/thread"

// aep-api removes an issue's thread: the project must be this repository's,
// and the removal reaches the agent with its project, issue and bound.
func TestRemoveIssueThread_RelaysToTheAgent(t *testing.T) {
	sock := turnstest.New(t, turnstest.Script{})
	h := newHarness(t, withTurnSocket(sock), withProjects(greeterRepo))
	m := h.m2m()

	rec := h.do(http.MethodDelete, threadPath+"?project=greeter&before=2026-10-01T10:00:00Z", m, "ou-1", nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("remove = %d %s", rec.Code, rec.Body)
	}
	got := sock.Removals()
	if len(got) != 1 || got[0].Project != "greeter" || got[0].Issue != "7" || got[0].Before != "2026-10-01T10:00:00Z" {
		t.Fatalf("removals = %+v", got)
	}

	other := h.do(http.MethodDelete, "/internal/v1/repos/acme-gh/other/issues/7/thread?project=greeter&before=2026-10-01T10:00:00Z", m, "ou-1", nil)
	if other.Code != http.StatusNotFound {
		t.Fatalf("another repository's project = %d, want 404", other.Code)
	}
	if len(sock.Removals()) != 1 {
		t.Fatal("a refused removal reached the agent")
	}
}

// The agent unreachable is a 503 the caller retries.
func TestRemoveIssueThread_AgentDownIs503(t *testing.T) {
	h := newHarness(t, withProjects(greeterRepo))
	rec := h.do(http.MethodDelete, threadPath+"?project=greeter&before=2026-10-01T10:00:00Z", h.m2m(), "ou-1", nil)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("remove with no agent = %d", rec.Code)
	}
}
