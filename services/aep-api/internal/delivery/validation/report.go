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
	"encoding/json"

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
