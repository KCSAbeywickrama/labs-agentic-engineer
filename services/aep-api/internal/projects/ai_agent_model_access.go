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
	"strings"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/clients/secretmanagersvc"
	"github.com/wso2/aep/aep-api/internal/organization"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// wireModelAccess gives an ai-agent component MODEL_ENDPOINT / MODEL_NAME /
// MODEL_API_KEY. A component of any other type does none of this — no
// SecretReference upsert, no extra OC call — the same "nothing declared,
// nothing to do" discipline spec.resourceTypesForDerivation uses for a
// design with no ai-agent component.
//
// Every failure branch here logs and returns rather than propagating: a
// component that cannot be created is a worse failure than one that starts
// and reports what it is missing. agent-building's own contract is a 503
// from /healthz until MODEL_* resolve, not a failed deploy — see
// docs/decisions/ADR-0016-coding-agent-key-is-an-override-not-a-peer.md.
// An org with no connected Anthropic key is expected, not exceptional
// (a brand-new org before its first Settings visit), so it logs at Info;
// everything else that stops the wiring logs at Warn.
func (s *componentService) wireModelAccess(ctx context.Context, ocOrgID, projectName, componentName, componentType string) {
	if componentType != spec.ComponentTypeAIAgent {
		return
	}
	if s.modelKeyResolver == nil || s.secretRefClient == nil {
		slog.WarnContext(ctx, "ensure component: model access not configured at the composition root — MODEL_* will not be set for this ai-agent component",
			"org", ocOrgID, "project", projectName, "component", componentName)
		return
	}

	triplet, err := s.modelKeyResolver.DefaultKeyRef(ctx, ocOrgID)
	if err != nil {
		var notFound *organization.NotFoundError
		if errors.As(err, &notFound) {
			slog.InfoContext(ctx, "ensure component: org has no connected Anthropic key yet — ai-agent component starts unconfigured (agent-building reports 503 from /healthz until one is connected)",
				"org", ocOrgID, "project", projectName, "component", componentName)
			return
		}
		slog.WarnContext(ctx, "ensure component: resolve org's default Anthropic key failed — MODEL_API_KEY not wired",
			"org", ocOrgID, "project", projectName, "component", componentName, "error", err)
		return
	}

	if err := s.upsertModelAccessSecretReference(ctx, ocOrgID, triplet); err != nil {
		slog.WarnContext(ctx, "ensure component: upsert model-access SecretReference failed — MODEL_API_KEY not wired",
			"org", ocOrgID, "project", projectName, "component", componentName, "error", err)
		return
	}

	envVars := []openchoreo.WorkflowEnvVarRef{
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
	}
	if err := s.client.UpdateComponentWorkflowEnvVars(ctx, ocOrgID, projectName, componentName, envVars); err != nil {
		slog.WarnContext(ctx, "ensure component: write MODEL_* env vars failed",
			"org", ocOrgID, "project", projectName, "component", componentName, "error", err)
		return
	}
	// NOTE: UpdateComponentWorkflowEnvVars returns nil both when it wrote to
	// N ReleaseBindings AND when the component has none yet (soft no-op —
	// its own doc comment says so). This call site cannot tell those apart
	// without a second OC round-trip this package does not otherwise need,
	// so the log below is deliberately phrased as a request, not a
	// confirmation. The retry is real, not aspirational:
	// `eventcore.Events.ensureComponent` (internal/delivery/eventcore/builds.go)
	// re-calls EnsureComponent — and therefore wireModelAccess — before
	// EVERY build attempt, not just the first, so a component whose first
	// EnsureComponent ran before any ReleaseBinding existed gets this
	// applied for real once its first build produces one. Same discipline
	// config_service.go's UpdateConfig comment already documents for
	// literal env vars.
	slog.InfoContext(ctx, "ensure component: requested MODEL_* wiring for ai-agent component (no-op until its first ReleaseBinding exists; retried on every subsequent EnsureComponent call)",
		"org", ocOrgID, "project", projectName, "component", componentName)
}

// vaultPathPrefix mirrors the constant the OpenBao provider and
// SecretRefWriter each define for the same path — kept local because both of
// theirs are unexported.
const vaultPathPrefix = "user-app-secrets"

func orgNamespaceFromVaultKey(kvPath string) (string, error) {
	parts := strings.Split(strings.Trim(kvPath, "/"), "/")
	if len(parts) < 3 || parts[0] != vaultPathPrefix || parts[1] == "" {
		return "", fmt.Errorf("unexpected vault key shape %q: want %s/<org-ns>/<name>", kvPath, vaultPathPrefix)
	}
	return parts[1], nil
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
// (secret_reference_client.go) that secretmanagersvc itself is built on,
// into the same org namespace every other SecretReference for this org
// already lives in (see orgNamespaceFromVaultKey).
// orgNamespaceFromVaultKey reads the org's control-plane namespace out of the
// vault key the org's own Anthropic row already carries.
//
// The key's shape is fixed by the provider that wrote it —
// `user-app-secrets/{OrgBaseNamespace(orgUUID)}/{secretRefName}` (openbao
// provider's vaultPath) — so segment 1 IS the namespace every other
// SecretReference for this org lives in.
//
// Taking it from the key rather than recomputing it is deliberate, and this
// is where an earlier version of this file was wrong: it called
// `tenant.OrgBaseNamespace(ocOrgID)` with the OpenChoreo org HANDLE
// ("default"), while the derivation everywhere else uses the Thunder org
// UUID (the JWT's `ouId`). That produced `wc-default-…`, a namespace which
// does not exist, so the create 500'd and agents deployed with no MODEL_*.
//
// A derived value can disagree with reality; a value read out of the real
// path cannot. It also needs no JWT — `EnsureComponent` runs on the build
// path, where there is not always a request context to read claims from.
func (s *componentService) upsertModelAccessSecretReference(ctx context.Context, ocOrgID string, triplet organization.SecretRefTriplet) error {
	orgNS, err := orgNamespaceFromVaultKey(triplet.KVPath)
	if err != nil {
		return err
	}
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
