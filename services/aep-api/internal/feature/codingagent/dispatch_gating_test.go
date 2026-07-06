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

// Package codingagent — 3-way dispatch gating unit tests.
//
// These tests assert the gating invariants:
//   - Same-project component dependencies gate dispatch until the sibling task
//     reaches `deployed`.
//   - External-resource dependencies gate dispatch until the config-collection
//     task reaches `deployed`.
//   - Platform-resource dependencies gate dispatch until the resource-
//     provisioning task reaches `deployed`.
//   - Org-service (cross-project) dependencies do NOT gate dispatch;
//     block-at-proceed already guarantees a consumer cannot be dispatched while
//     an org-service dep is unresolved.
//   - Unknown names in any list fail closed.
package codingagent

import (
	"testing"

	"github.com/wso2/aep/aep-api/models"
)

// makeGateTask builds a component task with the four dependency lists.
func makeGateTask(name string, comps, extRes, orgSvc, res []string) *models.ComponentTask {
	return &models.ComponentTask{
		ComponentName:              name,
		DependsOnComponents:        models.StringSlice(comps),
		DependsOnExternalResources: models.StringSlice(extRes),
		DependsOnOrgServices:       models.StringSlice(orgSvc),
		DependsOnResources:         models.StringSlice(res),
	}
}

func TestDepsAllDeployed_NoDeps(t *testing.T) {
	if !depsAllDeployed(makeGateTask("frontend", nil, nil, nil, nil), nil, nil, nil) {
		t.Fatal("want true for a task with no deps, got false")
	}
}

func TestDepsAllDeployed_ComponentDepGating(t *testing.T) {
	deployed := string(models.TaskStatusDeployed)
	pending := string(models.TaskStatusPending)
	task := makeGateTask("frontend", []string{"backend-api"}, nil, nil, nil)

	if !depsAllDeployed(task, map[string]string{"backend-api": deployed}, nil, nil) {
		t.Fatal("want true when component dep is deployed")
	}
	if depsAllDeployed(task, map[string]string{"backend-api": pending}, nil, nil) {
		t.Fatal("want false when component dep is pending")
	}
	// Unknown component name → fail closed.
	if depsAllDeployed(task, map[string]string{}, nil, nil) {
		t.Fatal("want false for unknown component dep (fail-closed)")
	}
}

func TestDepsAllDeployed_ExternalResourceDepGating(t *testing.T) {
	deployed := string(models.TaskStatusDeployed)
	task := makeGateTask("worker", nil, []string{"stripe"}, nil, nil)

	if !depsAllDeployed(task, nil, map[string]string{"stripe": deployed}, nil) {
		t.Fatal("want true when external-resource dep is deployed")
	}
	if depsAllDeployed(task, nil, map[string]string{"stripe": string(models.TaskStatusPending)}, nil) {
		t.Fatal("want false when external-resource dep is not deployed")
	}
	// Unknown external-resource name → fail closed.
	if depsAllDeployed(task, nil, map[string]string{}, nil) {
		t.Fatal("want false for unknown external-resource dep (fail-closed)")
	}
}

func TestDepsAllDeployed_ResourceDepGating(t *testing.T) {
	task := makeGateTask("api", nil, nil, nil, []string{"maindb"})

	if depsAllDeployed(task, nil, nil, map[string]string{"maindb": string(models.TaskStatusBuilding)}) {
		t.Fatal("want false while the platform resource is still provisioning")
	}
	if !depsAllDeployed(task, nil, nil, map[string]string{"maindb": string(models.TaskStatusDeployed)}) {
		t.Fatal("want true when the platform resource is deployed")
	}
	// Unknown resource name → fail closed.
	if depsAllDeployed(task, nil, nil, map[string]string{}) {
		t.Fatal("want false for unknown platform-resource dep (fail-closed)")
	}
}

// TestDepsAllDeployed_OrgServiceDepDoesNotGate: a consumer task listing a
// DependsOnOrgServices entry must be immediately dispatchable — block-at-proceed
// already guarantees pre-resolution, so the org-service dep no longer gates.
func TestDepsAllDeployed_OrgServiceDepDoesNotGate(t *testing.T) {
	task := makeGateTask("consumer", nil, nil, []string{"payment-service"}, nil)
	// All maps empty — there is no "payment-service" entry anywhere.
	if !depsAllDeployed(task, map[string]string{}, map[string]string{}, map[string]string{}) {
		t.Fatal("org-service dep must NOT gate dispatch; want true, got false")
	}
}

// TestDepsAllDeployed_MixedAllKinds: a consumer with component + external-resource
// + platform-resource + org-service deps dispatches only when the first three are
// deployed; the org-service is ignored.
func TestDepsAllDeployed_MixedAllKinds(t *testing.T) {
	deployed := string(models.TaskStatusDeployed)
	task := makeGateTask("consumer",
		[]string{"backend"}, []string{"postgres"}, []string{"payment-service"}, []string{"maindb"})

	byComp := map[string]string{"backend": deployed}
	byExt := map[string]string{"postgres": deployed}
	byRes := map[string]string{"maindb": deployed}
	if !depsAllDeployed(task, byComp, byExt, byRes) {
		t.Fatal("want true when component + external-resource + platform-resource deps deployed")
	}
	// Flip the platform resource to not-ready → held.
	if depsAllDeployed(task, byComp, byExt, map[string]string{"maindb": string(models.TaskStatusInProgress)}) {
		t.Fatal("want false when the platform-resource dep is not deployed")
	}
}
