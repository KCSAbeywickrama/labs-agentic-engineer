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
	"encoding/json"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/contracts/taskmeta"
)

// TestComputeAttention_CleanTaskIsEmptyNonNilSlice guards the contract that
// TaskView.attention is "[] when clean", never nil. A nil slice marshals as
// JSON null, and the task-log stream forwards the `task` frame verbatim to the
// console, which maps over attention unconditionally — a null there blanked the
// whole detail page (found in live e2e). The REST path coerced null→[] on the
// client; the stream path trusted the contract, so the contract must hold here.
func TestComputeAttention_CleanTaskIsEmptyNonNilSlice(t *testing.T) {
	flags := computeAttention(taskmeta.ParsedLabels{}, taskmeta.Block{}, nil, "")
	if flags == nil {
		t.Fatal("computeAttention returned nil for a clean task — must be a non-nil empty slice ([], not null)")
	}
	if len(flags) != 0 {
		t.Fatalf("a clean task must have no attention flags, got %v", flags)
	}
	b, err := json.Marshal(flags)
	if err != nil {
		t.Fatalf("marshal attention: %v", err)
	}
	if strings.TrimSpace(string(b)) != "[]" {
		t.Errorf("clean attention marshaled as %s, want []", b)
	}
}
