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

package projects

import (
	"context"
	"errors"
	"log/slog"
	"net/url"
	"strings"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/organization"
)

// SetAgentRecordNamer wires the name an agent is registered under in Agent
// Manager (agentgovernance.AgentRecordName), which the Deployments page links
// to. Injected rather than imported: the name is the delivery domain's to
// compute, and a second copy here would drift into links that open nothing.
// Nil — an install with no Agent Manager — leaves every row without a link.
func (s *componentService) SetAgentRecordNamer(name func(project, component string) string) {
	s.agentRecordName = name
}

// withAgentManagerLinks fills AgentManagerURL on each row whose agent Agent
// Manager governs in that row's environment.
//
// Governed means what it means for model access (ampModelAccess): the
// environment has an AI gateway binding AND the agent's own Agent Manager key is
// stored, which is what the govern stage leaves once it has registered the
// agent. The key doubles as the component-type test — only an ai-agent is ever
// given one — so a service's rows cost one lookup that answers "no".
//
// Best effort: a lookup that fails leaves the row without a link and the list
// intact. A missing link is a small loss; a Deployments page that fails because
// Agent Manager is unreachable is not.
func (s *componentService) withAgentManagerLinks(ctx context.Context, orgName, projectName, componentName string, list *gen.DeploymentList) {
	if list == nil || s.agentRecordName == nil || s.aiGatewayBindings == nil || s.secretRefClient == nil {
		return
	}
	for i := range list.Items {
		row := &list.Items[i]
		if link, ok := s.agentManagerLink(ctx, orgName, projectName, componentName, row.Environment); ok {
			row.AgentManagerURL = link
		}
	}
}

func (s *componentService) agentManagerLink(ctx context.Context, orgName, projectName, componentName, environment string) (string, bool) {
	if strings.TrimSpace(environment) == "" {
		return "", false
	}
	// The key first: it is absent for every non-agent component, so most rows
	// stop here without reading the environment at all.
	if _, err := s.secretRefClient.GetSecretReference(ctx, orgName, organization.AMPModelKeySecretRefName(componentName, environment)); err != nil {
		return "", false
	}
	binding, err := s.aiGatewayBindings.GetAIGatewayBinding(ctx, orgName, environment)
	if err != nil {
		if !errors.Is(err, openchoreo.ErrNoAIGatewayBinding) {
			slog.WarnContext(ctx, "deployments: could not read the AI gateway binding; no Agent Manager link",
				"org", orgName, "environment", environment, "component", componentName, "error", err)
		}
		return "", false
	}
	if binding.ConsoleURL == "" {
		return "", false
	}
	return binding.ConsoleURL +
		"/org/" + url.PathEscape(orgName) +
		"/project/" + url.PathEscape(projectName) +
		"/agents/" + url.PathEscape(s.agentRecordName(projectName, componentName)), true
}
