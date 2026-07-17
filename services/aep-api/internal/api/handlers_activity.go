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

package api

import (
	"context"
	"net/http"
	"time"

	"github.com/wso2/aep/aep-api/internal/api/apigen"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
	"github.com/wso2/aep/aep-api/models"
)

// ListActivity serves GET /projects/{projectName}/activity: a project's
// activity feed, newest first, cursor-paginated. The body is the feature's own
// view (models.ActivityEvent marshaled verbatim) via a hand-written Visit —
// same escape hatch as ListTasks (handlers_task.go), so optional fields stay
// clean on the wire.
func (s *apiServer) ListActivity(ctx context.Context, request apigen.ListActivityRequestObject) (apigen.ListActivityResponseObject, error) {
	if s.deps.ActivitySvc == nil {
		return nil, errServiceUnavailable("activity not configured")
	}
	org := tenant.BoundOrgFromContext(ctx)

	limit := int(request.Params.Limit)

	var beforeTime time.Time
	var beforeID string
	if request.Params.Before != "" {
		if t, err := time.Parse(time.RFC3339Nano, request.Params.Before); err == nil {
			beforeTime = t
			beforeID = request.Params.BeforeID
		}
	}

	rows, err := s.deps.ActivitySvc.List(ctx, org, request.ProjectName, limit, beforeTime, beforeID)
	if err != nil {
		return nil, errInternal("failed to load activity")
	}
	return activityFeedResponse(rows), nil
}

// listActivityJSONResponse is the feed body + next-page cursor, marshaled
// verbatim (models.ActivityEvent json tags already match the contract).
type listActivityJSONResponse struct {
	Items        []models.ActivityEvent `json:"items"`
	NextBefore   string                 `json:"nextBefore,omitempty"`
	NextBeforeID string                 `json:"nextBeforeId,omitempty"`
}

// activityFeedResponse sets the next-page cursor to the oldest row returned
// (rows are newest-first, so that is the last element).
func activityFeedResponse(rows []models.ActivityEvent) listActivityJSONResponse {
	out := listActivityJSONResponse{Items: rows}
	if n := len(rows); n > 0 {
		last := rows[n-1]
		out.NextBefore = last.OccurredAt.UTC().Format(time.RFC3339Nano)
		out.NextBeforeID = last.ID
	}
	return out
}

func (r listActivityJSONResponse) VisitListActivityResponse(w http.ResponseWriter) error {
	return writeJSONBody(w, http.StatusOK, r)
}
