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
	"github.com/wso2/aep/aep-api/internal/platform/k8sname"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// wireModelAccess gives an ai-agent component MODEL_ENDPOINT / MODEL_NAME /
// MODEL_API_KEY. A component of any other type does none of this — no
// SecretReference upsert, no extra OC call — the same "nothing declared,
// nothing to do" discipline spec.resourceTypesForDerivation uses for a
// design with no ai-agent component.
//
// This is the EARLY, best-effort pass, and it is not what makes MODEL_* land:
// at EnsureComponent time the component has no ReleaseBinding yet, so the env
// write has nothing to write to. Its value is the SecretReference upsert, which
// is worth doing before the build. SyncProjectModelAccess, at builds-green, is
// what actually wires the pod.
//
// A failure here therefore logs rather than propagating: a component that
// cannot be created is a worse failure than one that starts and reports what it
// is missing, and the builds-green sweep re-attempts everything anyway.
// agent-building's own contract is a 503 from /healthz until MODEL_* resolve,
// not a failed deploy — see
// docs/decisions/ADR-0016-coding-agent-key-is-an-override-not-a-peer.md.
func (s *componentService) wireModelAccess(ctx context.Context, ocOrgID, projectName, componentName, componentType string) {
	if componentType != spec.ComponentTypeAIAgent {
		return
	}
	if err := s.ensureModelAccess(ctx, ocOrgID, projectName, componentName); err != nil {
		slog.WarnContext(ctx, "ensure component: model access not wired at component-ensure time; the builds-green sweep is what makes it land",
			"org", ocOrgID, "project", projectName, "component", componentName, "error", err)
	}
}

// ensureModelAccess is the write itself, with its failures RETURNED rather than
// logged away, so the builds-green sweep (SyncProjectModelAccess) can surface
// them to Temporal and have the activity retried. wireModelAccess is the
// log-and-continue wrapper the pre-build EnsureComponent path uses, where a
// failure must not block component creation.
//
// The caller has already established that this component is an ai-agent.
func (s *componentService) ensureModelAccess(ctx context.Context, ocOrgID, projectName, componentName string) error {
	if s.modelKeyResolver == nil || s.secretRefClient == nil {
		return fmt.Errorf("model access not configured at the composition root")
	}

	triplet, err := s.modelKeyResolver.DefaultKeyRef(ctx, ocOrgID)
	if err != nil {
		var notFound *organization.NotFoundError
		if errors.As(err, &notFound) {
			// An org with no connected key is expected, not exceptional (a
			// brand-new org before its first Settings visit). Not an error:
			// retrying cannot conjure a key, and agent-building's contract is a
			// 503 from /healthz until one is connected.
			slog.InfoContext(ctx, "model access: org has no connected Anthropic key yet — ai-agent component starts unconfigured (agent-building reports 503 from /healthz until one is connected)",
				"org", ocOrgID, "project", projectName, "component", componentName)
			return nil
		}
		return fmt.Errorf("resolve org's default Anthropic key: %w", err)
	}

	if err := s.upsertModelAccessSecretReference(ctx, ocOrgID, triplet); err != nil {
		return fmt.Errorf("upsert model-access SecretReference: %w", err)
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
		return fmt.Errorf("write MODEL_* env vars: %w", err)
	}
	// NOTE: UpdateComponentWorkflowEnvVars returns nil both when it wrote to
	// N ReleaseBindings AND when the component has none yet (soft no-op —
	// its own doc comment says so), so this call site cannot tell "wired" from
	// "wrote to nothing" without a second OC round-trip.
	//
	// That ambiguity is WHY this must run at builds-green and not only before
	// the build. An earlier version ran solely from EnsureComponent and claimed
	// the miss was covered because EnsureComponent re-runs before every build
	// attempt. It is not: EnsureComponent runs BEFORE the build, the build's
	// last step is what generates the workload OpenChoreo creates the
	// ReleaseBinding from, so on a FIRST build there is never a binding to
	// write to — and a first build gets no second attempt. Every agent's first
	// deploy came up with no MODEL_* and 503'd (observed: the write ran 2m21s
	// before the ReleaseBinding existed). SyncProjectModelAccess is the fix;
	// this path stays because the SecretReference upsert above is worth doing
	// early and every step here is idempotent.
	slog.InfoContext(ctx, "model access: requested MODEL_* wiring for ai-agent component (a no-op when no ReleaseBinding exists yet — the builds-green sweep is what makes it land)",
		"org", ocOrgID, "project", projectName, "component", componentName)
	return nil
}

// SyncProjectModelAccess wires MODEL_* into every ai-agent component in the
// project. Called once per cycle at builds-green — the earliest point where the
// write target exists, since OpenChoreo creates the ReleaseBinding out of the
// workload the build's last step generates. Mirrors SyncProjectAPITraits, which
// exists at the same point in the run for exactly the same reason.
//
// Per-component failures are joined and RETURNED rather than swallowed: the
// caller is a Temporal activity, and returning is what makes it retry. A
// component that fails does not stop the rest of the project from converging.
//
// A design with no ai-agent component does nothing and costs no OC round trip —
// the same "nothing declared, nothing to do" discipline wireModelAccess uses.
func (s *componentService) SyncProjectModelAccess(ctx context.Context, orgID, projectID string) error {
	if s == nil {
		return nil
	}
	if orgID == "" || projectID == "" {
		return fmt.Errorf("model access sync: empty orgID/projectID")
	}
	design, err := s.artifactStore.ReadDesign(ctx, orgID, projectID)
	if err != nil {
		if spec.IsNotFound(err) {
			return nil
		}
		return fmt.Errorf("model access sync: read design: %w", err)
	}
	if design == nil {
		return nil
	}

	var failures []error
	for _, c := range design.Components {
		if c.ComponentType != spec.ComponentTypeAIAgent {
			continue
		}
		if err := s.ensureModelAccess(ctx, orgID, projectID, k8sname.ToK8sName(c.Name)); err != nil {
			slog.WarnContext(ctx, "model access sync: component failed; continuing",
				"org", orgID, "project", projectID, "component", c.Name, "error", err)
			failures = append(failures, fmt.Errorf("component %q: %w", c.Name, err))
		}
	}
	return errors.Join(failures...)
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
