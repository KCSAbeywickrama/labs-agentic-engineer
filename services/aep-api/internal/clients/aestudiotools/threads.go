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

package aestudiotools

// threads.go — remove-issue-thread: remove a closed or reopened issue's chat
// thread in the org's pod, where the design agent keeps the threads.

import (
	"context"
	"net/http"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/aestudiotools/gen"
)

// RemoveIssueThread asks the pod to remove the chat threads of issue number of
// project (the project ref is the repository of) created before before. The
// pod removes a thread whose turn is running when that turn ends; an issue
// with no thread is success. The pod unreachable is ErrAEStudioUnavailable,
// which a caller retries.
func (a *Adapter) RemoveIssueThread(ctx context.Context, ref RepoRef, project string, number int, before time.Time) error {
	if err := validRef(ref); err != nil {
		return err
	}
	return a.do(ctx, ref.Org, "remove-issue-thread", nil, func(ctx context.Context, c *gen.Client, org string, auth gen.RequestEditorFn) (*http.Response, error) {
		return c.RemoveIssueThread(ctx, ref.Owner, ref.Repo, number, &gen.RemoveIssueThreadParams{Project: project, Before: before, XImpersonateOrg: org}, auth)
	})
}
