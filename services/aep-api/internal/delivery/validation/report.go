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

// ReportFilePath is the run report the validation runner commits, and the
// console renders. It is the counterpart of criteriaFilePath: the oracle says
// what must hold, the report says what did.
const ReportFilePath = "tests/validation/report.json"

// reportDoc is the slice of the runner's report a VERDICT is derived from. The
// console reads the whole document per criterion; the run only needs to know
// whether anything the runner could decide came out negative.
type reportDoc struct {
	Criteria []reportCriterion `json:"criteria"`
}

type reportCriterion struct {
	ID     string `json:"id"`
	Method string `json:"method"`
	// Status is the runner's per-criterion outcome: pass | fail | not_run |
	// not_validated | manual.
	Status string `json:"status"`
	// Must is the criterion's requirement, echoed into the report by the generator.
	// Having it here is what makes a report self-contained: a repair issue can name
	// what the criterion demanded without a second read of the oracle.
	Must string `json:"must"`
	// Failure is what the assertion said, on a `fail`. generate-report.mjs writes
	// it as an OBJECT — a bare string is tolerated because reports already merged
	// into project repos carry that older shape, and a report is read long after it
	// was written. Same reasoning as the console parser's parseFailure.
	Failure reportFailure `json:"failure"`
	// Spec is the Playwright spec file that produced the outcome.
	Spec string `json:"spec"`
}

// reportFailure is a criterion's failure detail, decoded from either shape.
type reportFailure struct {
	Message  string `json:"message"`
	Location string `json:"location"`
}

// UnmarshalJSON accepts both the object shape generate-report.mjs writes and the
// bare string older reports carry.
func (f *reportFailure) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		f.Message, f.Location = s, ""
		return nil
	}
	var obj struct {
		Message  string `json:"message"`
		Location string `json:"location"`
	}
	if err := json.Unmarshal(data, &obj); err != nil {
		// Neither shape. A failure we cannot read is not a reason to discard the
		// verdict the status already carries, so it degrades to no detail.
		f.Message, f.Location = "", ""
		return nil
	}
	f.Message, f.Location = obj.Message, obj.Location
	return nil
}

// FailedCriterion is one criterion the report says lost its assertion, with
// everything a repair issue needs to name it — including the `must`, which the
// generator echoes into the report so this is answerable from one read.
type FailedCriterion struct {
	ID       string
	Method   string
	Must     string
	Message  string
	Location string
	Spec     string
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
// Sorted because report order is the runner's spec-discovery order, which is not a
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
	if len(doc.Criteria) == 0 {
		return ""
	}
	lines := make([]string, 0, len(doc.Criteria))
	for _, c := range doc.Criteria {
		// The failure message is part of the answer: the same criterion failing for a
		// different reason means the repair changed something, even if it is still red.
		lines = append(lines, c.ID+"\x00"+c.Status+"\x00"+c.Failure.Message)
	}
	sort.Strings(lines)
	sum := sha256.Sum256([]byte(strings.Join(lines, "\x1e")))
	return hex.EncodeToString(sum[:])
}

// FailedCriteria returns the criteria the report records as failed, in report
// order. Empty for an absent, unparseable or all-green report — every case where
// there is nothing to repair.
//
// It is deliberately separate from VerdictFromReport rather than folded into it.
// The verdict is a single value the run stores; this is a list the supervisor turns
// into issues, and the two are read by different callers at different moments (the
// second only when the first came back `failed`).
func FailedCriteria(raw []byte) []FailedCriterion {
	if len(raw) == 0 {
		return nil
	}
	var doc reportDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil
	}
	var out []FailedCriterion
	for _, c := range doc.Criteria {
		if c.Status != criterionFail {
			continue
		}
		out = append(out, FailedCriterion{
			ID:       c.ID,
			Method:   c.Method,
			Must:     c.Must,
			Message:  c.Failure.Message,
			Location: c.Failure.Location,
			Spec:     c.Spec,
		})
	}
	return out
}

// Per-criterion outcomes the runner writes. Shared with the console's
// validation-view parser, which renders the same five states per criterion.
//
// The last three are not failures and not passes: they are the automatic path
// declining to judge. `not_run` is an e2e criterion whose spec was skipped or was
// never written; `manual` and `not_validated` are the criterion's own method
// (manual and scenario) echoed back, and neither is ever executed.
const (
	criterionPass         = "pass"
	criterionFail         = "fail"
	criterionNotRun       = "not_run"
	criterionManual       = "manual"
	criterionNotValidated = "not_validated"
)

// VerdictFromReport derives a run's validation verdict from the committed report,
// returning one of the delivery.ValidationVerdict* values. Applied in order:
//
//  1. no usable report (absent, unparseable, or carrying no criteria) → unreported
//  2. any criterion failed                                           → failed
//  3. no criterion passed                                            → inconclusive
//  4. any criterion was never covered                                → partial
//  5. otherwise every criterion passed                               → passed
//
// Order carries the meaning. A real assertion failure wins outright (2), because
// it is the one thing the report says about the *software* rather than about the
// harness. Rule 5 then requires FULL coverage for `passed`: the previous rule
// returned passed whenever one criterion passed and none failed, so a project
// could read "passed" over twenty manual criteria nobody had looked at — `partial`
// exists to say that honestly instead.
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
	// No criteria is not a vacuous pass: "nothing failed" over an empty set would
	// otherwise report success for a run that judged nothing.
	if len(doc.Criteria) == 0 {
		return delivery.ValidationVerdictUnreported
	}

	passed, uncovered := false, false
	for _, c := range doc.Criteria {
		switch c.Status {
		case criterionFail:
			return delivery.ValidationVerdictFailed
		case criterionPass:
			passed = true
		case criterionNotRun, criterionManual, criterionNotValidated:
			uncovered = true
		default:
			// An unrecognised state is evidence we cannot interpret; treat it as a
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
