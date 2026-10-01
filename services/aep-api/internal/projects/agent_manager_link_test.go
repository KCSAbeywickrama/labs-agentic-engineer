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
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
	"github.com/wso2/aep/aep-api/internal/clients/secretmanagersvc"
	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/organization"
)

// consoleBindings is a governed environment that names its Agent Manager console.
type consoleBindings struct{ console string }

func (b consoleBindings) GetAIGatewayBinding(_ context.Context, org, env string) (openchoreo.AIGatewayBinding, error) {
	return openchoreo.AIGatewayBinding{
		OrgID: org, Environment: env,
		Endpoint: "http://ai-gateway.amp.localhost:8084", AdminURL: "http://api.amp.localhost:8080/api/v1", GatewayID: "gw-uuid",
		ConsoleURL: b.console,
	}, nil
}

func deploymentsOf(envs ...string) *ocmocks.ComponentClientMock {
	return &ocmocks.ComponentClientMock{
		ListDeploymentsFunc: func(_ context.Context, _, _, component string) (*gen.DeploymentList, error) {
			items := make([]gen.Deployment, len(envs))
			for i, env := range envs {
				items[i] = gen.Deployment{ComponentName: component, Environment: env}
			}
			return &gen.DeploymentList{Items: items}, nil
		},
	}
}

func agentLinkService(client openchoreo.ComponentClient, bindings AIGatewayBindingReader, refs secretmanagersvc.OpenChoreoSecretReferenceClient) *componentService {
	svc := NewComponentService(client, nil, modelAccessStore(nil), nil, nil, fakeKeyResolver{}, refs).(*componentService)
	svc.SetAIGatewayBindings(bindings)
	svc.SetAgentRecordNamer(func(_, component string) string { return component + "-rec" })
	return svc
}

// A governed agent's row links to its page in the environment's Agent Manager.
func TestListDeployments_GovernedAgentLinksToAgentManager(t *testing.T) {
	refs := &presentSecretRefClient{}
	svc := agentLinkService(deploymentsOf(testWriteTarget), consoleBindings{console: "http://console.amp.localhost:8080"}, refs)

	list, err := svc.ListDeployments(context.Background(), "acme", "shop", "checkout-agent")
	if err != nil {
		t.Fatalf("ListDeployments: %v", err)
	}
	want := "http://console.amp.localhost:8080/org/acme/project/shop/agents/checkout-agent-rec"
	if got := list.Items[0].AgentManagerURL; got != want {
		t.Errorf("AgentManagerURL = %q, want %q", got, want)
	}
	wantRef := organization.AMPModelKeySecretRefName("checkout-agent", testWriteTarget)
	if len(refs.askedFor) == 0 || refs.askedFor[0] != wantRef {
		t.Errorf("governed check must look up the agent's own AMP key for the row's environment (%q), asked for %v", wantRef, refs.askedFor)
	}
}

// No stored Agent Manager key means the agent is not registered there, or the
// component is not an agent at all: no link.
func TestListDeployments_NoStoredKeyNoLink(t *testing.T) {
	svc := agentLinkService(deploymentsOf(testWriteTarget), consoleBindings{console: "http://console.amp.localhost:8080"}, fakeSecretRefClient{})

	list, err := svc.ListDeployments(context.Background(), "acme", "shop", "orders-api")
	if err != nil {
		t.Fatalf("ListDeployments: %v", err)
	}
	if got := list.Items[0].AgentManagerURL; got != "" {
		t.Errorf("AgentManagerURL = %q, want none for a component with no Agent Manager key", got)
	}
}

// A governed environment that names no console gets no link.
func TestListDeployments_NoConsoleURLNoLink(t *testing.T) {
	svc := agentLinkService(deploymentsOf(testWriteTarget), consoleBindings{}, &presentSecretRefClient{})

	list, err := svc.ListDeployments(context.Background(), "acme", "shop", "checkout-agent")
	if err != nil {
		t.Fatalf("ListDeployments: %v", err)
	}
	if got := list.Items[0].AgentManagerURL; got != "" {
		t.Errorf("AgentManagerURL = %q, want none when the binding names no console", got)
	}
}

// An ungoverned environment gets no link, and the list itself still succeeds.
func TestListDeployments_UngovernedNoLink(t *testing.T) {
	svc := agentLinkService(deploymentsOf(testWriteTarget), fakeAIGatewayBindings{err: openchoreo.ErrNoAIGatewayBinding}, &presentSecretRefClient{})

	list, err := svc.ListDeployments(context.Background(), "acme", "shop", "checkout-agent")
	if err != nil {
		t.Fatalf("ListDeployments must not fail on an ungoverned environment: %v", err)
	}
	if got := list.Items[0].AgentManagerURL; got != "" {
		t.Errorf("AgentManagerURL = %q, want none", got)
	}
}

// Without a namer wired (an install with no Agent Manager), rows carry no link.
func TestListDeployments_NoNamerNoLink(t *testing.T) {
	svc := NewComponentService(deploymentsOf(testWriteTarget), nil, modelAccessStore(nil), nil, nil, fakeKeyResolver{}, &presentSecretRefClient{}).(*componentService)
	svc.SetAIGatewayBindings(consoleBindings{console: "http://console.amp.localhost:8080"})

	list, err := svc.ListDeployments(context.Background(), "acme", "shop", "checkout-agent")
	if err != nil {
		t.Fatalf("ListDeployments: %v", err)
	}
	if got := list.Items[0].AgentManagerURL; got != "" {
		t.Errorf("AgentManagerURL = %q, want none without a namer", got)
	}
}
