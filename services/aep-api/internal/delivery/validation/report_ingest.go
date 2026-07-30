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
	"errors"
	"fmt"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

// ReportIngest is one ingest attempt's outcome. Verdict is set when the report
// was read and judged; FailureKind + Detail are set when it could not be. The two
// halves are mutually exclusive — an ingest either produced an answer or explains
// why it could not.
type ReportIngest struct {
	Verdict     string // delivery.ValidationVerdict*
	FailureKind string // delivery.ValidationFailure*
	Detail      string // human detail behind FailureKind
}

// IngestReport reads the report this execution posted to the project's validation
// issue and computes the phase's verdict.
//
// The error/data split is the contract with the calling activity:
//
//   - a TRANSPORT failure (the host is unreachable, credentials expired) returns
//     an error, so Temporal retries — the report may well be readable a moment
//     later;
//   - a CONTENT problem (no report, or one that cannot be parsed) returns data
//     with a FailureKind, because retrying cannot fix an unreadable report and a
//     retry loop would only delay reporting the real fault.
//
// report_missing and report_invalid stay distinct: "the runner never reported"
// and "the runner reported something unreadable" are different faults, and a
// single bucket would hide which half of the contract broke.
func (s *Service) IngestReport(ctx context.Context, orgID, projectID string, issue int, execution string) (ReportIngest, error) {
	rc, err := s.ReadReport(ctx, orgID, projectID, issue, execution)
	if err != nil {
		var contentErr *reportContentError
		if errors.As(err, &contentErr) {
			return ReportIngest{FailureKind: contentErr.kind, Detail: contentErr.detail}, nil
		}
		return ReportIngest{}, err // transport — let the activity retry
	}

	verdict, err := ComputeVerdict(rc.Report)
	if err != nil {
		return ReportIngest{
			FailureKind: delivery.ValidationFailureReportInvalid,
			Detail:      err.Error(),
		}, nil
	}
	return ReportIngest{Verdict: verdict}, nil
}

// ReadReport returns the newest report comment off the validation issue, narrowed
// to one execution when execution is non-empty. Shared by the ingest activity
// (which pins its own execution) and the console's report endpoint (which wants
// whatever the newest report on the tag's issue is), so both resolve a report
// through one code path.
//
// A missing or unreadable report is returned as a *reportContentError carrying
// the failure kind; a transport failure is returned as-is.
func (s *Service) ReadReport(ctx context.Context, orgID, projectID string, issue int, execution string) (*ReportComment, error) {
	comments, err := s.issues.ListIssueComments(ctx, orgID, projectID, issue)
	if err != nil {
		return nil, fmt.Errorf("list validation issue comments: %w", err)
	}

	rc, err := FindReportComment(comments, execution)
	if err != nil {
		if errors.Is(err, ErrNoReportComment) {
			return nil, &reportContentError{
				kind:   delivery.ValidationFailureReportMissing,
				detail: reportMissingDetail(issue, execution),
				err:    err,
			}
		}
		return nil, &reportContentError{
			kind:   delivery.ValidationFailureReportInvalid,
			detail: err.Error(),
			err:    err,
		}
	}
	return rc, nil
}

// reportContentError marks a failure that lies in the report's CONTENT rather
// than in reaching it — the distinction that decides whether a retry could ever
// help. Carries the failure kind so callers classify without re-deriving it.
type reportContentError struct {
	kind   string
	detail string
	err    error
}

func (e *reportContentError) Error() string { return e.detail }
func (e *reportContentError) Unwrap() error { return e.err }

// ReportContentFailure reports whether err is a report-content failure and, if
// so, its delivery.ValidationFailure* kind. Lets callers outside this package
// (the report endpoint) distinguish "no report yet" from "the host is down"
// without reaching for the unexported type.
func ReportContentFailure(err error) (kind string, ok bool) {
	var contentErr *reportContentError
	if errors.As(err, &contentErr) {
		return contentErr.kind, true
	}
	return "", false
}

// reportMissingDetail phrases the miss for a human: naming the execution matters
// when a re-run against the same tag reuses the issue, because "no report on the
// issue" and "no report from THIS run" look identical otherwise.
func reportMissingDetail(issue int, execution string) string {
	if execution == "" {
		return fmt.Sprintf("no validation report has been posted to issue #%d", issue)
	}
	return fmt.Sprintf("validation run %s posted no report to issue #%d", execution, issue)
}
