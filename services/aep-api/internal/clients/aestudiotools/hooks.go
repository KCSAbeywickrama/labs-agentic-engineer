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

// hooks.go — the repository webhook the platform registers (WebhookOps keyed
// by RepoRef). The pod signs it with the org's hook secret and points it at
// its own relay URL, so aep-api sends only the events.

import (
	"context"
	"fmt"
	"net/http"

	"github.com/wso2/aep/aep-api/internal/clients/aestudiotools/gen"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// hookEventNames are the only events the platform's hook carries (the pod's
// enum): anything else is refused before a request leaves.
var hookEventNames = map[string]gen.HookEventsRequestEvents{
	"pull_request":  gen.HookEventsRequestEventsPullRequest,
	"push":          gen.HookEventsRequestEventsPush,
	"issue_comment": gen.HookEventsRequestEventsIssueComment,
	"issues":        gen.HookEventsRequestEventsIssues,
}

func hookEvents(events []string) (gen.HookEventsRequest, error) {
	req := gen.HookEventsRequest{Events: make([]gen.HookEventsRequestEvents, 0, len(events))}
	for _, e := range events {
		v, ok := hookEventNames[e]
		if !ok {
			return gen.HookEventsRequest{}, fmt.Errorf("ae studio: hook event %q is not one the platform subscribes to", e)
		}
		req.Events = append(req.Events, v)
	}
	return req, nil
}

// RegisterWebhook ensures the platform's hook on ref carries the pod's
// config and events: storedID's hook reconfigured in place (re-created when
// GitHub lost it), else one created or the hook to the pod's URL
// reconfigured. It answers the hook's id and the pod's config rev.
func (a *Adapter) RegisterWebhook(ctx context.Context, ref RepoRef, storedID int64, events []string) (sourcecontrol.EnsuredHook, error) {
	if err := validRef(ref); err != nil {
		return sourcecontrol.EnsuredHook{}, err
	}
	body, err := hookEvents(events)
	if err != nil {
		return sourcecontrol.EnsuredHook{}, err
	}
	if storedID > 0 {
		body.HookID = storedID
	}
	var reply gen.Hook
	err = a.do(ctx, ref.Org, "register-hook", &reply, func(ctx context.Context, c *gen.Client, org string, auth gen.RequestEditorFn) (*http.Response, error) {
		return c.RegisterHook(ctx, ref.Owner, ref.Repo, &gen.RegisterHookParams{XImpersonateOrg: org}, body, auth)
	})
	return sourcecontrol.EnsuredHook{ID: reply.ID, ConfigRev: reply.ConfigRev}, err
}

// HookConfigRev answers the rev of the config the org's pod installs on
// every hook it ensures.
func (a *Adapter) HookConfigRev(ctx context.Context, org string) (string, error) {
	var reply gen.HookConfig
	err := a.do(ctx, org, "get-hook-config", &reply, func(ctx context.Context, c *gen.Client, impersonateOrg string, auth gen.RequestEditorFn) (*http.Response, error) {
		return c.GetHookConfig(ctx, &gen.GetHookConfigParams{XImpersonateOrg: impersonateOrg}, auth)
	})
	return reply.ConfigRev, err
}

// DeleteWebhook removes the hook; one already gone is success.
func (a *Adapter) DeleteWebhook(ctx context.Context, ref RepoRef, hookID int64) error {
	if err := validRef(ref); err != nil {
		return err
	}
	return a.do(ctx, ref.Org, "delete-hook", nil, func(ctx context.Context, c *gen.Client, org string, auth gen.RequestEditorFn) (*http.Response, error) {
		return c.DeleteHook(ctx, ref.Owner, ref.Repo, hookID, &gen.DeleteHookParams{XImpersonateOrg: org}, auth)
	})
}
