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

package gitrepo

import (
	"context"
	"fmt"

	"github.com/wso2/aep/aep-api/internal/credentials"
	"github.com/wso2/aep/aep-api/repositories"
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
}

// issueRepoResolver is the private capability webhookService borrows from the
// issue service: resolving a project's (owner, repo, credential) in one place.
// The production *issueService satisfies it. Storing the IssueService interface
// (rather than a lossy `issueSvc.(*issueService)` cast that silently yields nil
// and nil-derefs at request time) means Register reaches the resolver through a
// checked assertion — an impl that can't resolve fails loudly with an error, not
// a panic.
type issueRepoResolver interface {
	resolveRepoAndCredential(ctx context.Context, orgID, projectID string) (owner, repo string, cred credentials.Credential, err error)
}

type webhookService struct {
	repo             repositories.RepoRepository
	github           WebhookOps
	repoSvc          RepoService
	issue            IssueService
	deliveryURL      string
	hmacSecret       string
	subscribedEvents []string
}

func NewWebhookService(
	repo repositories.RepoRepository,
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
		// callback and are rejected by GitHub on repo webhooks (422).
		subscribedEvents: []string{
			"pull_request",
			"push",
			"issue_comment",
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
	if cred.WebhookStrategy() == credentials.WebhookPlatform {
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

	if err := s.repoSvc.SetWebhookID(ctx, orgID, projectID, hookID); err != nil {
		return nil, fmt.Errorf("persist webhook id: %w", err)
	}
	return &hookID, nil
}
