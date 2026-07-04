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
	"log/slog"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/contracts"
	"github.com/wso2/aep/aep-api/internal/feature/dependencies/resources"
	"github.com/wso2/aep/aep-api/models"
)

// ResourceWatcher polls OpenChoreo for the status of in-flight
// resource-provisioning tasks. When the backing ResourceReleaseBinding reaches
// Ready=True the task is completed via contracts.TaskEventResourceReady
// (building → deployed); a terminal-failure binding completes it via
// contracts.TaskEventProvisionFailed (building → failed). Completion ALWAYS
// flows through the projector's ApplyBuildResult — the sole ComponentTask.Status
// writer — never a direct UPDATE.
//
// Structural twin of BuildWatcher (codingagent/build_watcher.go): ticker Run,
// sweep with a FOR UPDATE SKIP LOCKED batch claim, asServiceIdentity wrap,
// per-task processing outside the claim transaction. See BuildWatcher's type
// doc for the multi-replica reasoning — it applies here verbatim: the claim
// dedups the SELECTION window only, and the projector's per-task advisory lock +
// idempotent state machine make an overlapping re-pick a harmless no-op (a
// re-applied terminal transition returns ErrInvalidTransition, absorbed inside
// the projector).
//
// A real database (postgres-cnpg, Redis, …) can take several minutes to stand
// up. The watcher MUST NOT block the provision request path on readiness. It
// polls at the same 10s cadence as the build watcher and uses a bounded-age
// guard (staleAfter, 10 min) to log + leave a stuck task rather than failing it
// spuriously.
//
// Cascade: no explicit redispatch closure. TaskEventResourceReady lands the task
// in `deployed`, and the projector fires its OnTaskDeployed hook
// (DispatchCascadeHook) on that transition — the same path BuildWatcher relies
// on to unblock gated tasks. Re-dispatching here on top of the projector hook
// would double-fire the cascade (C2 review finding); the closure the ported
// source carried is deliberately dropped.
type ResourceWatcher struct {
	db                *gorm.DB
	rc                openchoreo.ResourceClient
	projector         contracts.TaskTransitions
	asServiceIdentity func(ctx context.Context) context.Context
	tick              time.Duration
	staleAfter        time.Duration
}

// NewResourceWatcher constructs a ResourceWatcher.
//
//	rc                — the OC resource client (GetBinding reads status.conditions).
//	projector         — the task Projector (ApplyBuildResult), sole status writer.
//	asServiceIdentity — ADR-0005 dual-mode OC auth: async OC-reading paths run
//	                    under service-identity.
func NewResourceWatcher(
	db *gorm.DB,
	rc openchoreo.ResourceClient,
	projector contracts.TaskTransitions,
	asServiceIdentity func(ctx context.Context) context.Context,
) *ResourceWatcher {
	return &ResourceWatcher{
		db:                db,
		rc:                rc,
		projector:         projector,
		asServiceIdentity: asServiceIdentity,
		tick:              10 * time.Second,
		staleAfter:        10 * time.Minute,
	}
}

// WithTick overrides the poll cadence (tests). Mirrors BuildWatcher's tuning
// setters.
func (w *ResourceWatcher) WithTick(d time.Duration) *ResourceWatcher {
	if d > 0 {
		w.tick = d
	}
	return w
}

// WithStaleAfter overrides the bounded-age guard (tests).
func (w *ResourceWatcher) WithStaleAfter(d time.Duration) *ResourceWatcher {
	if d > 0 {
		w.staleAfter = d
	}
	return w
}

// Run blocks until ctx is cancelled, sweeping at the configured cadence.
// Spawned as a goroutine from main beside buildWatcher.Run and onHoldWatcher.Run.
func (w *ResourceWatcher) Run(ctx context.Context) {
	ticker := time.NewTicker(w.tick)
	defer ticker.Stop()
	slog.InfoContext(ctx, "resource watcher started", "tick", w.tick, "staleAfter", w.staleAfter)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.sweep(ctx)
		}
	}
}

// resourceWatcherClaimSQL is sweep's batch claim. It lives in a const so the
// dbtest SKIP LOCKED proof runs THIS query, not a hand-copied twin — dropping
// the FOR UPDATE SKIP LOCKED clause here fails the proof, structurally (mirrors
// buildWatcherClaimSQL).
const resourceWatcherClaimSQL = `
	SELECT * FROM component_tasks
	WHERE type = ? AND status = ?
	ORDER BY last_event_at NULLS FIRST
	LIMIT 50
	FOR UPDATE SKIP LOCKED`

func (w *ResourceWatcher) sweep(ctx context.Context) {
	if w.asServiceIdentity != nil {
		ctx = w.asServiceIdentity(ctx)
	}

	// Acquire a batch of `building` resource-provisioning tasks under
	// FOR UPDATE SKIP LOCKED so concurrent BFF replicas split the work. Selection
	// dedup only — the locks release on commit here, not across the per-row
	// processing below (see the type doc); the projector's idempotent apply is
	// what makes an overlapping re-pick safe.
	var batch []models.ComponentTask
	err := w.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return tx.Raw(resourceWatcherClaimSQL,
			models.TaskTypeResourceProvisioning, string(models.TaskStatusBuilding)).
			Scan(&batch).Error
	})
	if err != nil {
		slog.ErrorContext(ctx, "resource watcher: select batch failed", "error", err)
		return
	}
	if len(batch) == 0 {
		return
	}

	for i := range batch {
		w.handleTask(ctx, &batch[i])
	}
}

func (w *ResourceWatcher) handleTask(ctx context.Context, t *models.ComponentTask) {
	// Bounded-age guard: a stuck provision logs + leaves rather than failing
	// spuriously. A real DB should not take more than staleAfter to reach Ready.
	if t.LastEventAt != nil && time.Since(*t.LastEventAt) > w.staleAfter {
		slog.WarnContext(ctx, "resource watcher: task stale, skipping",
			"task", t.ID, "resource", t.ResourceName,
			"age", time.Since(*t.LastEventAt).Round(time.Second))
		return
	}

	// Derive the binding name the C3 provisioner authored. The platform
	// provisioner names its per-env binding `<project>-<dep>-<env>`
	// (platform_provisioner.go platformBindingName); D2 unified that with the
	// external-resource form, so resources.ExternalResourceBindingName yields the
	// SAME string and is the exported single source of truth (dispatch_service.go
	// reads platform-resource bindings through it too). The single-env assumption
	// pins env to "development".
	bindingName := resources.ExternalResourceBindingName(t.ProjectID, t.ResourceName, "development")

	binding, err := w.rc.GetBinding(ctx, t.OrgID, bindingName)
	if err != nil {
		// Transient — try again on the next tick.
		slog.WarnContext(ctx, "resource watcher: GetBinding failed",
			"task", t.ID, "binding", bindingName, "error", err)
		return
	}
	// GetBinding returns (nil, nil) on 404 — the binding may not exist yet.
	// classifyBinding treats a nil binding as not-ready; leave for the next tick.

	done, failed, reason := classifyBinding(binding)
	switch {
	case done:
		if err := w.projector.ApplyBuildResult(ctx, t.ID, contracts.TaskEventResourceReady, ""); err != nil {
			slog.ErrorContext(ctx, "resource watcher: apply resource-ready failed",
				"task", t.ID, "error", err)
			return
		}
		slog.InfoContext(ctx, "resource watcher: resource ready → deployed",
			"task", t.ID, "resource", t.ResourceName)
	case failed:
		if err := w.projector.ApplyBuildResult(ctx, t.ID, contracts.TaskEventProvisionFailed, reason); err != nil {
			slog.ErrorContext(ctx, "resource watcher: apply provision-failed failed",
				"task", t.ID, "error", err)
			return
		}
		slog.WarnContext(ctx, "resource watcher: binding in terminal failed state",
			"task", t.ID, "resource", t.ResourceName, "reason", reason)
	default:
		// Still pending / unknown — leave for next tick.
	}
}

// classifyBinding maps a ResourceReleaseBinding to a (done, failed, reason)
// triple. Pure function — no side effects, directly unit-testable.
//
//   - Ready=True                                 → (true,  false, "")  provisioning complete
//   - Terminal False condition (non-progressing) → (false, true, reason) hard failure; reason
//     is the offending condition's Reason, forwarded as ProvisionFailed's errMsg
//   - Pending / Unknown / progressing / nil      → (false, false, "") leave for next tick
func classifyBinding(b *openchoreo.ResourceReleaseBinding) (done bool, failed bool, reason string) {
	if b == nil {
		return false, false, ""
	}
	if b.IsReady() {
		return true, false, ""
	}
	if b.Status == nil {
		return false, false, ""
	}
	// A False condition with a non-progressing reason is terminal.
	// "Progressing" reasons (e.g. "Creating", "Initializing", "") mean we wait.
	for _, c := range b.Status.Conditions {
		if c.Status != "False" {
			continue
		}
		if isTerminalReason(c.Reason) {
			return false, true, c.Reason
		}
	}
	return false, false, ""
}

// progressingReasons are non-terminal False reasons — the controller is still
// working. Any False condition with a reason NOT matched here is considered
// terminal. An empty reason means "still initializing".
var progressingReasons = map[string]bool{
	"": true, // empty reason → still initializing
}

// progressingSubstrings catch OpenChoreo's COMPOUND progressing reasons — the
// binding controller emits e.g. "ResourcesProgressing" (ResourcesReady=False)
// while the backing resource (a CNPG Postgres "Setting up primary") is still
// coming up. A bare "Progressing" whitelist missed these, so a healthy
// mid-provision binding was mis-classified as a hard failure. Matching the
// substring is deliberately lenient: a genuinely stuck binding is caught by the
// watcher's staleAfter age guard, so erring toward "still working" is safe.
var progressingSubstrings = []string{
	"Progressing", "Pending", "Waiting", "Creating", "Initializing", "Provisioning",
}

func isTerminalReason(reason string) bool {
	if progressingReasons[reason] {
		return false
	}
	for _, s := range progressingSubstrings {
		if strings.Contains(reason, s) {
			return false
		}
	}
	return true
}
