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

package observability

// client.go — the OpenChoreo Observer's log query.
//
// `POST /api/v1/logs/query` with a COMPONENT scope (namespace + project +
// environment, and optionally one component) is how a finished coding cycle's
// pod lines are read back — see cycle_logs.go for how its paging works on an
// API with no cursor. Build logs are not read here: they are read live from
// OpenChoreo for as long as OpenChoreo keeps the build.
//
// This is telemetry, not a log system of record: the observer's retention is
// the dataplane's, not ours.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/wso2/aep/aep-api/internal/platform/auth"
)

// queryPageLimit is the observer's own per-query cap (a larger limit is a 400),
// so a page this long is the "there may be another page" signal.
const queryPageLimit = 1000

// Client reads logs from the observability plane.
type Client interface {
	// QueryCycleLogs reads one coding cycle's pod lines across the cycle's
	// window: every line the Component with q.ComponentUID wrote, each once, in
	// index order. It reads the Component scope while the Component exists
	// and the project scope after it is deleted (q.Component == "").
	QueryCycleLogs(ctx context.Context, q CycleLogQuery) ([]LogLine, CycleLogStats, error)
}

// CycleLogStats describes how a cycle read went, for the caller's log and its
// completeness signal.
type CycleLogStats struct {
	// Pages is the number of observer requests the read made.
	Pages int
	// LinesMissing reports that the window holds lines the read could not
	// return: the page cap was hit, or one second held more lines (or more
	// identical lines) than two pages can tell apart.
	LinesMissing bool
}

// CycleLogQuery scopes one cycle's read. Namespace is the OpenChoreo namespace
// (the org handle).
type CycleLogQuery struct {
	Namespace, Project, Environment string
	// Component is the SCOPED component name. Empty reads the project scope:
	// the only scope that still answers once the Component is deleted, since
	// the observer resolves a component NAME to its UID on every query.
	Component string
	// ComponentUID is required. Lines whose metadata.componentUid differs are
	// dropped: other Components on a project read, and a later Component that
	// reuses the name (a new UID) on either read.
	ComponentUID string
	// From and To bound the read and are sent as given (the observer allows
	// at most 30 days). Both are exclusive at the observer, to the second.
	From, To time.Time
}

// LogLine is one indexed pod line. Timestamp is the observer's, to the SECOND:
// it orders lines across seconds, never within one.
type LogLine struct {
	Timestamp    time.Time
	Log          string
	ComponentUID string
	PodName      string
}

type observabilityClient struct {
	baseURL    string
	httpClient *http.Client
}

// NewClient creates a new observability client. baseURL is the observer's base
// URL (e.g. https://observer.obs.dp.example.com), with any path prefix it is
// served under; a trailing slash is dropped so the join never reads `//api/…`.
func NewClient(baseURL string) Client {
	return &observabilityClient{
		baseURL:    strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// componentScope is the request's `searchScope` for a component's (or a
// project's) pod lines. The observer's other shape, a workflow scope, is
// deliberately absent: it REJECTS a body that mixes workflowRunName with
// component fields, so the two never share a struct.
type componentScope struct {
	Namespace   string `json:"namespace"`
	Project     string `json:"project,omitempty"`
	Component   string `json:"component,omitempty"`
	Environment string `json:"environment,omitempty"`
}

type logsQueryRequest struct {
	SearchScope  any    `json:"searchScope"`
	StartTime    string `json:"startTime"`
	EndTime      string `json:"endTime"`
	Limit        int    `json:"limit,omitempty"`
	SortOrder    string `json:"sortOrder,omitempty"`
	SearchPhrase string `json:"searchPhrase,omitempty"`
}

type logsQueryEntry struct {
	Timestamp string `json:"timestamp"`
	Log       string `json:"log"`
	Level     string `json:"level"`
	// Metadata is present on component-scope entries only.
	Metadata *logsQueryMetadata `json:"metadata,omitempty"`
}

type logsQueryMetadata struct {
	ComponentUID string `json:"componentUid"`
	PodName      string `json:"podName"`
}

type logsQueryResponse struct {
	Logs []logsQueryEntry `json:"logs"`
	// Total is the observer's field name. `totalCount` is accepted too because
	// the OpenChoreo CLI's own client still spells it that way, and a body that
	// carries only the older name must not read as zero results.
	Total      *int `json:"total,omitempty"`
	TotalCount *int `json:"totalCount,omitempty"`
}

// total is the match count of the request's window, when the body carries one.
func (r *logsQueryResponse) total() (int, bool) {
	switch {
	case r.Total != nil:
		return *r.Total, true
	case r.TotalCount != nil:
		return *r.TotalCount, true
	}
	return 0, false
}

// query issues one POST /api/v1/logs/query. The caller's bearer is forwarded:
// the observer authorizes on the OpenChoreo identity, so an archive read is
// scoped to whoever asked for it.
func (c *observabilityClient) query(ctx context.Context, body logsQueryRequest) (*logsQueryResponse, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("observability: marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/v1/logs/query", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("observability: create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token := auth.GetAuthToken(ctx); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("observability: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("observability: unexpected status %d", resp.StatusCode)
	}
	var out logsQueryResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("observability: decode response: %w", err)
	}
	return &out, nil
}
