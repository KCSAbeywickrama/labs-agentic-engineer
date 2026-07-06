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

// ValueService handles per-env external-resource value submission: split the
// submitted values by the resource's schema → provision the OC Resource model
// → complete the config-collection task via the contracts state machine
// (TaskEventValuesProvisioned ⇒ deployed) → re-dispatch the gated component
// tasks (the cascade).
type ValueService struct {
	lookup     externalResourceLookup
	prov       *ExternalResourceProvisioner
	tasks      TaskStore
	completer  TaskCompleter
	redispatch RedispatchFunc
}

// NewValueService wires the value flow. completer is the task Projector (or a
// test double with the same ApplyBuildResult shape); redispatch may be nil
// when no dispatch cascade is wired.
func NewValueService(lookup externalResourceLookup, prov *ExternalResourceProvisioner, tasks TaskStore, completer TaskCompleter, redispatch RedispatchFunc) *ValueService {
	return &ValueService{lookup: lookup, prov: prov, tasks: tasks, completer: completer, redispatch: redispatch}
}

// SaveValues provisions a registered external resource for a project from the
// user's per-env values. `orgHandle` is the OC org handle (the BFF's org key —
// registry rows, tasks and OC namespaces key off it); `ocOrgID` is the SM-API
// org id. `envValues` maps environment → {key: value}; values are split into
// plain/secret by the resource's registered schema (the user never marks which
// is which — the schema does).
func (v *ValueService) SaveValues(ctx context.Context, orgHandle, ocOrgID, projectName, name string, envValues map[string]map[string]string) error {
	er, err := v.lookup.Get(ctx, orgHandle, name)
	if err != nil {
		return err
	}
	if er == nil {
		return fmt.Errorf("external resources: %w: %q", ErrNotRegistered, name)
	}
	byEnv := make(map[string]EnvValues, len(envValues))
	for env, vals := range envValues {
		byEnv[env] = splitBySchema(er.ConfigKeys, vals)
	}
	if _, err := v.prov.Provision(ctx, orgHandle, ocOrgID, projectName, er, byEnv); err != nil {
		return fmt.Errorf("external resources: provision %q: %w", name, err)
	}
	// Complete the config-collection task through the contracts transition
	// (values_provisioned ⇒ deployed) — reaching `deployed` is what the
	// dependent component tasks gate on (best-effort — provisioning already
	// succeeded).
	if err := v.completeConfigTask(ctx, orgHandle, projectName, name); err != nil {
		slog.WarnContext(ctx, "external resources: failed to complete config-collection task",
			"resource", name, "project", projectName, "error", err)
	}
	// Cascade: re-evaluate gating so component tasks waiting on this resource
	// dispatch.
	if v.redispatch != nil {
		if err := v.redispatch(ctx, orgHandle, projectName); err != nil {
			slog.WarnContext(ctx, "external resources: re-dispatch after config-collection failed",
				"project", projectName, "error", err)
		}
	}
	return nil
}

// completeConfigTask finds the resource's not-yet-deployed config-collection
// task and applies TaskEventValuesProvisioned through the TaskCompleter (the
// task Projector) — never a direct status write.
func (v *ValueService) completeConfigTask(ctx context.Context, orgID, projectID, name string) error {
	if v.tasks == nil || v.completer == nil {
		return nil
	}
	tasks, err := v.tasks.ListByProjectID(ctx, orgID, projectID)
	if err != nil {
		return err
	}
	for i := range tasks {
		t := &tasks[i]
		if t.Type == models.TaskTypeConfigCollection && t.ExternalResourceName == name &&
			t.Status != string(models.TaskStatusDeployed) {
			return v.completer.ApplyBuildResult(ctx, t.ID, contracts.TaskEventValuesProvisioned, "")
		}
	}
	return nil
}

// splitBySchema sorts a flat key→value map into plain vs secret by the
// resource's registered schema. Unknown keys default to plain (a value the
// schema doesn't know can't be a credential we're tracking).
func splitBySchema(schema []models.ConfigKey, values map[string]string) EnvValues {
	secret := make(map[string]bool, len(schema))
	for _, k := range schema {
		secret[k.Key] = k.Secret
	}
	ev := EnvValues{Plain: map[string]string{}, Secret: map[string]string{}}
	for k, val := range values {
		if secret[k] {
			ev.Secret[k] = val
		} else {
			ev.Plain[k] = val
		}
	}
	return ev
}
