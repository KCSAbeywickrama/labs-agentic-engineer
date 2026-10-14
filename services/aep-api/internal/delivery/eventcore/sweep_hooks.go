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

package eventcore

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"sync"

	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// hookRepair is the sweep's hook backstop. Each pass it ensures the hook of
// every ready project row that needs one:
//
//   - a row with no hook id: a project create whose hook registration failed
//     keeps going with a warning and leaves the row so;
//   - a row whose hook was ensured at another config rev than the one its
//     org's AE Studio installs now. The rev names the pod's delivery URL and
//     signing secret, so it moves when the org's relay channel moves (a new
//     relay seed) or its webhook secret changes, and is "" on a row from
//     before revs were stored. Such a hook posts to a dead channel or signs
//     with a secret the pod refuses (401), so every delivery is lost. The
//     ensure reconfigures the stored hook in place (re-created when GitHub
//     no longer has it), and the row then stores the current rev.
//
// The org's current rev is one pod call per org per pass (no GitHub call);
// a row at that rev costs nothing more.
//
// What it must never do is call GitHub every minute forever:
//
//   - an AE Studio that is not serving (restarting, provisioning) or absent
//     (the org's GitHub is not connected) is the ORG's state, so the org's
//     remaining rows wait for the next pass, and a pod that comes back or a
//     reconnect heals without a restart;
//   - any other permanent refusal (the repository gone from GitHub, an owner
//     the pod refuses, aep-api's own token refused) skips that row for the
//     life of the process, with one value-free eventcore.hook_repair_skipped
//     line. A repository fixed by hand gets its hook at the next restart;
//   - anything else (a 5xx, a rate limit) is retried on the next pass.
type hookRepair struct {
	ensurer HookEnsurer

	mu      sync.Mutex
	skipped map[RepoRef]struct{} // rows refused for good, keyed without their hook state
}

func (h *hookRepair) repair(ctx context.Context, repos []RepoRef) {
	if h.ensurer == nil {
		return
	}
	h.prune(repos)
	waiting := map[string]bool{} // orgs whose AE Studio does not serve this pass
	revs := map[string]string{}  // each org's current hook config rev, read once a pass
	for _, repo := range repos {
		if repo.HookExempt || waiting[repo.OrgID] || h.isSkipped(repo) {
			continue
		}
		reason := "missing"
		if repo.HasHook {
			current, ok := h.currentRev(ctx, repo.OrgID, revs, waiting)
			if !ok || repo.HookRev == current {
				continue
			}
			reason = "stale"
		}
		_, err := h.ensurer.Register(ctx, repo.OrgID, repo.ProjectID)
		switch {
		case err == nil:
			slog.InfoContext(ctx, "eventcore.hook_repaired", "org", repo.OrgID, "project", repo.ProjectID, "reason", reason)
		case errors.Is(err, sourcecontrol.ErrAEStudioUnavailable), errors.Is(err, sourcecontrol.ErrAEStudioAbsent):
			waiting[repo.OrgID] = true
			slog.DebugContext(ctx, "eventcore.hook_repair_deferred", "org", repo.OrgID, "reason", skipReason(err))
		case sourcecontrol.IsPermanent(err):
			h.skip(repo)
			slog.WarnContext(ctx, "eventcore.hook_repair_skipped", "org", repo.OrgID, "project", repo.ProjectID, "reason", skipReason(err))
		default:
			slog.WarnContext(ctx, "eventcore.hook_repair_failed", "org", repo.OrgID, "project", repo.ProjectID,
				"reason", failReason(err), "status", httpStatusOf(err))
		}
	}
}

// currentRev answers org's current hook config rev, read once per pass into
// revs. An org whose rev cannot be read waits for the next pass (waiting):
// its stored hooks are not judged without it.
func (h *hookRepair) currentRev(ctx context.Context, org string, revs map[string]string, waiting map[string]bool) (string, bool) {
	if rev, ok := revs[org]; ok {
		return rev, true
	}
	rev, err := h.ensurer.HookRev(ctx, org)
	if err != nil {
		waiting[org] = true
		if errors.Is(err, sourcecontrol.ErrAEStudioUnavailable) || errors.Is(err, sourcecontrol.ErrAEStudioAbsent) {
			slog.DebugContext(ctx, "eventcore.hook_repair_deferred", "org", org, "reason", skipReason(err))
		} else {
			slog.WarnContext(ctx, "eventcore.hook_rev_failed", "org", org, "reason", failReason(err), "status", httpStatusOf(err))
		}
		return "", false
	}
	revs[org] = rev
	return rev, true
}

// prune forgets the skipped rows the listing no longer has (a deleted
// project), so a project re-created under the same name is tried again.
func (h *hookRepair) prune(repos []RepoRef) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.skipped) == 0 {
		return
	}
	listed := make(map[RepoRef]bool, len(repos))
	for _, r := range repos {
		listed[skipKey(r)] = true
	}
	for k := range h.skipped {
		if !listed[k] {
			delete(h.skipped, k)
		}
	}
}

func (h *hookRepair) isSkipped(repo RepoRef) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	_, ok := h.skipped[skipKey(repo)]
	return ok
}

func (h *hookRepair) skip(repo RepoRef) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.skipped == nil {
		h.skipped = map[RepoRef]struct{}{}
	}
	h.skipped[skipKey(repo)] = struct{}{}
}

func skipKey(repo RepoRef) RepoRef {
	repo.HasHook, repo.HookRev = false, ""
	return repo
}

// failReason names a transient hook-repair failure without the error's text
// (a GitHub response body can ride it).
func failReason(err error) string {
	var rl *sourcecontrol.RateLimitedError
	switch {
	case errors.As(err, &rl):
		return "rate_limited"
	case httpStatusOf(err) != 0:
		return "github_error"
	default:
		return "failed"
	}
}

// httpStatusOf is the GitHub status an error carries, 0 when none.
func httpStatusOf(err error) int {
	var se *sourcecontrol.HTTPStatusError
	if errors.As(err, &se) {
		return se.StatusCode
	}
	return 0
}

// skipReason names why the hook repair passed a row by, without the error's
// text.
func skipReason(err error) string {
	switch {
	case errors.Is(err, sourcecontrol.ErrAEStudioAbsent):
		return "ae_studio_absent"
	case errors.Is(err, sourcecontrol.ErrAEStudioUnavailable):
		return "ae_studio_unavailable"
	case errors.Is(err, sourcecontrol.ErrAEStudioMisconfigured):
		return "ae_studio_misconfigured"
	case errors.Is(err, sourcecontrol.ErrOwnerNotAllowed):
		return "owner_not_allowed"
	case errors.Is(err, sourcecontrol.ErrRepoNotFound),
		sourcecontrol.IsHTTPStatus(err, http.StatusNotFound),
		sourcecontrol.IsHTTPStatus(err, http.StatusGone):
		return "repo_not_found"
	case sourcecontrol.IsHTTPStatus(err, http.StatusUnauthorized):
		return "github_unauthorized"
	default:
		return "refused"
	}
}
