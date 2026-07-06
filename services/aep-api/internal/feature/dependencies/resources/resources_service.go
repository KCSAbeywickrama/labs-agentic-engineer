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

package resources

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/wso2/aep/aep-api/internal/contracts"
	"github.com/wso2/aep/aep-api/models"
)

// ResourceService handles the async provision flow for platform-resource
// dependencies:
//  1. Reads the component's design to find the dep's resourceType.
//  2. Calls the ResourceProvisioner to author the OC Resource model.
//  3. Marks the resource-provisioning task in-flight by applying the
//     contracts TaskEventProvisionStarted event (pending → building) through
//     the TaskCompleter (the task Projector) — NEVER a direct status write.
//     It does NOT wait for readiness — the resource watcher observes that.
//     It does NOT redispatch — the watcher cascades on readiness.
type ResourceService struct {
	design    DesignReader
	prov      ResourceProvisioner
	tasks     TaskStore
	completer TaskCompleter
}

// NewResourceService wires the platform-resource provision flow. completer is
// the task Projector (or a test double with the same ApplyBuildResult shape).
func NewResourceService(design DesignReader, prov ResourceProvisioner, tasks TaskStore, completer TaskCompleter) *ResourceService {
	return &ResourceService{design: design, prov: prov, tasks: tasks, completer: completer}
}

// Provision authors the OC Resource model for `depName` on `componentName`
// and moves the matching resource-provisioning task pending→building. It is
// intentionally async: it returns as soon as the OC CRs are authored and the
// task is marked in-flight, without waiting for the binding's Ready condition.
//
// SINGLE-PARAMS-MAP NOTE: the ResourceProvisioner signature takes a single
// params map applied to all envs. This flow therefore accepts one unified
// params map (not per-env params). If per-env params are needed in the
// future, the provisioner signature must grow — a documented limitation.
func (s *ResourceService) Provision(
	ctx context.Context,
	orgHandle, projectName, componentName, depName string,
	params map[string]string,
	envs []string,
) error {
	// 1. Read the design and find the platform-resource dep.
	resourceType, err := s.findPlatformResourceType(ctx, orgHandle, projectName, componentName, depName)
	if err != nil {
		return err
	}

	// 2. Call the provisioner (async — authors OC CRs and returns immediately).
	if _, err := s.prov.Provision(ctx, orgHandle, projectName, depName, resourceType, params, envs); err != nil {
		return fmt.Errorf("%w: %w", ErrProvisionFailed, err)
	}

	// 3. Move the resource-provisioning task pending→building (the in-flight
	// marker the watcher sweeps) via the contracts transition. Best-effort:
	// provisioning already succeeded.
	if err := s.markProvisionStarted(ctx, orgHandle, projectName, depName); err != nil {
		slog.WarnContext(ctx, "resources: failed to mark resource-provisioning task building",
			"dep", depName, "project", projectName, "error", err)
	}

	return nil
}

// ResolvePlatformDep applies the kind policy for a component-level
// platform-resource route without provisioning anything: unknown dep (or
// component, or design) ⇒ ErrDepNotFound; dep of another kind ⇒
// ErrDepWrongKind. Used by the status endpoint.
func (s *ResourceService) ResolvePlatformDep(ctx context.Context, orgHandle, projectName, componentName, depName string) error {
	_, err := s.findPlatformResourceType(ctx, orgHandle, projectName, componentName, depName)
	return err
}

// findPlatformResourceType walks the design components to find a
// platform-resource dep named depName on componentName and returns its
// resourceType.
func (s *ResourceService) findPlatformResourceType(ctx context.Context, orgHandle, projectName, componentName, depName string) (string, error) {
	comps, err := s.design.ReadDesignComponents(ctx, orgHandle, projectName)
	if err != nil {
		return "", fmt.Errorf("resources: read design: %w", err)
	}
	if len(comps) == 0 {
		return "", fmt.Errorf("%w: no design components found for project %q", ErrDepNotFound, projectName)
	}
	for _, comp := range comps {
		if comp.Name != componentName {
			continue
		}
		for _, dep := range comp.Dependencies {
			if dep.Name != depName {
				continue
			}
			if dep.Kind != models.DependencyKindPlatformResource {
				return "", fmt.Errorf("%w: dependency %q on component %q has kind %q; this action applies only to kind %q",
					ErrDepWrongKind, depName, componentName, dep.Kind, models.DependencyKindPlatformResource)
			}
			if dep.ResourceType == "" {
				return "", fmt.Errorf("%w: dep %q on component %q has no resourceType",
					ErrDepNotFound, depName, componentName)
			}
			return dep.ResourceType, nil
		}
		// Component found but dep not found.
		return "", fmt.Errorf("%w: dep %q not found on component %q", ErrDepNotFound, depName, componentName)
	}
	return "", fmt.Errorf("%w: component %q not found in design", ErrDepNotFound, componentName)
}

// markProvisionStarted finds the PENDING resource-provisioning task for
// depName and applies TaskEventProvisionStarted through the TaskCompleter
// (the task Projector: pending → building) — never a direct status write.
// Does nothing if no matching pending task exists (e.g. already building).
func (s *ResourceService) markProvisionStarted(ctx context.Context, orgHandle, projectName, depName string) error {
	if s.tasks == nil || s.completer == nil {
		return nil
	}
	tasks, err := s.tasks.ListByProjectID(ctx, orgHandle, projectName)
	if err != nil {
		return err
	}
	for i := range tasks {
		t := &tasks[i]
		if t.Type == models.TaskTypeResourceProvisioning && t.ResourceName == depName &&
			t.Status == string(models.TaskStatusPending) {
			return s.completer.ApplyBuildResult(ctx, t.ID, contracts.TaskEventProvisionStarted, "")
		}
	}
	return nil
}

// TaskStatus returns the resource-provisioning task status for depName, or
// "pending" when no task matches or the list fails (polling-resilient: the
// status endpoint must keep returning 200 mid-provision, so a transient DB
// error degrades to the zero state instead of a 5xx).
func (s *ResourceService) TaskStatus(ctx context.Context, orgHandle, projectName, depName string) string {
	fallback := string(contracts.TaskStatusPending)
	if s.tasks == nil {
		return fallback
	}
	tasks, err := s.tasks.ListByProjectID(ctx, orgHandle, projectName)
	if err != nil {
		slog.WarnContext(ctx, "resources: failed to list tasks for status; defaulting to pending",
			"org", orgHandle, "project", projectName, "dep", depName, "error", err)
		return fallback
	}
	for _, t := range tasks {
		if t.Type == models.TaskTypeResourceProvisioning && t.ResourceName == depName {
			return t.Status
		}
	}
	return fallback
}
