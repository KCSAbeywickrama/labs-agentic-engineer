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

package openchoreo

// workflow_run_logs.go — a build's log, read live from OpenChoreo.
//
// OpenChoreo serves a WorkflowRun's log from the Argo pods on the workflow
// plane for as long as the run exists. Argo's pod GC is not configured, so the
// pods — and their logs — last until the run's ttlAfterCompletion deletes the
// run and its Argo workflow. That makes the live log the build's whole log for
// exactly the time OpenChoreo keeps the build.

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	ocgen "github.com/wso2/aep/aep-api/internal/clients/openchoreo/gen"
)

// WorkflowRunLogLine is one line of a build's log. Timestamp is the kubelet's,
// at full precision; zero when OpenChoreo sent none.
type WorkflowRunLogLine struct {
	Timestamp time.Time
	Log       string
}

func (c *componentClient) GetWorkflowRunLogs(ctx context.Context, orgName, runName string, sinceSeconds int64) ([]WorkflowRunLogLine, error) {
	params := &ocgen.GetWorkflowRunLogsParams{}
	if sinceSeconds > 0 {
		params.SinceSeconds = &sinceSeconds
	}
	resp, err := c.oc.GetWorkflowRunLogsWithResponse(ctx, orgName, runName, params)
	if err != nil {
		return nil, fmt.Errorf("get workflow run logs: %w", err)
	}
	if resp.StatusCode() != http.StatusOK || resp.JSON200 == nil {
		return nil, handleErrorResponse(resp.StatusCode(), ErrorResponses{
			JSON400: resp.JSON400,
			JSON403: resp.JSON403,
			JSON404: resp.JSON404,
			JSON500: resp.JSON500,
		})
	}
	out := make([]WorkflowRunLogLine, 0, len(*resp.JSON200))
	for _, e := range *resp.JSON200 {
		out = append(out, logLineOf(e))
	}
	// OpenChoreo concatenates pod by pod in list order, which is name order,
	// not the order the steps ran in. Stable, so lines that share a timestamp
	// keep the order the container wrote them.
	sort.SliceStable(out, func(i, j int) bool { return out[i].Timestamp.Before(out[j].Timestamp) })
	return out, nil
}

// logLineOf maps one OpenChoreo entry. OpenChoreo splits each kubelet line
// "<timestamp> <message>" on its first space, so an EMPTY line the container
// wrote — the kubelet line is then the timestamp alone — comes back untimed,
// with the timestamp as its text. It is put back as what it is: an empty line
// at that time, which a cursor can order.
func logLineOf(e ocgen.WorkflowRunLogEntry) WorkflowRunLogLine {
	if e.Timestamp != nil {
		return WorkflowRunLogLine{Timestamp: *e.Timestamp, Log: e.Log}
	}
	if t, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(e.Log)); err == nil {
		return WorkflowRunLogLine{Timestamp: t}
	}
	return WorkflowRunLogLine{Log: e.Log}
}

func (c *componentClient) ClusterWorkflowTTL(ctx context.Context, name string) (time.Duration, error) {
	resp, err := c.oc.GetClusterWorkflowWithResponse(ctx, name)
	if err != nil {
		return 0, fmt.Errorf("get cluster workflow: %w", err)
	}
	if resp.StatusCode() != http.StatusOK || resp.JSON200 == nil {
		return 0, handleErrorResponse(resp.StatusCode(), ErrorResponses{
			JSON401: resp.JSON401,
			JSON403: resp.JSON403,
			JSON404: resp.JSON404,
			JSON500: resp.JSON500,
		})
	}
	spec := resp.JSON200.Spec
	if spec == nil || spec.TtlAfterCompletion == nil || *spec.TtlAfterCompletion == "" {
		return 0, nil
	}
	return parseOCDuration(*spec.TtlAfterCompletion)
}

// ocDurationDays matches OpenChoreo's duration grammar, Go's plus a leading
// day count ("1d", "10d1h30m"), which time.ParseDuration does not accept.
var ocDurationDays = regexp.MustCompile(`^(\d+)d(.*)$`)

func parseOCDuration(s string) (time.Duration, error) {
	var days time.Duration
	if m := ocDurationDays.FindStringSubmatch(s); m != nil {
		n, err := strconv.Atoi(m[1])
		if err != nil {
			return 0, fmt.Errorf("openchoreo duration %q: %w", s, err)
		}
		days = time.Duration(n) * 24 * time.Hour
		s = m[2]
	}
	if s == "" {
		return days, nil
	}
	rest, err := time.ParseDuration(s)
	if err != nil {
		return 0, fmt.Errorf("openchoreo duration: %w", err)
	}
	return days + rest, nil
}
