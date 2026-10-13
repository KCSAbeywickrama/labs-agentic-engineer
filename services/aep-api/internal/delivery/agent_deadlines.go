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

import "time"

// Platform defaults for AgentDeadlines.
const (
	// DefaultCodingAgentDeadline bounds a coding cycle (coding, fix,
	// conflict). The cycle works the milestone's whole issue set, boots what it
	// built, drives it through a browser verification wave and heals what that
	// finds; a shorter bound reaps the pod mid-verification with no verdict.
	DefaultCodingAgentDeadline = 5 * time.Hour
	// DefaultValidationAgentDeadline bounds a validation cycle: one browser
	// session driving every acceptance scenario in sequence.
	DefaultValidationAgentDeadline = 2 * time.Hour
	// landingMargin is how much longer than the longest Job the supervisor
	// waits for a dispatch to land: the runner's own stop, the pull request's
	// checks and its merge all happen after the agent's last turn.
	landingMargin = time.Hour
)

// AgentDeadlines is how long one agent cycle may run, per cycle kind. It is the
// single source every bound on an agent's wall clock derives from:
//
//   - the Job's activeDeadlineSeconds, and the runner's own deadline
//     (AEP_RUN_DEADLINE_SECONDS) handed the same number (For);
//   - the coding-agent ComponentType schema's maximum, which rejects any
//     dispatch past it (Ceiling);
//   - the settler's hold on a merged cycle's still-running pod (Ceiling);
//   - the run supervisor's wait for a dispatch to land (LandingTimeout).
//
// Deriving them from one value is what keeps them ordered: a landing timeout
// shorter than the Job deadline calls a live agent dead and spends a
// re-dispatch on it.
//
// The zero value, and any non-positive field, is the platform default, so a
// consumer nobody configured agrees with one configured with nothing.
type AgentDeadlines struct {
	Coding     time.Duration
	Validation time.Duration
}

// For is the deadline a cycle of the given kind runs under. Every kind but
// validation is the ordinary milestone loop and shares the coding deadline.
func (d AgentDeadlines) For(kind string) time.Duration {
	if kind == CycleKindValidation {
		return orDefault(d.Validation, DefaultValidationAgentDeadline)
	}
	return orDefault(d.Coding, DefaultCodingAgentDeadline)
}

// Ceiling is the longest deadline any cycle may be given.
func (d AgentDeadlines) Ceiling() time.Duration {
	return max(d.For(CycleKindCoding), d.For(CycleKindValidation))
}

// LandingTimeout is how long the run supervisor gives ONE dispatch to land a
// merged pull request before it calls the agent dead. It outlives every Job,
// so the timeout only ever fires on an agent Kubernetes has already stopped.
func (d AgentDeadlines) LandingTimeout() time.Duration {
	return d.Ceiling() + landingMargin
}

func orDefault(d, def time.Duration) time.Duration {
	if d <= 0 {
		return def
	}
	return d
}
