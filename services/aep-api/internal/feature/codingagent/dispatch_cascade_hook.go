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

package codingagent

import (
	"context"
	"fmt"
	"hash/fnv"
	"log/slog"

	"gorm.io/gorm"

	"github.com/wso2/aep/aep-api/internal/feature/component"
)

// projectSPARuntimeConfigEmitter re-emits env-config.js across a project's
// SPAs. Consumer port for the RuntimeConfigService — defined here and
// satisfied structurally by the concrete, wired at the composition root, so
// the cascade needn't import the runtime-config package. Mirrors the
// runtimeConfigEmitter pattern in dispatch_service.go.
//
// See docs/design/cross-component-wiring-gaps.md §3.
type projectSPARuntimeConfigEmitter interface {
	EmitForProjectSPAs(ctx context.Context, orgID, projectID string) error
}

// accessGranter is the consumer port for the cross-project access-request grant
// close-out. When a provider's `org-publish` task lands `deployed`, the cascade
// calls GrantByProviderComponent so every open AccessRequest riding on it flips
// to `granted`, the provider design is marked org-published (durability), and the
// provider issue is closed. Satisfied structurally by *endpoints.AccessService
// (C4) — kept as a local interface so the cascade needn't import that package.
// The whole state-machine lives inside C4; the cascade only fires the trigger.
type accessGranter interface {
	// GrantByProviderComponent matches on the LOGICAL component name — the
	// org-publish task's ComponentName, which is exactly what the deployed task
	// carries into OnTaskDeployed. Pass it through unchanged.
	GrantByProviderComponent(ctx context.Context, orgID, projectID, componentName string) error
}

// DispatchCascadeHook is the post-commit cascade fired by the webhook
// projector whenever a task lands in `deployed`. It owns the per-project
// advisory lock + eligibility scan + DispatchService.DispatchTasks call. The
// dispatch itself (gating logic + URL resolution) lives in DispatchService —
// this type only takes the lock and invokes it.
type DispatchCascadeHook struct {
	db            *gorm.DB
	dispatch      DispatchService
	traitSync     *component.TraitSyncService
	runtimeConfig projectSPARuntimeConfigEmitter
	accessGrant   accessGranter
}

func NewDispatchCascadeHook(db *gorm.DB, dispatch DispatchService) *DispatchCascadeHook {
	return &DispatchCascadeHook{db: db, dispatch: dispatch}
}

// SetTraitSync wires the trait sync service so the cascade can re-emit
// sibling-CORS origins on every protected API in the project when a SPA
// lands deployed. Optional — when nil the cascade skips the re-emit step.
func (h *DispatchCascadeHook) SetTraitSync(t *component.TraitSyncService) {
	if h == nil {
		return
	}
	h.traitSync = t
}

// SetRuntimeConfig wires the env-config.js emitter so the cascade can
// re-emit window._env_ values on every SPA in the project when any
// component lands deployed (sibling API URLs become available). Optional.
func (h *DispatchCascadeHook) SetRuntimeConfig(r projectSPARuntimeConfigEmitter) {
	if h == nil {
		return
	}
	h.runtimeConfig = r
}

// SetAccessGrant wires the cross-project access-request grant close-out (C4).
// When a provider's `org-publish` task lands `deployed`, the cascade fires
// GrantByProviderComponent with the deployed task's LOGICAL component name.
// Optional + best-effort — a nil granter disables it, and a grant failure never
// breaks the deploy cascade.
func (h *DispatchCascadeHook) SetAccessGrant(g accessGranter) {
	if h == nil {
		return
	}
	h.accessGrant = g
}

// OnTaskDeployed is the post-commit hook. Acquires a per-project advisory
// lock so concurrent deploys against the same project serialise (a
// dependent shared between two deps must dispatch exactly once when the
// second dep deploys). Inside the lock, calls DispatchTasks which handles
// the on_hold re-evaluation + actual dispatch.
//
// Errors are logged but never propagated — the deploy transition has
// already committed by the time we get here, and the cascade is
// best-effort. Operator-visible failure surfaces inside DispatchTasks
// (the dispatched task itself transitions to TaskStatusFailed with
// ErrorMessage populated).
func (h *DispatchCascadeHook) OnTaskDeployed(ctx context.Context, orgID, projectID, componentName string) {
	if h == nil || h.db == nil || h.dispatch == nil {
		return
	}
	// Per-project advisory lock — a per-project pg advisory lock. The lock
	// and the whole guarded cascade (trait sync + env-config re-emit +
	// DispatchTasks) run inside ONE real transaction so the lock is held for
	// the full duration: a dependent shared between two deps must dispatch
	// exactly once when the second dep lands, and two near-simultaneous deploys
	// against the same project must serialise.
	//
	// pg_advisory_xact_lock releases only at transaction end. Taking it via a
	// bare Exec under gorm's SkipDefaultTransaction autocommits and releases it
	// immediately — before any guarded work — which is no exclusion at all.
	// This transaction itself performs no writes; the guarded services use
	// their own connections. Its sole job is to hold the lock, which blocks a
	// concurrent hook on the same project for the length of the cascade.
	err := h.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if lerr := tx.Exec(
			`SELECT pg_advisory_xact_lock(?)`,
			hashCascadeKey("project:"+projectID),
		).Error; lerr != nil {
			return fmt.Errorf("acquire project lock: %w", lerr)
		}

		// Dependency URL handoff to consumer SPAs flows through the
		// ReleaseBinding `env-config.js` (BFF emits per-env values into
		// workloadOverrides.container.files). dispatch's
		// resolveDependencyEndpoints enforces the §1.3 URL invariant at
		// dispatch time.
		//
		// For OIDC-SPA web-apps the platform IDP redirect_uris are
		// registered by RuntimeConfigService.layerThunderKeys when the SPA
		// gets its env-config.js emitted below — no separate dispatch-side
		// Thunder call is needed.

		// Sibling-CORS re-emit: any dispatch in a project re-emits the
		// `cors.allowedOrigins` block on every protected API's ReleaseBinding
		// so freshly added SPAs are echoed back on preflight. Without this,
		// the first deploy of a new SPA cannot call the API cross-origin
		// until something else triggers a sync. Idempotent + best-effort.
		if h.traitSync != nil {
			if terr := h.traitSync.SyncProjectAPITraits(ctx, orgID, projectID); terr != nil {
				slog.WarnContext(ctx, "dispatch cascade: SyncProjectAPITraits failed",
					"project", projectID, "deployedComponent", componentName, "error", terr)
			}
		}

		// Env-config.js re-emit: when a sibling service's external URL just
		// resolved, the depending SPAs need their `window._env_.API_BASE_URL`
		// refreshed. Re-emit env-config.js on every SPA in the project so
		// the next pod restart picks up the latest values. Idempotent +
		// best-effort.
		if h.runtimeConfig != nil {
			if rerr := h.runtimeConfig.EmitForProjectSPAs(ctx, orgID, projectID); rerr != nil {
				slog.WarnContext(ctx, "dispatch cascade: EmitForProjectSPAs failed",
					"project", projectID, "deployedComponent", componentName, "error", rerr)
			}
		}

		// Cross-project access-request grant close-out: if this just-deployed
		// component is the PROVIDER of an open cross-project access request, flip
		// every consumer request riding on its publish task to `granted`, persist
		// exposesAPI.orgPublished (durability), and close the provider issue. The
		// whole state machine lives inside C4's AccessService; the cascade only
		// fires the trigger with the deployed task's LOGICAL component name.
		// Best-effort: a grant failure must never break the deploy cascade, so it
		// is logged and swallowed rather than aborting the transaction.
		if h.accessGrant != nil {
			if gerr := h.accessGrant.GrantByProviderComponent(ctx, orgID, projectID, componentName); gerr != nil {
				slog.WarnContext(ctx, "dispatch cascade: access grant failed",
					"project", projectID, "providerComponent", componentName, "error", gerr)
			}
		}

		results, derr := h.dispatch.DispatchTasks(ctx, orgID, projectID)
		if derr != nil {
			return fmt.Errorf("dispatch tasks: %w", derr)
		}
		slog.InfoContext(ctx, "dispatch cascade fired",
			"project", projectID,
			"deployedComponent", componentName,
			"dispatched", len(results),
		)
		return nil
	})
	// Errors are logged but never propagated — the deploy transition already
	// committed and the cascade is best-effort. Rolling back this transaction
	// only releases the advisory lock; the guarded services' writes ran on
	// their own connections and are unaffected.
	if err != nil {
		slog.WarnContext(ctx, "dispatch cascade failed",
			"project", projectID, "deployedComponent", componentName, "error", err)
	}
}

func hashCascadeKey(s string) int64 {
	h := fnv.New64a()
	h.Write([]byte(s))
	return int64(h.Sum64()) //nolint:gosec
}
