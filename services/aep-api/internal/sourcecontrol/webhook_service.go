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

package sourcecontrol

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
)

// WebhookService manages the per-repo webhook that delivers a project's
// GitHub events to its org's AE Studio pod. The pod owns the delivery URL and
// the signing secret; this service only asks for the hook and remembers its
// ID on the repo row.
type WebhookService interface {
	// Register ensures the webhook on the project's repo carries the pod's
	// current config and the subscribed events, and persists its hook ID and
	// config rev. Idempotent: the stored hook is reconfigured in place
	// (created again when GitHub no longer has it); a row with none adopts
	// the hook to the pod's URL, else gets a new one.
	Register(ctx context.Context, orgID, projectID string) (hookID *int64, err error)

	// Unregister removes the hook Register installed, addressed by the hook ID
	// persisted on the repo row. It is the project teardown's counterpart to
	// Register and is total: a project with no repo row, no stored hook, or a
	// hook GitHub no longer has all resolve to "nothing to remove" and return
	// nil. Only a live failure to reach the pod or GitHub is an error, and even
	// that is best-effort at the call site — the delete is never blocked by
	// webhook cleanup. The row keeps the id: the project delete drops the
	// row next, and a disconnect forgets the org's ids with ForgetOrg.
	Unregister(ctx context.Context, orgID, projectID string) error

	// UnregisterOrg unregisters the hook of every repository row the org has
	// (the gitpat disconnect). One row's failure does not stop the
	// others; the failures are returned joined.
	UnregisterOrg(ctx context.Context, orgID string) error

	// ForgetOrg clears the hook id of every row of the org (the gitpat
	// disconnect, after its pod is gone): a reconnect's hook repair then
	// installs a hook for each, whether or not UnregisterOrg reached it.
	ForgetOrg(ctx context.Context, orgID string) error

	// HookRev answers the config rev a hook of the org ensured now is stored
	// at: the org pod's config rev (its delivery URL and signing secret)
	// folded with the subscribed events. One pod call, no GitHub call. A
	// stored rev that differs names a hook to re-ensure.
	HookRev(ctx context.Context, orgID string) (string, error)

	// ResyncOrg forgets the config rev of every row of the org, keeping the
	// hook ids (a GitHub reconnect): the hook repair then re-ensures every
	// stored hook in place with the pod's current config.
	ResyncOrg(ctx context.Context, orgID string) error
}

// subscribedEvents answers the events every project hook carries. Repo-level
// webhooks only — App-installation events like installation_repositories are
// rejected by GitHub on repo webhooks (422). "issues" joins the set for the
// tasks-github-native model (§9.2): task birth, command labels, block
// validation/repair, close/reopen. The pod refuses any other event. A fresh
// slice per call, so no port implementation can alter the next caller's set.
func subscribedEvents() []string {
	return []string{"pull_request", "push", "issue_comment", "issues"}
}

type webhookService struct {
	repo    RepoRepository
	github  WebhookOps
	repoSvc RepoService
}

func NewWebhookService(repo RepoRepository, github WebhookOps, repoSvc RepoService) WebhookService {
	return &webhookService{repo: repo, github: github, repoSvc: repoSvc}
}

func (s *webhookService) Register(ctx context.Context, orgID, projectID string) (*int64, error) {
	ref, row, err := RepoRefFor(ctx, s.repo, orgID, projectID)
	if err != nil {
		return nil, err
	}
	if row.Status != RepoStatusReady {
		// Its project's delete has started: no hook is installed for it.
		return nil, ErrRepoNotFound
	}

	// One ensure: the stored hook (else the one to the pod's URL) has its
	// whole config and events replaced in the same call, so a hook left on
	// an old relay channel or signed with an old secret is re-pointed and
	// re-keyed in place, and one GitHub lost is created again.
	var storedID int64
	if row.WebhookID != nil {
		storedID = *row.WebhookID
	}
	hook, err := s.github.RegisterWebhook(ctx, ref, storedID, subscribedEvents())
	if err != nil {
		return nil, fmt.Errorf("register webhook: %w", err)
	}
	hookID := hook.ID

	if err := s.repoSvc.SetWebhookID(ctx, orgID, projectID, hookID, hookRev(hook.ConfigRev)); err != nil {
		if errors.Is(err, ErrRepoNotFound) {
			// The row went (or its project's delete started) while the hook
			// was being installed: nothing will ever name this hook again,
			// so it is removed now rather than left posting for a project
			// the platform is forgetting.
			if derr := s.github.DeleteWebhook(ctx, ref, hookID); derr != nil {
				slog.WarnContext(ctx, "webhook.orphan_left", "org", orgID, "project", projectID, "hookId", hookID, "error", derr)
			}
		}
		return nil, fmt.Errorf("persist webhook id: %w", err)
	}
	return &hookID, nil
}

// Unregister removes the hook Register installed. See the interface for the
// contract; the shape below is Register's, run backwards.
//
// It must be called BEFORE the repo row is deleted: the row carries both the
// hook ID and the repo identity, and once it is gone the platform has no way
// left to name the hook it created.
func (s *webhookService) Unregister(ctx context.Context, orgID, projectID string) error {
	// The hook ID is the whole point: it is what makes this removal precise. A
	// project that never registered one — a failed registration, a repo
	// provisioned before hooks existed — has nothing of ours on the repo to
	// remove.
	repo, err := s.repoSvc.GetRepo(ctx, orgID, projectID)
	if err != nil {
		if errors.Is(err, ErrRepoNotFound) {
			return nil
		}
		return fmt.Errorf("get repo: %w", err)
	}
	if repo == nil || repo.WebhookID == nil {
		return nil
	}
	ref, err := RefForRow(orgID, repo)
	if err != nil {
		return err
	}

	hookID := *repo.WebhookID
	if err := s.github.DeleteWebhook(ctx, ref, hookID); err != nil {
		return fmt.Errorf("delete webhook: %w", err)
	}
	slog.InfoContext(ctx, "webhook unregistered from repo",
		"org", orgID, "project", projectID, "hookId", hookID)
	return nil
}

func (s *webhookService) HookRev(ctx context.Context, orgID string) (string, error) {
	rev, err := s.github.HookConfigRev(ctx, orgID)
	if err != nil {
		return "", fmt.Errorf("read hook config rev: %w", err)
	}
	return hookRev(rev), nil
}

// hookRev folds the pod's config rev with the subscribed events: the rev a
// row stores for its hook, so a change of either re-syncs the hook.
func hookRev(podRev string) string {
	sum := sha256.Sum256([]byte(podRev + "\n" + strings.Join(subscribedEvents(), ",")))
	return hex.EncodeToString(sum[:8])
}

func (s *webhookService) ResyncOrg(ctx context.Context, orgID string) error {
	if err := s.repo.ClearWebhookConfigRevs(ctx, orgID); err != nil {
		return fmt.Errorf("clear org webhook revs: %w", err)
	}
	return nil
}

func (s *webhookService) ForgetOrg(ctx context.Context, orgID string) error {
	if err := s.repo.ClearWebhookIDs(ctx, orgID); err != nil {
		return fmt.Errorf("clear org webhook ids: %w", err)
	}
	return nil
}

func (s *webhookService) UnregisterOrg(ctx context.Context, orgID string) error {
	rows, err := s.repo.ListByOrg(ctx, orgID)
	if err != nil {
		return fmt.Errorf("list org repos: %w", err)
	}
	var errs []error
	for i := range rows {
		if rows[i].WebhookID == nil {
			continue
		}
		if uerr := s.Unregister(ctx, orgID, rows[i].ProjectID); uerr != nil {
			errs = append(errs, fmt.Errorf("project %s: %w", rows[i].ProjectID, uerr))
		}
	}
	return errors.Join(errs...)
}
