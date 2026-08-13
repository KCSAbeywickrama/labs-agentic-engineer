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
	"errors"
	"fmt"
	"log/slog"

	"github.com/wso2/aep/aep-api/internal/platform/secrets"
)

// WebhookService manages per-repo webhook registration on GitHub.
//
// PAT credentials carry WebhookStrategy WebhookPerRepo and get a per-repo
// hook. App-installation credentials carry WebhookPlatform and skip per-repo
// registration entirely, because the App's configured callback already
// handles delivery for every install.
//
// Callers dispatch the strategy without inspecting the kind — see Register's
// short-circuit on WebhookPlatform.
type WebhookService interface {
	// Register installs a webhook on the repo. No-op when the credential's
	// strategy is WebhookPlatform. Idempotent on (repo, deliveryURL).
	Register(ctx context.Context, orgID, projectID string) (hookID *int64, err error)

	// Unregister removes the hook Register installed, addressed by the hook ID
	// persisted on the repo row. It is the project teardown's counterpart to
	// Register and is total: a project with no repo row, no stored hook, a
	// platform-strategy credential, or a hook GitHub no longer has all resolve to
	// "nothing to remove" and return nil. Only a live failure to reach GitHub is
	// an error, and even that is best-effort at the call site — the delete is
	// never blocked by webhook cleanup.
	Unregister(ctx context.Context, orgID, projectID string) error
}

// issueRepoResolver is the private capability webhookService borrows from the
// issue service: resolving a project's (owner, repo, credential) in one place.
// The production *issueService satisfies it. Storing the IssueService interface
// (rather than a lossy `issueSvc.(*issueService)` cast that silently yields nil
// and nil-derefs at request time) means Register reaches the resolver through a
// checked assertion — an impl that can't resolve fails loudly with an error, not
// a panic.
type issueRepoResolver interface {
	resolveRepoAndCredential(ctx context.Context, orgID, projectID string) (owner, repo string, cred secrets.Credential, err error)
}

type webhookService struct {
	repo             RepoRepository
	github           WebhookOps
	repoSvc          RepoService
	issue            IssueService
	deliveryURL      string
	hmacSecret       string
	subscribedEvents []string
}

func NewWebhookService(
	repo RepoRepository,
	github WebhookOps,
	repoSvc RepoService,
	issueSvc IssueService,
	deliveryURL, hmacSecret string,
) WebhookService {
	return &webhookService{
		repo:        repo,
		github:      github,
		repoSvc:     repoSvc,
		issue:       issueSvc,
		deliveryURL: deliveryURL,
		hmacSecret:  hmacSecret,
		// Events subscribed to. Repo-level webhooks only — App-installation
		// events like installation_repositories are scoped to the App's own
		// callback and are rejected by GitHub on repo webhooks (422). "issues"
		// joins the set for the tasks-github-native model (§9.2): task birth,
		// command labels, block validation/repair, close/reopen.
		subscribedEvents: []string{
			"pull_request",
			"push",
			"issue_comment",
			"issues",
		},
	}
}

func (s *webhookService) Register(ctx context.Context, orgID, projectID string) (*int64, error) {
	if s.deliveryURL == "" || s.hmacSecret == "" {
		return nil, fmt.Errorf("webhook delivery URL or HMAC secret not configured — set GITHUB_WEBHOOK_DELIVERY_URL and GITHUB_WEBHOOK_SECRET")
	}

	resolver, ok := s.issue.(issueRepoResolver)
	if !ok {
		return nil, fmt.Errorf("webhook: issue service %T cannot resolve repo credentials", s.issue)
	}
	owner, repoName, cred, err := resolver.resolveRepoAndCredential(ctx, orgID, projectID)
	if err != nil {
		return nil, err
	}

	// App-mode short-circuit: platform-level delivery, no per-repo
	// registration. Platform-PAT credentials always return WebhookPerRepo.
	if cred.WebhookStrategy() == secrets.WebhookPlatform {
		return nil, nil
	}

	hookID, err := s.github.RegisterWebhook(
		ctx, owner, repoName, cred,
		s.deliveryURL, s.hmacSecret,
		s.subscribedEvents,
	)
	if err != nil {
		return nil, fmt.Errorf("register webhook: %w", err)
	}

	// Reconcile the event list on the hook. RegisterWebhook's already-exists
	// path returns a pre-existing hook WITHOUT updating its events, so a hook
	// created before "issues" joined the subscription would never receive
	// issue deliveries. PATCHing the events every register makes cutover
	// idempotent (§9.2). Best-effort: a reconcile failure must not block a
	// successful registration.
	if patchErr := s.github.UpdateWebhookEvents(ctx, owner, repoName, cred, hookID, s.subscribedEvents); patchErr != nil {
		slog.WarnContext(ctx, "reconcile webhook events failed", "project", projectID, "hookId", hookID, "error", patchErr)
	}

	if err := s.repoSvc.SetWebhookID(ctx, orgID, projectID, hookID); err != nil {
		return nil, fmt.Errorf("persist webhook id: %w", err)
	}
	return &hookID, nil
}

// Unregister removes the hook Register installed. See the interface for the
// contract; the shape below is Register's, run backwards.
//
// It must be called BEFORE the repo row is deleted: the row carries both the
// hook ID and the repo identity the credential resolves against, and once it is
// gone the platform has no way left to name the hook it created.
func (s *webhookService) Unregister(ctx context.Context, orgID, projectID string) error {
	// The hook ID is the whole point: it is what makes this removal precise. A
	// project that never registered one — App-mode delivery, a failed
	// registration, a repo provisioned before hooks existed — has nothing of ours
	// on the repo to remove.
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

	resolver, ok := s.issue.(issueRepoResolver)
	if !ok {
		return fmt.Errorf("webhook: issue service %T cannot resolve repo credentials", s.issue)
	}
	owner, repoName, cred, err := resolver.resolveRepoAndCredential(ctx, orgID, projectID)
	if err != nil {
		return err
	}

	// Same short-circuit as Register, and for the same reason: under App-mode
	// delivery no per-repo hook was ever installed, so there is none to remove.
	if cred.WebhookStrategy() == secrets.WebhookPlatform {
		return nil
	}

	if err := s.github.DeleteWebhook(ctx, owner, repoName, cred, *repo.WebhookID); err != nil {
		return fmt.Errorf("delete webhook: %w", err)
	}
	slog.InfoContext(ctx, "webhook unregistered from repo",
		"org", orgID, "project", projectID, "hookId", *repo.WebhookID)
	return nil
}
