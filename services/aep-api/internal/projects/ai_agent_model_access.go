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

// ai_agent_model_access.go — gives every ai-agent component the
// organisation's own Anthropic key, with no per-component dependency
// declared (ADR-0016: every agent runs on the org's key, same as the RCA
// agent — there is nothing per-agent to choose or provision).
//
// The mechanism (docs/glossary.md's `SecretReference` entry): a
// SecretReference is authored ONCE, in the org's control-plane namespace,
// pointing at the org's default-role Anthropic key's vault path; OpenChoreo
// (via ESO) materializes the resulting K8s Secret directly in the
// CONSUMING-plane namespace — the `dp-*` namespace an ai-agent component's
// pod actually runs in. This package never learns that namespace's name;
// OpenChoreo resolves it. `UpdateComponentWorkflowEnvVars` (already used by
// config_service.go for literal env vars) carries `MODEL_API_KEY` as a
// `ValueFrom.SecretKeyRef` naming that SecretReference, exactly the way
// OpenChoreo's own "deploy with configurations" tutorial documents.
package projects

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/clients/secretmanagersvc"
	"github.com/wso2/aep/aep-api/internal/organization"
)

// ModelAccessEnvVars returns the MODEL_ENDPOINT / MODEL_NAME / MODEL_API_KEY
// an ai-agent component needs, after making sure the SecretReference the
// MODEL_API_KEY entry names exists in the org's control-plane namespace.
//
// It is called while COMPOSING a deployment, so the values ride the one
// ReleaseBinding write the deploy stage already makes (DesiredDeploymentFor →
// ApplyReleaseBinding) instead of a second pass that patches the binding after
// the fact. That ordering is not a preference: model access is granted by
// component TYPE rather than declared as a dependency (ADR-0016), so
// OpenChoreo never resolves it while rendering the release the way it resolves
// a declared one — the platform has to put it there, and the only moment a
// binding is guaranteed to exist is the write that creates it.
//
// An org with no connected Anthropic key yields (nil, nil): a brand-new org
// before its first Settings visit is expected, not exceptional, and retrying
// cannot conjure a key. The agent then starts unconfigured and agent-building's
// contract is a 503 from /healthz until one is connected.
func (s *componentService) ModelAccessEnvVars(ctx context.Context, ocOrgID string) ([]openchoreo.WorkflowEnvVarRef, error) {
	if s.modelKeyResolver == nil || s.secretRefClient == nil {
		return nil, fmt.Errorf("model access not configured at the composition root")
	}

	triplet, err := s.modelKeyResolver.DefaultKeyRef(ctx, ocOrgID)
	if err != nil {
		var notFound *organization.NotFoundError
		if errors.As(err, &notFound) {
			slog.InfoContext(ctx, "model access: org has no connected Anthropic key yet — ai-agent components start unconfigured (agent-building reports 503 from /healthz until one is connected)",
				"org", ocOrgID)
			return nil, nil
		}
		return nil, fmt.Errorf("resolve org's default Anthropic key: %w", err)
	}

	if err := s.upsertModelAccessSecretReference(ctx, ocOrgID, triplet); err != nil {
		return nil, fmt.Errorf("upsert model-access SecretReference: %w", err)
	}

	return []openchoreo.WorkflowEnvVarRef{
		{Key: modelEndpointEnvVar, Value: modelEndpointDefault},
		{Key: modelNameEnvVar, Value: modelNameDefault},
		{
			Key: modelAPIKeyEnvVar,
			ValueFrom: &openchoreo.WorkflowEnvVarValueRef{
				SecretKeyRef: &openchoreo.WorkflowSecretKeyRef{
					Name: modelAccessSecretRefName,
					Key:  triplet.Property,
				},
			},
		},
	}, nil
}

// upsertModelAccessSecretReference points modelAccessSecretRefName — one per
// org, shared by every ai-agent component in it — at the organisation's
// default Anthropic key's vault coordinates. Mirrors
// secretmanagersvc.upsertSecretReference's get-then-create/update-on-
// conflict shape, but cannot reuse that method directly: its
// CreateSecret/PatchSecret write a NEW value into a NEW KV path (it is a
// key/value store client that also happens to own SecretReference upkeep),
// whereas this needs the EXISTING org key referenced in place — so this
// goes straight through the OC SecretReference CRUD
// (secret_reference_client.go) that secretmanagersvc itself is built on.
//
// THE NAMESPACE IS ocOrgID, and that is the whole subtlety of this function.
// secretsprovider.SecretLocation.CPNamespace states the rule outright: a
// SecretReference must be authored in "the same namespace as the
// Workload/ReleaseBinding that will secretKeyRef it", and is "distinct from
// tenant.OrgBaseNamespace(OrgName), which is only the VAULT PATH segment".
// Every production caller sets `ControlPlaneNamespace: ocOrgID`
// (organization/secret_ref_writer.go, six call sites) — so ocOrgID it is,
// passed through unmodified.
//
// Two earlier versions of this got it wrong in opposite directions, and both
// times the mistake was deriving the namespace instead of using the one the
// rest of the platform uses:
//
//   - `tenant.OrgBaseNamespace(ocOrgID)` produced `wc-default-…`, a namespace
//     that does not exist, so the create 500'd.
//   - Reading segment 1 out of triplet.KVPath produced `wc-019f40d1-b04b186b`,
//     a namespace that DOES exist — so the create succeeded, and the object
//     was invisible to the ReleaseBinding in `default` that referenced it.
//     OpenChoreo then failed the whole render with `RenderingFailed:
//     SecretReference "ai-agent-model-access" not found`, and the agent kept
//     serving from its old pod with no MODEL_* at all.
//
// The second is the more instructive failure: the write SUCCEEDED. Creation
// succeeding proves the namespace exists, never that the consumer can see it.
// The vault path and the control-plane namespace are different coordinate
// systems that happen to both be called "the org's namespace"; only one of
// them is where CRs live.
func (s *componentService) upsertModelAccessSecretReference(ctx context.Context, ocOrgID string, triplet organization.SecretRefTriplet) error {
	orgNS := ocOrgID
	req := secretmanagersvc.CreateSecretReferenceRequest{
		Namespace: orgNS,
		Name:      modelAccessSecretRefName,
		KVPath:    triplet.KVPath,
		// SecretKeys is deliberately [triplet.Property] rather than
		// ["MODEL_API_KEY"]: buildSecretReferenceBody sets the resulting
		// SecretReference's remoteRef.property to the SAME string as its
		// secretKey, so this must be the real vault property name. The env
		// var's own name ("MODEL_API_KEY") is decoupled from this — it is
		// set separately, in wireModelAccess's WorkflowSecretKeyRef.Key.
		SecretKeys:      []string{triplet.Property},
		RefreshInterval: modelAccessSecretRefRefresh,
	}

	_, getErr := s.secretRefClient.GetSecretReference(ctx, orgNS, modelAccessSecretRefName)
	if getErr == nil {
		if _, err := s.secretRefClient.UpdateSecretReference(ctx, orgNS, modelAccessSecretRefName, req); err != nil {
			return fmt.Errorf("update model-access SecretReference: %w", err)
		}
		return nil
	}
	if !errors.Is(getErr, secretmanagersvc.ErrNotFound) {
		return fmt.Errorf("check model-access SecretReference: %w", getErr)
	}
	if _, err := s.secretRefClient.CreateSecretReference(ctx, orgNS, req); err != nil {
		if errors.Is(err, secretmanagersvc.ErrConflict) {
			// Raced another EnsureComponent for the same org — same
			// create-then-update-on-409 shape secretmanagersvc.upsertSecretReference
			// uses.
			if _, uerr := s.secretRefClient.UpdateSecretReference(ctx, orgNS, modelAccessSecretRefName, req); uerr != nil {
				return fmt.Errorf("update model-access SecretReference after create conflict: %w", uerr)
			}
			return nil
		}
		return fmt.Errorf("create model-access SecretReference: %w", err)
	}
	return nil
}
