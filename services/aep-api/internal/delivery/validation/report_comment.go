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
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// The validation report lives as a comment on the tag's validation issue, not as
// a file in the repo: a committed report is one mutable path, so a given run's
// results are unaddressable once the next run overwrites them. On the issue,
// successive runs append and the issue's tag makes each report's version
// explicit. The issue also outlives the validation PR and exists before it, so a
// run that never opens a PR can still have reported.
//
// The comment is authored by the runner's aep-validation skill and shaped:
//
//	<!-- aep:validation-report/v1 execution=<executionID> -->
//	…rendered report.md…
//	```json
//	{ …report.json… }
//	```
//
// The marker carries the identity so a reader never has to guess which comment
// is a report; the fence carries the machine payload beside the human rendering
// so the two can never disagree about which run they describe.
//
// There is no tag attribute: the issue is already the tag's issue (stamped
// aep:spec/<tag> at mint), so a tag in the marker could only ever contradict it.
// Attributes are parsed permissively, so one that appears later — including a
// tag — is read without breaking older readers.
//
// SECURITY: this comment is editable by anyone with repo write access. The
// verdict is therefore computed once at ingest and persisted, so a later edit
// cannot silently rewrite a recorded verdict — the ingest window is the trust
// boundary.
const reportMarkerName = "aep:validation-report/v1"

// reportMarkerRE captures the marker's attribute list (`execution=…`).
var reportMarkerRE = regexp.MustCompile(`<!--\s*` + regexp.QuoteMeta(reportMarkerName) + `\s+([^>]*?)\s*-->`)

// ErrNoReportComment means no comment on the issue carried a report marker for
// the requested execution. Deliberately distinct from a malformed report: the caller
// maps this to delivery.ValidationFailureReportMissing ("the runner never
// reported") and any other error to ValidationFailureReportInvalid ("the runner
// reported something unreadable"). Collapsing them would hide which half of the
// contract broke.
var ErrNoReportComment = errors.New("no validation report comment on the issue")

// ReportComment is one report recovered from the validation issue.
type ReportComment struct {
	// Tag is empty for reports the runner posts today — the issue already
	// identifies the version. Parsed if a future marker carries one.
	Tag       string
	Execution string
	// Report is the raw report JSON from the fenced block, ready for
	// ComputeVerdict or for handing to the console verbatim.
	Report    []byte
	CreatedAt time.Time
}

// FindReportComment returns the newest report comment written by execution, or
// the newest from any execution when execution is empty. Comments arrive
// oldest-first from the host, but ordering is re-derived from CreatedAt rather
// than trusted, so a paging quirk cannot select a stale report.
//
// The filter is the EXECUTION id, not the tag: the orchestrator dispatched that
// execution and the runner reports under it, so the correlation is exact. Tag
// would be ambiguous — spec tag and design tag are different vocabularies that
// can drift — and, worse, a re-run against the same tag reuses the same issue, so
// tag-matching would happily return the PREVIOUS run's report and mask a run that
// never reported at all.
//
// Returns ErrNoReportComment when nothing matched. A comment that carries the
// marker but no recoverable payload is an error, never a miss — the runner
// claiming to have reported and failing to is a different fault from the runner
// never reporting.
func FindReportComment(comments []sourcecontrol.IssueComment, execution string) (*ReportComment, error) {
	var newest *ReportComment
	var malformed error

	for _, c := range comments {
		// Index form: loc[0:2] spans the marker, loc[2:4] its attribute list.
		// The payload is searched only AFTER the marker, so a fence quoted in
		// prose above it cannot be mistaken for the report.
		loc := reportMarkerRE.FindStringSubmatchIndex(c.Body)
		if loc == nil {
			continue
		}
		attrs := parseMarkerAttrs(c.Body[loc[2]:loc[3]])
		if execution != "" && attrs["execution"] != execution {
			continue
		}
		payload, err := extractJSONFence(c.Body[loc[1]:])
		if err != nil {
			// Remember it, but keep looking — a newer well-formed report
			// supersedes an older broken one.
			malformed = fmt.Errorf("validation report comment %d: %w", c.ID, err)
			continue
		}
		if newest != nil && !c.CreatedAt.After(newest.CreatedAt) {
			continue
		}
		newest = &ReportComment{
			Tag:       attrs["tag"],
			Execution: attrs["execution"],
			Report:    payload,
			CreatedAt: c.CreatedAt,
		}
	}

	if newest != nil {
		return newest, nil
	}
	if malformed != nil {
		return nil, malformed
	}
	return nil, ErrNoReportComment
}

// parseMarkerAttrs reads the marker's space-separated key=value pairs. Unknown
// keys are kept so the marker can grow without breaking older readers.
func parseMarkerAttrs(s string) map[string]string {
	out := map[string]string{}
	for _, field := range strings.Fields(s) {
		k, v, ok := strings.Cut(field, "=")
		if !ok {
			continue
		}
		out[k] = v
	}
	return out
}

// extractJSONFence pulls the payload out of the first ```json fence in s.
//
// Scanning for a line that is exactly ``` is safe because the payload is
// JSON-encoded: every newline inside a string value is escaped as \n, so no line
// of the payload can itself be a bare fence.
func extractJSONFence(s string) ([]byte, error) {
	const open = "```json"
	i := strings.Index(s, open)
	if i < 0 {
		return nil, errors.New("marker present but no ```json payload fence")
	}
	rest := s[i+len(open):]
	rest = strings.TrimPrefix(rest, "\r")
	rest = strings.TrimPrefix(rest, "\n")

	for start := 0; ; {
		j := strings.Index(rest[start:], "```")
		if j < 0 {
			return nil, errors.New("unterminated ```json payload fence")
		}
		end := start + j
		// The closing fence must start a line, else it is content.
		if end != 0 && rest[end-1] != '\n' {
			start = end + 3
			continue
		}
		payload := strings.TrimRight(rest[:end], "\r\n")
		if strings.TrimSpace(payload) == "" {
			return nil, errors.New("empty ```json payload fence")
		}
		return []byte(payload), nil
	}
}
