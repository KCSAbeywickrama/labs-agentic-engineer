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

// Input kinds the build drawer emits (issue #164). These are the drawer input
// kinds carried on ProvisionInput.Kind — NOT the design dependency kinds (an
// external dependency's config-collection input is "external-config").
const (
	buildKindExternalConfig = "external-config"
	buildKindPlatformResrc  = "platform-resource"
	buildKindOrgService     = "org-service"
)

// BuildProvisionInput is one dependency's resolved provisioning payload for the
// build path — field-identical to devflow.ProvisionInput but a provisioning
// package type (this feature must not import the workflow orchestrator; the
// app-root adapter maps devflow.ProvisionInput ⇄ BuildProvisionInput). A raw
// secret value is NEVER carried here — SecretRefByEnv holds the SM-API reference
// per env (staged pre-tag by POST /build).
type BuildProvisionInput struct {
	Component      string
	Dependency     string
	Kind           string
	Config         map[string]string
	SecretRefByEnv map[string]string
	Parameters     map[string]any
	Approved       bool
}

// ProvisionFailure is one dependency's provisioning failure — data the workflow
// inspects (not an activity error). It carries no secret values.
type ProvisionFailure struct {
	Component  string
	Dependency string
	Reason     string
}

// ProvisionForBuild authors the project's dependencies from the build drawer
// inputs the dev workflow carries (issue #164). It mints the aep:provision gate
// issues ONCE, then authors each input BY KIND:
//   - external-config: the SaveValues-style synchronous flow using the already
//     staged secret reference (AuthorWithSecretRef — no SM-API write), closing
//     the gate synchronously.
//   - platform-resource: the async Provision path (the readiness watcher closes
//     the gate out-of-band).
//   - org-service: a no-op here (Task 4 fills it).
//
// A returned error means "retry the activity" (the gate mint failed). A per-input
// author failure is appended to the returned failures and the batch CONTINUES —
// the workflow decides what to do with them (it fails the run). orgID is the OC
// namespace + issues org; ocOrgID is the SM-API org id (reserved for the org
// path; the external author half needs no SM write). The external deps must
// already be registered in the catalog (the app-root adapter calls
// design.RegisterExternalResources before this — Task 5).
func (s *Service) ProvisionForBuild(ctx context.Context, orgID, ocOrgID, projectID, tag string, inputs []BuildProvisionInput) ([]ProvisionFailure, error) {
	if err := s.EnsureProvisionIssues(ctx, orgID, projectID, tag); err != nil {
		return nil, err
	}

	var failures []ProvisionFailure
	for _, in := range inputs {
		switch in.Kind {
		case buildKindExternalConfig:
			if err := s.authorExternalWithRef(ctx, orgID, ocOrgID, projectID, in); err != nil {
				failures = append(failures, ProvisionFailure{Component: in.Component, Dependency: in.Dependency, Reason: err.Error()})
			}
		case buildKindPlatformResrc:
			if err := s.Provision(ctx, orgID, projectID, in.Dependency, in.Parameters, nil); err != nil {
				failures = append(failures, ProvisionFailure{Component: in.Component, Dependency: in.Dependency, Reason: err.Error()})
			}
		case buildKindOrgService:
			// Cross-project org-service access is authored in Task 4 — no-op here.
		default:
			slog.WarnContext(ctx, "provisioning: unknown build provision kind", "kind", in.Kind, "dependency", in.Dependency)
		}
	}
	return failures, nil
}

// authorExternalWithRef runs the synchronous external-config provisioning flow
// from an already-staged secret reference — mirrors SaveValues (admit gate row →
// author OC binding → complete gate row) but authors via AuthorWithSecretRef
// (the plain config + the staged secretStorePath per env) so no secret value is
// re-written to SM-API.
func (s *Service) authorExternalWithRef(ctx context.Context, orgID, ocOrgID, projectID string, in BuildProvisionInput) error {
	_ = ocOrgID // the author half needs no SM-API write; kept for symmetry with SaveValues.
	if _, err := s.findDepInProject(ctx, orgID, projectID, in.Dependency, models.DependencyKindExternal); err != nil {
		return err
	}
	er, err := s.catalog.Get(ctx, orgID, in.Dependency)
	if err != nil {
		return fmt.Errorf("provisioning: get external resource %q: %w", in.Dependency, err)
	}
	if er == nil {
		return resources.ErrNotRegistered
	}
	byEnv := preparedEnvValues(in)

	// Admit a provision run for the gate issue (when one exists).
	issueNumber, _, err := s.findProvisionIssue(ctx, orgID, projectID, in.Dependency)
	if err != nil {
		return err
	}
	var execID string
	if issueNumber > 0 {
		repo, rerr := s.repos.RepoFullName(ctx, orgID, projectID)
		if rerr != nil {
			return fmt.Errorf("provisioning: resolve repo: %w", rerr)
		}
		row, admitted, aerr := s.admitProvisionRow(ctx, orgID, projectID, repo, in.Dependency, issueNumber)
		if aerr != nil {
			return fmt.Errorf("provisioning: admit provision run: %w", aerr)
		}
		if admitted {
			execID = row.ID
		}
	}

	result, perr := s.extProv.AuthorWithSecretRef(ctx, orgID, projectID, er, byEnv)
	if perr != nil {
		if execID != "" {
			s.failProvisionRow(ctx, orgID, projectID, issueNumber, execID, perr.Error())
		}
		return fmt.Errorf("%w: %v", resources.ErrProvisionFailed, perr)
	}

	if execID != "" {
		ref := result.BindingByEnv[defaultEnv]
		if ref == "" {
			ref = result.ResourceName
		}
		if _, serr := s.execs.StartWithRun(ctx, execID, ref); serr != nil {
			slog.WarnContext(ctx, "provisioning: start external provision run failed", "execution", execID, "error", serr)
		}
		s.completeProvisionRow(ctx, orgID, projectID, issueNumber, execID,
			fmt.Sprintf("External resource `%s` configured (OC binding `%s`).", in.Dependency, ref))
	}
	return nil
}

// preparedEnvValues turns a build external-config input into the per-env author
// inputs: the non-secret Config (applied to every env) + the staged
// secretStorePath per env. When no secret was staged the input still authors the
// default env's binding from the plain config alone.
func preparedEnvValues(in BuildProvisionInput) map[string]resources.PreparedEnvValues {
	byEnv := map[string]resources.PreparedEnvValues{}
	for env, ref := range in.SecretRefByEnv {
		byEnv[env] = resources.PreparedEnvValues{Plain: in.Config, SecretStorePath: ref}
	}
	if len(byEnv) == 0 {
		byEnv[defaultEnv] = resources.PreparedEnvValues{Plain: in.Config}
	}
	return byEnv
}
