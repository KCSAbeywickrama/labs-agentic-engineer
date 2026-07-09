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

package provisioning

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/wso2/aep/aep-api/internal/feature/dependencies/resources"
	"github.com/wso2/aep/aep-api/models"
)

// Provision authors the OC Resource model for a platform-resource dependency
// (e.g. postgres-cnpg) and admits a running provision Execution. It is
// ASYNCHRONOUS: standing up a real backing instance takes minutes, so this
// returns once the Resource + binding are authored — the readiness watcher
// observes the binding's native Ready condition out-of-band and only then
// Finishes the run (→ deployed), closes the gate issue, and releases consumers.
//
// Parameters merge the design's authored parameters (baseline) with any
// request-supplied overrides (request wins). params carry no secrets — a
// platform resource's credentials are surfaced as binding outputs, never inputs.
func (s *Service) Provision(ctx context.Context, orgID, projectID, depName string, params map[string]any, envs []string) error {
	dep, err := s.findDepInProject(ctx, orgID, projectID, depName, models.DependencyKindPlatformResource)
	if err != nil {
		return err
	}
	if dep.ResourceType == "" {
		return fmt.Errorf("%w: platform-resource %q has no resourceType in the design", resources.ErrDepNotFound, depName)
	}
	merged := make(map[string]any, len(dep.Parameters)+len(params))
	for k, v := range dep.Parameters {
		merged[k] = v
	}
	for k, v := range params {
		merged[k] = v
	}
	envs = envList(envs)

	issueNumber, _, err := s.findProvisionIssue(ctx, orgID, projectID, depName)
	if err != nil {
		return err
	}
	var execID string
	if issueNumber > 0 {
		repo, rerr := s.repos.RepoFullName(ctx, orgID, projectID)
		if rerr != nil {
			return fmt.Errorf("provisioning: resolve repo: %w", rerr)
		}
		row, admitted, aerr := s.admitProvisionRow(ctx, orgID, projectID, repo, depName, issueNumber)
		if aerr != nil {
			return fmt.Errorf("provisioning: admit provision run: %w", aerr)
		}
		if !admitted {
			// A provision run is already active for this gate — idempotent 202.
			return nil
		}
		execID = row.ID
	}

	result, perr := s.platProv.Provision(ctx, orgID, projectID, depName, dep.ResourceType, merged, envs)
	if perr != nil {
		if execID != "" {
			s.failProvisionRow(ctx, orgID, projectID, issueNumber, execID, perr.Error())
		}
		return fmt.Errorf("%w: %v", resources.ErrProvisionFailed, perr)
	}

	// Async: mark the run RUNNING pinned to the development binding name; the
	// readiness watcher observes Ready and finishes it. Without a start the
	// watcher cannot pick it up, so a start failure is a real (logged) problem.
	if execID != "" {
		ref := result.BindingByEnv[defaultEnv]
		if ref == "" {
			ref = result.ResourceName
		}
		if _, serr := s.execs.StartWithRun(ctx, execID, ref); serr != nil {
			slog.WarnContext(ctx, "provisioning: start platform provision run failed", "execution", execID, "error", serr)
		}
	}
	return nil
}
