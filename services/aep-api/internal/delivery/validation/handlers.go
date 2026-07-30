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
	"context"
	"time"

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/platform/apierr"
	"github.com/wso2/aep/aep-api/internal/platform/auth"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
)

// Handler serves the two validation endpoints the verdict model needs: read the
// report for a tag, and record the human verdict when the automatic path
// declined to decide. Org comes from the gate-bound context.
type Handler struct {
	svc  *Service
	runs ValidationRunStore
}

// NewHandler returns the slice's handler.
func NewHandler(svc *Service, runs ValidationRunStore) *Handler {
	return &Handler{svc: svc, runs: runs}
}

// GetValidationReport returns the newest report for a tag, read from the tag's
// validation issue. The report is NOT in the repo — it lives on the issue so
// successive runs stay individually addressable — so this resolves the run row to
// find the issue, then reads the marked comment.
func (h *Handler) GetValidationReport(ctx context.Context, request gen.GetValidationReportRequestObject) (gen.GetValidationReportResponseObject, error) {
	if h.svc == nil || h.runs == nil {
		return nil, apierr.ServiceUnavailable("validation reports not configured")
	}
	org := tenant.BoundOrgFromContext(ctx)

	run, err := h.runs.LatestValidationRunByTag(ctx, org, request.ProjectName, request.Params.Tag)
	if err != nil {
		return nil, apierr.Internal("internal error")
	}
	if run == nil || run.IssueNumber == 0 {
		return nil, apierr.NotFound("no validation run for this project")
	}

	// No execution filter: the run row already narrowed us to this tag's issue, and
	// the console wants whatever the newest report on it is.
	rc, err := h.svc.ReadReport(ctx, org, request.ProjectName, run.IssueNumber, "")
	if err != nil {
		// A missing or unreadable report is a 404, not a 500: the request was
		// well-formed and the answer is "there is nothing to show yet". Only a
		// transport failure is ours to own.
		if _, isContent := ReportContentFailure(err); isContent {
			return nil, apierr.NotFound(err.Error())
		}
		return nil, apierr.Internal("internal error")
	}

	return gen.GetValidationReport200JSONResponse{
		Tag:         run.Tag,
		IssueNumber: int64(run.IssueNumber),
		ReportedAt:  rc.CreatedAt.UTC().Format(time.RFC3339),
		Content:     string(rc.Report),
	}, nil
}

// SetValidationVerdict records a human verdict on a run whose automatic verdict
// is awaiting_review.
//
// An automatic pass or fail is final: the guard lives in the repository's UPDATE
// so this cannot be raced, and a run that already has a decided verdict answers
// 409. That is the whole point of the state — "pass" must never mean a human
// clicked past a failing suite.
func (h *Handler) SetValidationVerdict(ctx context.Context, request gen.SetValidationVerdictRequestObject) (gen.SetValidationVerdictResponseObject, error) {
	if h.runs == nil {
		return nil, apierr.ServiceUnavailable("validation verdicts not configured")
	}
	if request.Body == nil {
		return nil, apierr.BadRequest("verdict is required")
	}
	verdict := string(request.Body.Verdict)
	// The contract's enum already excludes awaiting_review; this keeps the
	// invariant true even if the generated validator is bypassed.
	if verdict != delivery.ValidationVerdictPass && verdict != delivery.ValidationVerdictFail {
		return nil, apierr.BadRequest("verdict must be pass or fail")
	}

	org := tenant.BoundOrgFromContext(ctx)
	run, err := h.runs.LatestValidationRunByTag(ctx, org, request.ProjectName, "")
	if err != nil {
		return nil, apierr.Internal("internal error")
	}
	if run == nil {
		return nil, apierr.NotFound("no validation run for this project")
	}

	applied, err := h.runs.ResolveValidationVerdict(ctx, run.WorkflowID, verdict, auth.ActorFromContext(ctx), request.Body.Note)
	if err != nil {
		return nil, apierr.Internal("internal error")
	}
	if !applied {
		return nil, apierr.Conflict("this validation run's verdict is not awaiting review")
	}
	return gen.SetValidationVerdict204Response{}, nil
}
