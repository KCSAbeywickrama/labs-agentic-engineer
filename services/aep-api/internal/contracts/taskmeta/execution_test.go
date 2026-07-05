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

import "testing"

func TestExecutionKindValid(t *testing.T) {
	for _, k := range []ExecutionKind{KindCoding, KindBuild, KindOps} {
		if !k.Valid() {
			t.Errorf("%q should be valid", k)
		}
	}
	if ExecutionKind("nonsense").Valid() {
		t.Errorf("nonsense kind should be invalid")
	}
}

func TestExecutionStatusPredicates(t *testing.T) {
	tests := []struct {
		s        ExecutionStatus
		valid    bool
		terminal bool
		active   bool
	}{
		{ExecQueued, true, false, true},
		{ExecRunning, true, false, true},
		{ExecSucceeded, true, true, false},
		{ExecFailed, true, true, false},
		{ExecCanceled, true, true, false},
		{"bogus", false, false, false},
	}
	for _, tt := range tests {
		if got := tt.s.Valid(); got != tt.valid {
			t.Errorf("%q.Valid() = %v; want %v", tt.s, got, tt.valid)
		}
		if got := tt.s.IsTerminal(); got != tt.terminal {
			t.Errorf("%q.IsTerminal() = %v; want %v", tt.s, got, tt.terminal)
		}
		if got := tt.s.IsActive(); got != tt.active {
			t.Errorf("%q.IsActive() = %v; want %v", tt.s, got, tt.active)
		}
	}
}
