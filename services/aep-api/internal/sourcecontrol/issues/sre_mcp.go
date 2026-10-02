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

package issues

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/platform/mcprpc"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// The OpenChoreo SRE agent's remediation handoff: an MCP surface with exactly
// two tools, search_related_issues and create_issue (the agent sees them as
// ae_search_related_issues and ae_create_issue, after its "ae" server name).
// They call the issue service in process, on behalf of the one org the
// installation's SRE agent serves. The caller is authenticated before this
// handler runs (auth.SREHandoffVerifier); the handler binds that org and the
// handoff's incident context, which CreateIssue requires before it accepts the
// componentName and actionStatuses only a trusted handoff may send.

// sreHandoffIncidentID is the incident context bound for every SRE-filed
// issue. CreateIssue derives the dedupe key from it with the org, project and
// component, so the handoff dedupes by component, not by a per-alert
// signature: there is no per-request signal this transport could bind that
// would mean anything finer.
const sreHandoffIncidentID = "sre-handoff"

// sreHandoffLabels are added to every SRE-filed issue: the handoff is by
// definition a defect report about a live incident.
var sreHandoffLabels = []string{"bug", "incident"}

// The platform's own plan issues. A search hit carrying them is AE's record of
// what to BUILD, which the remediation agent must not read as a defect report.
const (
	platformWorkLabel = "aep"
	platformPlanKind  = "development"
	platformIssueNote = "PLATFORM IMPLEMENTATION RECORD — this issue records AE's original plan for what " +
		"to BUILD. It is not a defect report and it is never grounds for ruling out a code " +
		"change: behaviour can be deliberate and still be worth hardening."
)

// kindsOutrankingPlan are issue kinds that make an aep-labelled issue a real
// report even when it also carries the development label.
var kindsOutrankingPlan = []string{"provision", "validation", "conflict", "bug"}

// NewSREMCPHandler serves the SRE handoff's MCP tools for org. issues may be
// nil, which answers every request 503, as the REST handler does.
func NewSREMCPHandler(issues sourcecontrol.IssueService, org string) http.Handler {
	server := mcprpc.Server{
		Name: "aep-sre-handoff", Version: "1.0.0", Tools: sreTools(),
		Call: func(w http.ResponseWriter, r *http.Request, req mcprpc.Request) {
			ctx := sourcecontrol.WithIncidentContext(tenant.WithBoundOrg(r.Context(), org), sreHandoffIncidentID)
			callSRETool(w, r.WithContext(ctx), issues, org, req)
		},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if issues == nil {
			http.Error(w, "issue service not configured", http.StatusServiceUnavailable)
			return
		}
		server.Serve(w, r)
	})
}

type sreToolArgs struct {
	Project        string    `json:"project"`
	Query          string    `json:"query"`
	Labels         []string  `json:"labels"`
	Title          string    `json:"title"`
	Body           string    `json:"body"`
	ComponentName  string    `json:"componentName"`
	ActionStatuses []*string `json:"actionStatuses"`
}

func callSRETool(w http.ResponseWriter, r *http.Request, issues sourcecontrol.IssueService, org string, req mcprpc.Request) {
	var call struct {
		Name      string      `json:"name"`
		Arguments sreToolArgs `json:"arguments"`
	}
	if err := json.Unmarshal(req.Params, &call); err != nil {
		mcprpc.WriteError(w, req.ID, mcprpc.CodeInvalidParams, "invalid params")
		return
	}
	args := call.Arguments
	slog.InfoContext(r.Context(), "sre handoff tool call", "org", org, "tool", call.Name, "project", args.Project)
	if args.Project == "" {
		mcprpc.WriteToolError(w, req.ID, "missing required argument: project")
		return
	}

	switch call.Name {
	case "search_related_issues":
		found, err := issues.ListIssues(r.Context(), org, args.Project, args.Labels)
		if err != nil {
			mcprpc.WriteToolError(w, req.ID, listIssuesFailure(err))
			return
		}
		ranked := sourcecontrol.RankIssuesByQuery(found, args.Query)
		out := make([]sreIssueView, 0, len(ranked))
		for _, iss := range ranked {
			out = append(out, toSREIssueView(issueInfoWire(iss)))
		}
		mcprpc.WriteToolText(w, req.ID, mcprpc.MustJSON(out))
	case "create_issue":
		if args.ActionStatuses == nil {
			mcprpc.WriteToolError(w, req.ID, "missing required argument: actionStatuses")
			return
		}
		for _, status := range args.ActionStatuses {
			if status != nil && *status != "revised" && *status != "suggested" {
				mcprpc.WriteToolError(w, req.ID, fmt.Sprintf("actionStatuses: %q is not one of revised, suggested or null", *status))
				return
			}
		}
		issue, err := issues.CreateIssue(r.Context(), org, args.Project, sourcecontrol.CreateIssueRequest{
			Title:          args.Title,
			Body:           args.Body,
			Labels:         withSREHandoffLabels(args.Labels),
			ComponentName:  args.ComponentName,
			ActionStatuses: args.ActionStatuses,
		})
		if err != nil {
			mcprpc.WriteToolError(w, req.ID, createIssueFailure(err))
			return
		}
		mcprpc.WriteToolText(w, req.ID, mcprpc.MustJSON(issueResultWire(issue)))
	default:
		mcprpc.WriteToolError(w, req.ID, "unknown tool: "+call.Name)
	}
}

// withSREHandoffLabels appends the handoff labels the caller left out.
func withSREHandoffLabels(labels []string) []string {
	out := append([]string(nil), labels...)
	for _, label := range sreHandoffLabels {
		if !containsLabel(out, label) {
			out = append(out, label)
		}
	}
	return out
}

func containsLabel(labels []string, want string) bool {
	for _, label := range labels {
		if strings.EqualFold(strings.TrimSpace(label), want) {
			return true
		}
	}
	return false
}

// sreIssueView is one search hit as the agent reads it: the REST list shape,
// plus PlatformRecord and ReadAs on the platform's own plan issues.
type sreIssueView struct {
	gen.IssueInfo
	PlatformRecord bool   `json:"PlatformRecord,omitempty"`
	ReadAs         string `json:"ReadAs,omitempty"`
}

func toSREIssueView(info gen.IssueInfo) sreIssueView {
	view := sreIssueView{IssueInfo: info}
	if isPlatformPlan(info.Labels) {
		view.PlatformRecord = true
		view.ReadAs = platformIssueNote
	}
	return view
}

func isPlatformPlan(labels []string) bool {
	if !containsLabel(labels, platformWorkLabel) || !containsLabel(labels, platformPlanKind) {
		return false
	}
	for _, kind := range kindsOutrankingPlan {
		if containsLabel(labels, kind) {
			return false
		}
	}
	return true
}

// createIssueFailure is the tool error the agent reads for a failed create:
// the same status and message the REST create answers.
func createIssueFailure(err error) string {
	switch {
	case errors.Is(err, sourcecontrol.ErrIncidentContextRequired):
		return "aep-api 400: " + err.Error()
	case errors.Is(err, sourcecontrol.ErrIncidentRecurrenceIneligible):
		return "aep-api 409: " + err.Error()
	case errors.Is(err, sourcecontrol.ErrRepoNotFound):
		return "aep-api 404: project repo not found"
	default:
		slog.Error("sre handoff: create issue failed", "error", err)
		return "aep-api 500: failed to create issue"
	}
}

func listIssuesFailure(err error) string {
	if errors.Is(err, sourcecontrol.ErrRepoNotFound) {
		return "aep-api 404: project repo not found"
	}
	slog.Error("sre handoff: list issues failed", "error", err)
	return "aep-api 500: failed to list issues"
}
