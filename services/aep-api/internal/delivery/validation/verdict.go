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
	"errors"
	"fmt"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

// Per-criterion states in the runner's report, authored by the aep-validation
// skill's generate-report.mjs. The five values are a contract shared with the
// console's validation-view parser (packages/ui/validation-view/src/report.ts).
//
// The last three are not failures — they are the automatic path having produced
// no judgement: notRun is an e2e criterion whose spec was skipped or was never
// written, manual and notValidated are the criterion's own method (manual and
// scenario) echoed back, and neither is ever executed.
const (
	criterionPass         = "pass"
	criterionFail         = "fail"
	criterionNotRun       = "not_run"
	criterionManual       = "manual"
	criterionNotValidated = "not_validated"
)

// reportDoc is the runner's per-run report, reduced to the only part the verdict
// depends on. The document is otherwise opaque to the platform — the console
// fetches and parses the rest — so modelling more here would mean keeping a
// second definition of the report in step with the generator.
type reportDoc struct {
	Criteria []reportCriterion `json:"criteria"`
}

type reportCriterion struct {
	ID     string `json:"id"`
	Method string `json:"method"` // e2e | scenario | manual
	Status string `json:"status"` // one of the criterion* states above
}

// ComputeVerdict decides a validation run's verdict from its report, applying
// four rules in order:
//
//  1. any e2e criterion failed          → fail
//  2. any e2e criterion produced no run → awaiting_review
//  3. any manual or scenario criterion  → awaiting_review
//  4. every criterion is e2e and passed → pass
//
// Order matters: a failing assertion wins outright, so a run with both a failure
// and a manual criterion is a fail rather than deferring to a human.
//
// The rules read the per-criterion status rather than the method because the
// generator derives one from the other (method=manual ⇒ status=manual,
// method=scenario ⇒ status=not_validated), making status the single signal that
// covers all five states.
//
// pass therefore requires full automatic coverage, all green. An unrecognised
// state is an error, never a pass: silently ignoring a state the generator grew
// later would quietly widen pass, which is the one verdict that must not be
// reachable by accident. The caller maps any error to
// delivery.ValidationFailureReportInvalid.
func ComputeVerdict(raw []byte) (string, error) {
	var doc reportDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		return "", fmt.Errorf("parse validation report: %w", err)
	}
	// No criteria is not a vacuous pass — "nothing failed" over an empty set
	// would otherwise report success for a run that judged nothing.
	if len(doc.Criteria) == 0 {
		return "", errors.New("validation report has no criteria")
	}

	sawFail, needsHuman := false, false
	for _, c := range doc.Criteria {
		switch c.Status {
		case criterionPass:
			// contributes to rule 4; nothing to record
		case criterionFail:
			sawFail = true
		case criterionNotRun, criterionManual, criterionNotValidated:
			needsHuman = true
		default:
			return "", fmt.Errorf("validation report criterion %q has unrecognised state %q", c.ID, c.Status)
		}
	}

	switch {
	case sawFail:
		return delivery.ValidationVerdictFail, nil
	case needsHuman:
		return delivery.ValidationVerdictAwaitingReview, nil
	default:
		return delivery.ValidationVerdictPass, nil
	}
}
