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

package edge

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/wso2/aep/ae-studio-tools/internal/gen"
	"github.com/wso2/aep/ae-studio-tools/internal/turns"
)

// DELETE /internal/v1/repos/{owner}/{repo}/issues/{number}/thread
// (remove-issue-thread): aep-api removes the chat thread of an issue it saw
// closed or reopened, relayed to ae-design-agent over the Turn socket, which
// keeps the threads.

// ThreadRemover removes an issue's chat threads in the agent (turns.Client).
type ThreadRemover interface {
	RemoveIssueThread(ctx context.Context, project string, number int, before time.Time) error
}

// RemoveIssueThread checks that the project is this repository's, as
// start-repo-turn does (404 project_unknown otherwise), then asks the agent
// to remove the issue's threads created before the query's time. The agent
// unreachable is 503 agent_unavailable; any other failure is logged and a
// 503 too: the caller retries a removal it could not land.
func (s internalServer) RemoveIssueThread(ctx context.Context, req gen.RemoveIssueThreadRequestObject) (gen.RemoveIssueThreadResponseObject, error) {
	rep, err := s.projects.Resolve(ctx, req.Params.Project)
	if err != nil {
		return filesProblem(ctx, "remove-issue-thread", req.Params.Project, err), nil
	}
	if !strings.EqualFold(rep.Owner, req.Owner) || !strings.EqualFold(rep.Repo, req.Repo) {
		return gen.RemoveIssueThread404ApplicationProblemPlusJSONResponse(
			newProblem(http.StatusNotFound, "project_unknown", "the project is not this repository's")), nil
	}
	if err := s.threads.RemoveIssueThread(ctx, req.Params.Project, req.Number, req.Params.Before); err != nil {
		code := "internal_error"
		if errors.Is(err, turns.ErrSocketUnavailable) {
			code = "agent_unavailable"
		}
		slog.WarnContext(ctx, "remove_issue_thread.failed", "project", req.Params.Project, "issue", req.Number, "error", err)
		return gen.RemoveIssueThread503ApplicationProblemPlusJSONResponse(
			newProblem(http.StatusServiceUnavailable, code, "the design agent could not remove the thread")), nil
	}
	return gen.RemoveIssueThread204Response{}, nil
}

// VisitRemoveIssueThreadResponse lets a Files problem (the project
// resolution's error map) answer remove-issue-thread.
func (p problemResponse) VisitRemoveIssueThreadResponse(w http.ResponseWriter) error {
	return p.write(w)
}
