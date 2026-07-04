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

// Package genai is the BFF's unified LLM turn surface
// (docs/design/agents-generation-migration.md §11, §12.2). One endpoint —
// POST .../conversations/{id}/turns — fronts a per-use-case context assembler:
// it namespaces the conversation id into the authenticated tenant scope, gates
// design generation on an approved requirements version, filters the FE
// snapshot to agent-authored file types, pushes the right skills + steering,
// resolves the org Anthropic key, and streams the agents service's raw
// StreamPart frames back verbatim. The BFF injects no frames and folds nothing.
package genai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"

	"github.com/wso2/aep/aep-api/internal/clients/agentsvc"
	"github.com/wso2/aep/aep-api/internal/credentials"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/models"
)

// Valid use cases (the FE-supplied "useCase" field).
const (
	useCaseRequirementsGenerate = "requirements-generate"
	useCaseRequirementsChat     = "requirements-chat"
	useCaseDesignGenerate       = "design-generate"
)

var validUseCases = map[string]bool{
	useCaseRequirementsGenerate: true,
	useCaseRequirementsChat:     true,
	useCaseDesignGenerate:       true,
}

// Errors — pre-stream, mapped to HTTP status by the huma layer.
var (
	ErrProjectRepoNotFound     = errors.New("project repository not found")
	ErrInvalidUseCase          = errors.New("invalid use case")
	ErrInvalidConversationID   = errors.New("invalid conversation id")
	ErrNoAnthropicKey          = errors.New("organization has no Anthropic API key configured")
	ErrRequirementsNotApproved = errors.New("design generation requires an approved (tagged) requirements version")
	ErrConversationNotFound    = errors.New("conversation not found")
)

// conversationIDPattern bounds the FE-chosen id to a safe shape. A "--"
// substring is additionally rejected (see validConversationID) so the FE can
// never inject the namespace separator and escape its tenant scope.
var conversationIDPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,200}$`)

// ---- ports -----------------------------------------------------------------

// RepoResolver looks up the project's git repo row (its OrgID/ProjectID are the
// authenticated tenant scope woven into the namespaced conversation id).
type RepoResolver interface {
	GetRepo(ctx context.Context, orgID, projectID string) (*models.GitRepository, error)
}

// GitReader is the read-only git-object surface + credential resolver used to
// read the approved requirements bundle at its tag for design generation.
type GitReader interface {
	GitData() gitrepo.GitData
	Resolver() credentials.Resolver
}

// AnthropicKeyResolver resolves the effective org Anthropic key. An empty key
// with a nil error means "org has none" → the service raises ErrNoAnthropicKey
// pre-stream (no platform fallback). Wired from AnthropicCredentialService.
type AnthropicKeyResolver func(ctx context.Context, orgID string) (string, error)

// OrgSkillSource returns the org's auxiliary (non-core) skills to ride along in
// every turn. Wired from the org-skills store; nil is allowed (no aux skills).
type OrgSkillSource func(ctx context.Context, orgID string) ([]agentsvc.Skill, error)

// TurnClient is the agents-service turn/rehydrate client. *agentsvc.client
// satisfies it.
type TurnClient interface {
	Turn(ctx context.Context, conversationID, orgID, anthropicKey string, req agentsvc.TurnRequest) (io.ReadCloser, error)
	GetConversation(ctx context.Context, conversationID, orgID string) (json.RawMessage, error)
}

// ---- input -----------------------------------------------------------------

// TurnInput is the assembled turn request (conversationId from the path, the
// rest from the body).
type TurnInput struct {
	UseCase                string
	ConversationID         string
	Instruction            string
	Files                  map[string]string
	FilesChangedExternally bool
	Target                 string
}

// ---- service ---------------------------------------------------------------

// GenAIService is the typed entry point behind the turn/rehydrate endpoints.
type GenAIService interface {
	// Turn assembles per-use-case context and starts the upstream turn. On
	// success it returns the raw SSE body for verbatim passthrough (caller
	// closes). Pre-stream failures are typed errors / *agentsvc.UpstreamError.
	Turn(ctx context.Context, orgID, projectID string, in TurnInput) (io.ReadCloser, error)
	// Rehydrate returns the chat conversation's messages JSON (chat only).
	Rehydrate(ctx context.Context, orgID, projectID, conversationID string) (json.RawMessage, error)
}

type service struct {
	repos     RepoResolver
	git       GitReader
	keys      AnthropicKeyResolver
	orgSkills OrgSkillSource
	client    TurnClient
}

// NewService wires the genai service. orgSkills may be nil (no auxiliary org
// skills); the rest are required for a functioning turn.
func NewService(repos RepoResolver, git GitReader, keys AnthropicKeyResolver, orgSkills OrgSkillSource, client TurnClient) GenAIService {
	return &service{repos: repos, git: git, keys: keys, orgSkills: orgSkills, client: client}
}

func (s *service) Turn(ctx context.Context, orgID, projectID string, in TurnInput) (io.ReadCloser, error) {
	if !validUseCases[in.UseCase] {
		return nil, ErrInvalidUseCase
	}
	if !validConversationID(in.ConversationID) {
		return nil, ErrInvalidConversationID
	}
	repo, err := s.resolveRepo(ctx, orgID, projectID)
	if err != nil {
		return nil, err
	}
	convID := namespacedID(repo, in.UseCase, in.ConversationID)

	snapshot := filterSnapshot(in.Files)
	if in.UseCase == useCaseDesignGenerate {
		snapshot, err = s.mergeApprovedRequirements(ctx, orgID, repo, snapshot)
		if err != nil {
			return nil, err
		}
	}

	skills, err := s.assembleSkills(ctx, orgID, in.UseCase)
	if err != nil {
		return nil, err
	}

	key, err := s.resolveKey(ctx, orgID)
	if err != nil {
		return nil, err
	}

	req := agentsvc.TurnRequest{
		Instruction:            in.Instruction + steeringByUseCase[in.UseCase] + targetSuffix(in.Target),
		Files:                  snapshot,
		FilesChangedExternally: in.FilesChangedExternally,
		Skills:                 skills,
	}
	return s.client.Turn(ctx, convID, orgID, key, req)
}

func (s *service) Rehydrate(ctx context.Context, orgID, projectID, conversationID string) (json.RawMessage, error) {
	if !validConversationID(conversationID) {
		return nil, ErrInvalidConversationID
	}
	repo, err := s.resolveRepo(ctx, orgID, projectID)
	if err != nil {
		return nil, err
	}
	// Rehydrate is chat-only (single-turn generate flows never rehydrate), so
	// the namespaced id is reconstructed under the requirements-chat use case.
	convID := namespacedID(repo, useCaseRequirementsChat, conversationID)
	raw, err := s.client.GetConversation(ctx, convID, orgID)
	if err != nil {
		var ue *agentsvc.UpstreamError
		if errors.As(err, &ue) && ue.StatusCode == 404 {
			return nil, ErrConversationNotFound
		}
		return nil, err
	}
	return raw, nil
}

func (s *service) resolveRepo(ctx context.Context, orgID, projectID string) (*models.GitRepository, error) {
	if s == nil || s.repos == nil {
		return nil, ErrProjectRepoNotFound
	}
	repo, err := s.repos.GetRepo(ctx, orgID, projectID)
	if err != nil {
		if errors.Is(err, gitrepo.ErrRepoNotFound) {
			return nil, ErrProjectRepoNotFound
		}
		return nil, fmt.Errorf("resolve project repo: %w", err)
	}
	if repo == nil {
		return nil, ErrProjectRepoNotFound
	}
	return repo, nil
}

func (s *service) resolveKey(ctx context.Context, orgID string) (string, error) {
	if s.keys == nil {
		return "", ErrNoAnthropicKey
	}
	key, err := s.keys(ctx, orgID)
	if err != nil {
		return "", fmt.Errorf("resolve anthropic key: %w", err)
	}
	if key == "" {
		return "", ErrNoAnthropicKey
	}
	return key, nil
}

// assembleSkills pushes the use case's core flow skills plus the org's
// auxiliary skills. Core wins on a name clash — orgs cannot override core flow
// skills in v1 (§2).
func (s *service) assembleSkills(ctx context.Context, orgID, useCase string) ([]agentsvc.Skill, error) {
	core, err := coreSkillsFor(useCase)
	if err != nil {
		return nil, err
	}
	out := make([]agentsvc.Skill, 0, len(core))
	seen := map[string]bool{}
	for _, sk := range core {
		out = append(out, sk)
		seen[sk.Name] = true
	}
	if s.orgSkills != nil {
		aux, err := s.orgSkills(ctx, orgID)
		if err != nil {
			return nil, fmt.Errorf("resolve org skills: %w", err)
		}
		for _, sk := range aux {
			if seen[sk.Name] {
				continue
			}
			out = append(out, sk)
			seen[sk.Name] = true
		}
	}
	return out, nil
}

// ---- pure helpers ----------------------------------------------------------

// validConversationID enforces the safe shape and rejects the namespace
// separator so a crafted id cannot escape the tenant scope.
func validConversationID(id string) bool {
	return conversationIDPattern.MatchString(id) && !strings.Contains(id, "--")
}

// namespacedID weaves the authenticated tenant scope + use case into the
// service-side id: org_{orgId}--proj_{projectId}--{useCase}--{uuid}. The FE
// never sees this; a turn/rehydrate outside the scope maps to a different id
// (isolated by construction).
func namespacedID(repo *models.GitRepository, useCase, uuid string) string {
	return "org_" + repo.OrgID + "--proj_" + repo.ProjectID + "--" + useCase + "--" + uuid
}

// filterSnapshot keeps only agent-authored file types — markdown, DSL sources,
// and component design.json — and drops derived artifacts (.excalidraw scenes,
// *.gen.json projections), mirroring the playground's readSnapshot exclusions
// (§6). Derived files are FE-computed post-fold and committed via files/apply,
// but never re-inlined into a turn snapshot.
func filterSnapshot(files map[string]string) map[string]string {
	out := map[string]string{}
	for p, c := range files {
		if keepInSnapshot(p) {
			out[p] = c
		}
	}
	return out
}

func keepInSnapshot(path string) bool {
	if strings.HasSuffix(path, ".md") || strings.HasSuffix(path, ".dsl") {
		return true
	}
	// Component design.json (structured facts) — but never *.gen.json projections.
	if strings.HasSuffix(path, "/design.json") || path == "design.json" {
		return true
	}
	return false
}

func targetSuffix(target string) string {
	if strings.TrimSpace(target) == "" {
		return ""
	}
	return "\n\n(target: " + target + ")"
}
