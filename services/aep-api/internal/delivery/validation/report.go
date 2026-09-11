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

package validation

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

// ReportFilePath is the run report the acceptance run commits, and the console
// renders. It is the counterpart of the feature files: the scenarios say what
// must hold, the report says what did.
const ReportFilePath = "tests/acceptance/report.json"

// reportDoc is the slice of the runner's report a VERDICT is derived from. The
// console reads the whole document; the run only needs to know whether anything
// the agent could decide came out negative.
type reportDoc struct {
	Scenarios []reportScenario `json:"scenarios"`
}

// reportScenario is one scenario the agent drove. There is no generated test
// code, so the steps ARE the evidence: each one carries the command that ran it
// and, where the exit code is not the verdict, what was observed.
type reportScenario struct {
	Feature     string `json:"feature"`
	FeatureFile string `json:"featureFile"`
	Line        int    `json:"line"`
	Rule        string `json:"rule"`
	Scenario    string `json:"scenario"`
	// Outcome is the agent's per-scenario verdict: passed | failed | blocked |
	// unjudgeable.
	Outcome string       `json:"outcome"`
	Steps   []reportStep `json:"steps"`
}

// reportStep is one Gherkin step as executed.
type reportStep struct {
	Text    string `json:"text"`
	Keyword string `json:"keyword"`
	Command string `json:"command"`
	// Exit is a POINTER so "the command was not run" is distinguishable from
	// "it exited 0". A blocked scenario's later steps carry neither.
	Exit *int `json:"exit"`
	// Observed is what the agent read, required wherever the exit code does not
	// settle the step — a nonzero exit, a step with no command, or a command
	// that prints a value (`get count`) and so exits 0 merely by running.
	Observed string `json:"observed"`
}

// id is the scenario's natural key. Gherkin carries no ids, and a tag scheme was
// considered and rejected as machinery for this phase, so identity is what the
// scenario IS. ASCII-joined on purpose: this string becomes a GitHub dedupe
// label, which issue_service.go normalises and — past 50 chars — hashes.
func (s reportScenario) id() string {
	parts := make([]string, 0, 3)
	for _, p := range []string{s.Feature, s.Rule, s.Scenario} {
		if strings.TrimSpace(p) != "" {
			parts = append(parts, strings.TrimSpace(p))
		}
	}
	return strings.Join(parts, " / ")
}

// deciding returns the step that settled the scenario, and whether there was
// one. A nonzero exit wins; otherwise the first step carrying an observation,
// which is how a value-returning command (`get count`) records its verdict.
func (s reportScenario) deciding() (reportStep, bool) {
	for _, st := range s.Steps {
		if st.Exit != nil && *st.Exit != 0 {
			return st, true
		}
	}
	for _, st := range s.Steps {
		if strings.TrimSpace(st.Observed) != "" {
			return st, true
		}
	}
	return reportStep{}, false
}

// text renders the scenario as it was written, so a repair issue can quote it
// without a second read of the feature file.
func (s reportScenario) text() string {
	var b strings.Builder
	for _, st := range s.Steps {
		if st.Keyword != "" {
			b.WriteString(st.Keyword)
			b.WriteString(" ")
		}
		b.WriteString(st.Text)
		b.WriteString("\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

// FailedScenario is one scenario the report says the app did not satisfy, with
// everything a repair issue needs to name it — including the scenario text, so
// the issue is answerable from one read.
type FailedScenario struct {
	ID          string
	Feature     string
	Rule        string
	Scenario    string
	FeatureFile string
	Line        int
	// Text is the scenario's own Given/When/Then, as executed.
	Text string
	// Step is the step that settled it, and Observed what the agent saw there.
	Step     string
	Observed string
}

// ReportDigest fingerprints WHAT A REPORT CONCLUDED, so two validation attempts
// can be compared. Empty for an absent or unparseable report — there is nothing to
// compare, and two empty digests must not read as "the same answer twice".
//
// It covers the criteria only: each one's id, status and failure message, sorted by
// id. Explicitly NOT the file bytes. The runner generates the report with
// `--commit "$(git rev-parse HEAD)"`, so a whole-file hash changes on every attempt
// and would make an identical-answer check dead code that silently never fires.
//

// ReportDigest fingerprints WHAT A REPORT CONCLUDED, so two validation attempts
// can be compared. Empty for an absent or unparseable report — there is nothing to
// compare, and two empty digests must not read as "the same answer twice".
//
// It covers the scenarios only: each one's id, outcome, and what was observed at
// the step that settled it, sorted by id. Explicitly NOT the file bytes — the
// report stamps `commit` and `generatedAt`, so a whole-file hash would change on
// every attempt and make the identical-answer check dead code that never fires.
//
// The observation is part of the answer: the same scenario failing for a different
// reason means the repair changed something, even if it is still red.
//
// Sorted because report order is the agent's file-discovery order, which is not a
// promise; two attempts that found the same outcomes in a different order reached
// the same answer.
func ReportDigest(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	var doc reportDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		return ""
	}
	if len(doc.Scenarios) == 0 {
		return ""
	}
	lines := make([]string, 0, len(doc.Scenarios))
	for _, s := range doc.Scenarios {
		observed := ""
		if step, ok := s.deciding(); ok {
			observed = step.Observed
		}
		lines = append(lines, s.id()+"\x00"+s.Outcome+"\x00"+observed)
	}
	sort.Strings(lines)
	sum := sha256.Sum256([]byte(strings.Join(lines, "\x1e")))
	return hex.EncodeToString(sum[:])
}

// FailedScenarios returns the scenarios the report records as failed, in report
// order. Empty for an absent, unparseable or all-green report — every case where
// there is nothing to repair.
//
// `blocked` is deliberately NOT included. The agent cannot tell an app that
// correctly refuses an action from one too broken to perform it, so filing repair
// work on a block would have a coding run add an affordance the requirement never
// asked for. A block is reported and left for a person.
//
// It is deliberately separate from VerdictFromReport rather than folded into it.
// The verdict is a single value the run stores; this is a list the supervisor turns
// into issues, and the two are read by different callers at different moments (the
// second only when the first came back `failed`).
func FailedScenarios(raw []byte) []FailedScenario {
	if len(raw) == 0 {
		return nil
	}
	var doc reportDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil
	}
	var out []FailedScenario
	for _, s := range doc.Scenarios {
		if s.Outcome != outcomeFailed {
			continue
		}
		f := FailedScenario{
			ID:          s.id(),
			Feature:     s.Feature,
			Rule:        s.Rule,
			Scenario:    s.Scenario,
			FeatureFile: s.FeatureFile,
			Line:        s.Line,
			Text:        s.text(),
		}
		if step, ok := s.deciding(); ok {
			f.Step, f.Observed = strings.TrimSpace(step.Keyword+" "+step.Text), step.Observed
		}
		out = append(out, f)
	}
	return out
}

// Per-scenario outcomes the agent writes. Shared with the report checker, which
// holds the agent to them.
//
// `failed` and `blocked` are both defects and are not merged: one says the
// behaviour is wrong, the other says the behaviour was never reached.
// `unjudgeable` is for truth that lives outside the running app. The last two are
// neither passes nor failures — they are the agent declining to judge, which is
// the honest answer and always better than a guess.
const (
	outcomePassed      = "passed"
	outcomeFailed      = "failed"
	outcomeBlocked     = "blocked"
	outcomeUnjudgeable = "unjudgeable"
)

// VerdictFromReport derives a run's validation verdict from the committed report,
// returning one of the delivery.ValidationVerdict* values. Applied in order:
//
//  1. no usable report (absent, unparseable, or carrying no scenarios) → unreported
//  2. any scenario failed                                              → failed
//  3. no scenario passed                                               → inconclusive
//  4. any scenario was never judged                                    → partial
//  5. otherwise every scenario passed                                  → passed
//
// Order carries the meaning. A real assertion failure wins outright (2), because
// it is the one thing the report says about the *software* rather than about the
// run. Rule 5 then requires FULL coverage for `passed`: a project must not read
// "passed" over scenarios nobody could drive — `partial` exists to say that
// honestly instead.
//
// Rules 1 and 3 look similar and are not. `inconclusive` means we read the
// evidence and it records that nothing ran; `unreported` means there was nothing
// to read. Only the second is fatal, because the read is pinned to the validation
// cycle's own merge commit — so an absent report is a fact about this run, not a
// propagation artifact.
func VerdictFromReport(raw []byte) string {
	if len(raw) == 0 {
		return delivery.ValidationVerdictUnreported
	}
	var doc reportDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		return delivery.ValidationVerdictUnreported
	}
	// No scenarios is not a vacuous pass: "nothing failed" over an empty set would
	// otherwise report success for a run that judged nothing.
	if len(doc.Scenarios) == 0 {
		return delivery.ValidationVerdictUnreported
	}

	passed, uncovered := false, false
	for _, s := range doc.Scenarios {
		switch s.Outcome {
		case outcomeFailed:
			return delivery.ValidationVerdictFailed
		case outcomePassed:
			passed = true
		case outcomeBlocked, outcomeUnjudgeable:
			uncovered = true
		default:
			// An unrecognised outcome is evidence we cannot interpret; treat it as a
			// gap rather than silently counting it towards full coverage.
			uncovered = true
		}
	}

	switch {
	case !passed:
		return delivery.ValidationVerdictInconclusive
	case uncovered:
		return delivery.ValidationVerdictPartial
	default:
		return delivery.ValidationVerdictPassed
	}
}
