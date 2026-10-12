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

package delivery

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestAgentDeadlines_ZeroValueIsThePlatformDefault: an unwired consumer and a
// wired one with nothing configured must agree, or the schema could bound a Job
// tighter than the dispatch asks for.
func TestAgentDeadlines_ZeroValueIsThePlatformDefault(t *testing.T) {
	var d AgentDeadlines
	require.Equal(t, 5*time.Hour, d.For(CycleKindCoding))
	require.Equal(t, 2*time.Hour, d.For(CycleKindValidation))
	require.Equal(t, 5*time.Hour, d.Ceiling())
}

// TestAgentDeadlines_EveryNonValidationKindIsACodingCycle: fix and conflict
// cycles are the ordinary milestone loop and run under the coding deadline.
func TestAgentDeadlines_EveryNonValidationKindIsACodingCycle(t *testing.T) {
	d := AgentDeadlines{Coding: 4 * time.Hour, Validation: time.Hour}
	for _, kind := range []string{CycleKindCoding, CycleKindFix, CycleKindConflict, ""} {
		require.Equal(t, 4*time.Hour, d.For(kind), "kind %q", kind)
	}
	require.Equal(t, time.Hour, d.For(CycleKindValidation))
}

// TestAgentDeadlines_CeilingIsTheLongestKind: the ComponentType schema's maximum
// must admit every dispatch, whichever kind is configured longer.
func TestAgentDeadlines_CeilingIsTheLongestKind(t *testing.T) {
	require.Equal(t, 3*time.Hour, AgentDeadlines{Coding: time.Hour, Validation: 3 * time.Hour}.Ceiling())
	require.Equal(t, 6*time.Hour, AgentDeadlines{Coding: 6 * time.Hour}.Ceiling())
}

// TestAgentDeadlines_LandingTimeoutOutlivesEveryJob is the invariant the type
// exists for: the supervisor must never call a cycle dead while Kubernetes is
// still letting its pod run, or it spends a re-dispatch on a live agent.
func TestAgentDeadlines_LandingTimeoutOutlivesEveryJob(t *testing.T) {
	for _, d := range []AgentDeadlines{
		{},
		{Coding: 8 * time.Hour},
		{Coding: time.Hour, Validation: 3 * time.Hour},
	} {
		require.Greater(t, d.LandingTimeout(), d.Ceiling())
		require.Equal(t, d.Ceiling()+time.Hour, d.LandingTimeout())
	}
}
