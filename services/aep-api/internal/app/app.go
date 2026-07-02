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

// Package app is the composition root: it assembles the entire service graph
// (HTTP handler + background watchers) from config + an open DB, and owns the
// imperative first-boot steps (Bootstrap) main runs before serving. It lives
// under internal/ — not package main — so a component test can import it and
// assemble the same real handler with faked deps (the harness IS Build).
package app

import (
	"context"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/wso2/aep/aep-api/internal/api"
	"github.com/wso2/aep/aep-api/internal/clients/agents"
	"github.com/wso2/aep/aep-api/internal/clients/clustergatewayproxy"
	githubclient "github.com/wso2/aep/aep-api/internal/clients/github"
	k8sclient "github.com/wso2/aep/aep-api/internal/clients/k8s"
	"github.com/wso2/aep/aep-api/internal/clients/oauth"
	"github.com/wso2/aep/aep-api/internal/clients/observability"
	"github.com/wso2/aep/aep-api/internal/clients/observer"
	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/clients/secretmanagersvc"
	"github.com/wso2/aep/aep-api/internal/clients/secretmanagersvc/providers/secretmanagerapi"
	"github.com/wso2/aep/aep-api/internal/clients/thundersvc"
	"github.com/wso2/aep/aep-api/internal/config"
	"github.com/wso2/aep/aep-api/internal/contracts"
	"github.com/wso2/aep/aep-api/internal/credentials"
	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/internal/feature/codingagent"
	"github.com/wso2/aep/aep-api/internal/feature/component"
	"github.com/wso2/aep/aep-api/internal/feature/design"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/feature/idp"
	"github.com/wso2/aep/aep-api/internal/feature/organization"
	"github.com/wso2/aep/aep-api/internal/feature/orgcreds"
	"github.com/wso2/aep/aep-api/internal/feature/project"
	"github.com/wso2/aep/aep-api/internal/feature/requirements"
	"github.com/wso2/aep/aep-api/internal/feature/runtimeconfig"
	"github.com/wso2/aep/aep-api/internal/feature/skills"
	"github.com/wso2/aep/aep-api/internal/feature/task"
	"github.com/wso2/aep/aep-api/internal/feature/webhook"
	authn "github.com/wso2/aep/aep-api/internal/platform/auth"
	"github.com/wso2/aep/aep-api/internal/platform/auth/jwtassertion"
	"github.com/wso2/aep/aep-api/internal/seed"
	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
	"gorm.io/gorm"
)

// Watcher is a long-running background loop. Every watcher blocks on its
// context and returns nothing; main starts each in its own goroutine and
// cancels the shared context on shutdown.
type Watcher interface {
	Run(ctx context.Context)
}

// App is the assembled service graph: the HTTP handler plus the background
// watchers to launch. Bootstrap side effects (migrations, grants) already ran
// before Build; App holds only what main needs to serve and to shut down.
type App struct {
	Handler  http.Handler
	Watchers []Watcher
}

// Build wires the entire service graph from config + an open DB and returns
// the HTTP handler + background watchers. It performs NO process-lifecycle work
// (no os.Exit, no signal handling, no migrations) — every failure is returned —
// so a component test can assemble the same real handler with faked deps.
// Wiring order is load-bearing: several constructors read the value a prior one
// produced; the comments call out the couplings.
func Build(cfg config.Config, db *gorm.DB) (*App, error) {
	var err error

	if mkErr := os.MkdirAll(cfg.RepoBasePath, 0o755); mkErr != nil {
		return nil, fmt.Errorf("create repo base path %q: %w", cfg.RepoBasePath, mkErr)
	}

	// Skills are repo-backed now (one private org-skills repo per org —
	// docs/design/skills-repo-storage.md). The store needs gitOpsService +
	// repoService, so it is constructed below once those exist. No startup
	// bootstrap: built-ins seed/reconcile into each org's repo on demand.

	// Repositories
	taskRepo := repositories.NewTaskRepository(db)
	configRepo := repositories.NewConfigRepository(db)
	repoRepo := repositories.NewRepoRepository(db)

	// Token provider for service-to-service auth. OC authorizes requests by
	// the service client subject (aep-api-client), so every OC API call
	// must carry this token rather than the end-user's token.
	var tokenProvider *oauth.TokenProvider
	if cfg.ServiceAuth.TokenURL != "" && cfg.ServiceAuth.ClientID != "" {
		tokenProvider = oauth.NewTokenProvider(
			cfg.ServiceAuth.TokenURL,
			cfg.ServiceAuth.ClientID,
			cfg.ServiceAuth.ClientSecret,
			cfg.ServiceAuth.HostHeader,
		)
		slog.Info("Service auth configured", "tokenURL", cfg.ServiceAuth.TokenURL, "clientID", cfg.ServiceAuth.ClientID)
	}

	// orgUUIDResolver maps an OC namespace (the org handle the BFF puts in the
	// request URL) to the org's UUID, for the X-Impersonate-Org header on M2M
	// OC calls. Reads the local organizations side-car; prefers the
	// Thunder-issued ouId.
	orgUUIDResolver := func(ctx context.Context, namespace string) (string, error) {
		// Authoritative path: a user-initiated request carries the caller's
		// Thunder org UUID in the JWT (ouId). When the JWT's handle matches the
		// namespace we're about to impersonate, use ouId directly — no DB
		// dependency, and it's the same value Thunder embeds. Async paths
		// (webhooks, watchers) have no JWT and fall through to the side-car.
		if claims := authn.ClaimsFromContext(ctx); claims != nil && claims.OuId != "" && authn.ResolveOuHandle(claims) == namespace {
			return claims.OuId, nil
		}
		// Side-car path: the organizations row is keyed by the org handle (the
		// same value the BFF puts in OC URLs). orgensure backfills it with the
		// Thunder UUID on the first authed request from the org.
		var org models.Organization
		if err := db.WithContext(ctx).Where("name = ?", namespace).First(&org).Error; err != nil {
			return "", fmt.Errorf("resolve impersonation org for namespace %q: %w", namespace, err)
		}
		if org.ThunderOrgUUID != nil {
			return org.ThunderOrgUUID.String(), nil
		}
		return org.UUID.String(), nil
	}

	// OpenChoreo clients. Each one resolves the OC namespace as the OC
	// org handle directly (== ouHandle); there is no override map. Migrated
	// clients (namespace, project) take an openchoreo.Config; the still-hand-
	// rolled clients (component, secretref) keep the legacy positional args
	// until they migrate too.
	ocConfig := openchoreo.Config{
		BaseURL:                cfg.PlatformAPI.BaseURL,
		HostHeader:             cfg.PlatformAPI.HostHeader,
		AuthProvider:           tokenProvider,
		ImpersonateOrgResolver: orgUUIDResolver,
	}
	projectClient := openchoreo.NewProjectClient(ocConfig)
	namespaceClient := openchoreo.NewNamespaceClient(ocConfig)
	componentClient := openchoreo.NewComponentClient(ocConfig)
	// GitSecret client lands the per-org build git credential on the workflow
	// plane (via OC → OpenBao → SecretReference). Used by BuildCredentialsService
	// for both cloud (CP/WP split) and local k3d — one unified path.
	gitSecretClient := openchoreo.NewGitSecretClient(ocConfig)

	// Observability client (optional — build logs disabled when URL not set)
	var observClient observability.Client
	if cfg.Observability.BaseURL != "" {
		observClient = observability.NewClient(cfg.Observability.BaseURL)
		slog.Info("Observability API", "baseURL", cfg.Observability.BaseURL)
	}

	// Observer client for /progress/* — Thunder client_credentials against
	// the platform-default reader app. Falls back to nil (and 503 on the
	// route) if any of the OAuth params are missing.
	var observerTokenProvider *oauth.TokenProvider
	var observerClient observer.Client
	if cfg.Observability.BaseURL != "" && cfg.Observability.TokenURL != "" && cfg.Observability.ClientID != "" {
		observerTokenProvider = oauth.NewTokenProvider(
			cfg.Observability.TokenURL,
			cfg.Observability.ClientID,
			cfg.Observability.ClientSecret,
			cfg.Observability.HostHeader,
		)
		observerClient, err = observer.NewClient(observer.Config{
			BaseURL:       cfg.Observability.BaseURL,
			TokenProvider: observerTokenProvider,
		})
		if err != nil {
			slog.Error("Observer client init failed", "error", err)
		} else if observerClient != nil {
			slog.Info("Observer client configured", "baseURL", cfg.Observability.BaseURL, "clientID", cfg.Observability.ClientID)
		}
	} else {
		slog.Warn("Observer client not configured — /progress/* will return 503 progress_unavailable")
	}

	// The agents-service client is constructed below (after the Anthropic
	// credential service — it needs the in-process key resolver). Outbound
	// agents calls no longer use a Thunder client_credentials provider: each
	// call carries a per-call BFF-signed identity JWT (org in the ocOrgId
	// claim), minted by taskTokens. See agents.NewClient below.
	slog.Info("Agents service", "baseURL", cfg.AgentsService.BaseURL)

	// SM-API provider (ADR-0002). Same provider in local + cloud: local
	// SM-API runs in the docker-compose stack, cloud SM-API is reached at
	// its public DNS. When SECRET_MANAGER_API_URL is empty the provider is
	// not constructed and downstream callers handle the absence.
	var smClient secretmanagersvc.SecretManagementClient
	if cfg.SecretManagerAPIURL != "" {
		smProvider := secretmanagerapi.NewProvider(secretmanagerapi.Config{
			BaseURL: cfg.SecretManagerAPIURL,
			Timeout: cfg.SecretManagerAPITimeout,
		})
		smClient, err = secretmanagersvc.NewSecretManagementClient(&secretmanagersvc.StoreConfig{
			Provider: secretmanagerapi.ProviderName,
		}, smProvider)
		if err != nil {
			return nil, fmt.Errorf("sm-api client init: %w", err)
		}
		slog.Info("sm-api client", "baseURL", cfg.SecretManagerAPIURL, "timeout", cfg.SecretManagerAPITimeout)
	} else {
		slog.Warn("SECRET_MANAGER_API_URL not set — Phase 1 secret writes disabled")
	}
	_ = smClient // consumed via smWriter below.

	// SM-API mirror writer. Constructed ahead of the credential / IDP service
	// constructors so all consumers can attach via WithSMAPIWriter (the no-op
	// case when smClient is nil is fine).
	smWriter := orgcreds.NewSMAPIWriter(smClient, db)

	// cluster-gateway-proxy client. Same shape as
	// wso2cloud/backend/core/internal/ou's cpapi: no Authorization header,
	// X-Correlation-ID-only tracing. When the URL is empty the client is not
	// constructed and the proxy dispatch path short-circuits to the legacy
	// ClusterWorkflow path.
	var cgwClient *clustergatewayproxy.Client
	if cfg.ClusterGatewayProxyURL != "" {
		cgwCfg := clustergatewayproxy.Config{BaseURL: cfg.ClusterGatewayProxyURL}
		// The cloud cluster-gateway-proxy validates platform-idp JWTs; send the
		// BFF's M2M service token (same provider as the OC client). Left nil for
		// local k3d (no tokenProvider), where the proxy is unauthenticated.
		if tokenProvider != nil {
			cgwCfg.AuthProvider = tokenProvider
		}
		cgwClient = clustergatewayproxy.New(cgwCfg)
		slog.Info("cluster-gateway-proxy client", "baseURL", cfg.ClusterGatewayProxyURL, "authenticated", tokenProvider != nil)
	} else {
		slog.Warn("CLUSTER_GATEWAY_PROXY_URL not set — Phase 2 dispatch disabled")
	}
	// Construct the coding-agent dispatcher when the proxy client is present.
	// nil-safe at the call-site (dispatch_service falls back to the legacy
	// ClusterWorkflow path).
	var codingAgentDispatcher *codingagent.Dispatcher
	if cgwClient != nil {
		codingAgentDispatcher = codingagent.New(cgwClient)
	}

	// Credentials + git-service services and controllers.
	credKey, err := base64.StdEncoding.DecodeString(cfg.CredentialEncryptionKey)
	if err != nil || len(credKey) != 32 {
		// config.Validate guarantees this decodes to 32 bytes; kept as defense.
		return nil, fmt.Errorf("CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key: %w", err)
	}
	credStore, err := credentials.NewDBStore(db, credKey)
	if err != nil {
		return nil, fmt.Errorf("credential store init: %w", err)
	}
	slog.Info("credential store: postgres (aes-256-gcm)")

	wpClient, err := k8sclient.NewInClusterClient()
	if err != nil {
		slog.Warn("k8s client init failed — mint-build will skip Secret writes; builds will fail at clone", "error", err)
		wpClient = nil
	}

	// App-token minter — best-effort App-key load. With no App key the minter
	// answers in no-app mode; the connect surface lights up the App path
	// lazily on first use.
	loadCtx, cancelLoad := context.WithTimeout(context.Background(), 10*time.Second)
	appKey, err := credentials.LoadAppKeyFromOpenBao(loadCtx, credStore)
	cancelLoad()
	if err != nil {
		slog.Warn("app key load failed; App-mode credentials will return ErrAppNotConfigured", "error", err)
		appKey = nil
	}
	minter, err := credentials.NewAppTokenMinter(appKey)
	if err != nil {
		return nil, fmt.Errorf("app token minter init: %w", err)
	}
	minter.WithOpenBao(credStore)

	// Dev-only app-platform seed (App private key + client_secret + webhook
	// HMAC). No-op outside DEPLOYMENT_TIER=dev.
	{
		c, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		if err := seed.AppPlatformFromEnv(c, credStore, cfg); err != nil {
			cancel()
			return nil, fmt.Errorf("app platform seed: %w", err)
		}
		cancel()
	}
	if appKey == nil {
		retryCtx, cancelRetry := context.WithTimeout(context.Background(), 10*time.Second)
		if reloaded, rerr := credentials.LoadAppKeyFromOpenBao(retryCtx, credStore); rerr == nil && reloaded != nil {
			cancelRetry()
			minter, err = credentials.NewAppTokenMinter(reloaded)
			if err != nil {
				return nil, fmt.Errorf("app token minter re-init: %w", err)
			}
			minter.WithOpenBao(credStore)
			slog.Info("github app loaded post-seed", "appId", reloaded.AppID)
		} else {
			cancelRetry()
		}
	}
	if minter.AppID() != 0 {
		idCtx, cancelID := context.WithTimeout(context.Background(), 10*time.Second)
		if err := minter.LoadAppBotIdentity(idCtx, "https://api.github.com"); err != nil {
			slog.Warn("app bot identity load failed; will retry on first connect", "error", err)
		}
		cancelID()
	}
	var appClientSecret string
	if minter.AppID() != 0 {
		csCtx, cancelCS := context.WithTimeout(context.Background(), 10*time.Second)
		if cs, err := minter.LoadAppClientSecret(csCtx); err != nil {
			slog.Warn("app oauth client_secret load failed; bind path disabled", "error", err)
		} else {
			appClientSecret = cs
		}
		cancelCS()
	}

	credResolver := credentials.NewOrgResolver(db, credStore, minter)

	// One git host, selected by GIT_PROVIDER, threaded into every gitrepo
	// domain service where it narrows to that service's capability port.
	gitHost, err := buildGitHost(cfg)
	if err != nil {
		return nil, err
	}
	repoService := gitrepo.NewRepoService(repoRepo, gitHost, credResolver, cfg.GitHubRepoVisibility, cfg.RepoBasePath)
	gitOpsService := gitrepo.NewGitOpsService(repoRepo, credResolver, cfg.RepoBasePath, gitHost)
	artifactSvcGit := artifacts.NewArtifactService(repoRepo, gitOpsService)
	issueService := gitrepo.NewIssueService(repoRepo, gitHost, gitHost, credResolver)
	gitOpsService.CleanupOrphanTmpClones()
	go func() {
		warmCtx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		warmed, failed := gitOpsService.PreWarmClones(warmCtx, 10)
		slog.Info("pre-warm complete", "warmed", warmed, "failed", failed)
	}()
	webhookRegService := gitrepo.NewWebhookService(repoRepo, gitHost, repoService, issueService, cfg.WebhookDeliveryURL, cfg.WebhookHMACSecret)
	credRefreshService := orgcreds.NewCredentialsRefreshService(credResolver)
	credService := orgcreds.NewCredentialService(db, credStore, minter, cfg.WebhookHMACSecret, cfg.GitHubAppClientID, appClientSecret, gitHost)
	buildCredService := orgcreds.NewBuildCredentialsService(repoRepo, credResolver, gitSecretClient)
	credService.WithBuildSecretCleaner(buildCredService)
	anthropicCredService := orgcreds.NewAnthropicCredentialService(db, credStore, wpClient)

	// Task JWT manager — RS256, 24h TTL. The public key is published on the
	// JWKS endpoint (/auth/external/jwks.json) and verified by both the runner
	// callbacks (inbound S2S) and agents-service (outbound S2S). Constructed
	// here, before the agents client, because that client uses it to mint the
	// per-call outbound identity token.
	var taskTokens *authn.TaskTokenManager
	if cfg.TaskTokenSigningKey != "" {
		mgr, err := authn.NewTaskTokenManager(authn.TaskTokenConfig{
			PrivateKey: cfg.TaskTokenSigningKey,
			Issuer:     cfg.TaskTokenIssuer,
			Audience:   cfg.TaskTokenAudience,
			TTL:        24 * time.Hour,
		})
		if err != nil {
			return nil, fmt.Errorf("task token manager init: %w", err)
		}
		taskTokens = mgr
		slog.Info("Task token manager", "kid", mgr.KeyID(), "issuer", cfg.TaskTokenIssuer, "audience", cfg.TaskTokenAudience)
	} else {
		slog.Warn("BFF_TASK_SIGNING_KEY not set — task dispatch will fail")
	}

	// Agents service client (AI SDK v6 — architect, tech-lead, requirements).
	// It resolves the per-org effective Anthropic key in-process (from the
	// gated, token-derived org) and forwards it as X-Anthropic-Key so
	// agents-service consumes it directly. Every call also carries a per-call
	// BFF-signed identity JWT (taskTokens) so agents derives org from a verified
	// claim, not a trusted header. agentsClient is first used just below
	// (requirements/design/task services).
	var agentsSigner agents.ServiceTokenSigner
	if taskTokens != nil {
		// Guard the typed-nil interface trap: only assign the concrete signer
		// when configured, so c.signer == nil holds in dev (no signing key).
		agentsSigner = taskTokens
	}
	agentsClient := agents.NewClient(cfg.AgentsService.BaseURL, agentsSigner,
		func(ctx context.Context, orgID string) (string, error) {
			res, err := anthropicCredService.EffectiveKey(ctx, orgID)
			if err != nil {
				return "", err
			}
			if res.Source == "none" || res.Key == "" {
				return "", agents.ErrNoAnthropicKey
			}
			return res.Key, nil
		})

	// SM-API mirror writer wired into both credential services. nil-safe via
	// the Enabled() check.
	credService.WithSMAPIWriter(smWriter)
	anthropicCredService.WithSMAPIWriter(smWriter)
	validatorProbes := orgcreds.NewValidatorProbes(credService, gitHost, credResolver, minter)
	credValidator := credentials.NewValidator(db, validatorProbes, nil, cfg.CredentialValidatorInterval)
	repoBoardService := gitrepo.NewRepoBoardService(repoRepo, gitHost, credResolver)

	// Artifact store — in-process via artifactSvcGit. Adds the
	// external-API catalog + the `DesignFile` YAML split/assemble layer
	// on top of raw file I/O.
	artifactStore := artifacts.NewArtifactStore(artifactSvcGit)

	// Repo-backed skills store (single source of truth = per-org org-skills
	// repo). Reads HEAD via the GitHub API with an in-memory cache; writes
	// commit to main. Built-ins seed/reconcile from the embedded files on
	// demand. docs/design/skills-repo-storage.md.
	skillSvc := skills.NewSkillService(gitOpsService, repoService)
	skillMutationSvc := skills.NewSkillMutationService(skillSvc)
	skillImportSvc := skills.NewSkillImportService(skillSvc)

	// Services. componentService is constructed before configService so
	// configService can call back into it to mirror env-var edits onto
	// the OC Component's workflow params.
	projectService := project.NewProjectService(projectClient, repoService, webhookRegService, artifactSvcGit, artifactStore, taskRepo)
	organizationService := organization.NewOrganizationService(db, namespaceClient)
	// componentService takes repoSvc + buildCredSvc so TriggerBuild can
	// pre-stage the per-WorkflowRun build Secret in workflows-<orgID>
	// before the WorkflowRun is created (see
	// docs/design/build-credential-injection.md).
	var buildStager component.BuildSecretStager
	if buildCredService != nil {
		buildStager = buildSecretStagerAdapter{svc: buildCredService}
	}
	componentService := component.NewComponentService(componentClient, observClient, artifactStore, repoService, buildStager)
	configService := component.NewConfigService(configRepo, componentService)
	requirementsDirLocker := requirements.NewRequirementsDirLocker(db)
	requirementsService := requirements.NewRequirementsService(artifactStore, agentsClient, artifactSvcGit).WithLocker(requirementsDirLocker)
	requirementsChatService := requirements.NewRequirementsChatService(artifactStore, agentsClient, artifactSvcGit, requirementsDirLocker)
	designService := design.NewDesignService(artifactStore, agentsClient, artifactSvcGit)

	taskService := task.NewTaskService(db, taskRepo, artifactStore, issueService, artifactSvcGit, repoService, agentsClient)
	boardService := task.NewBoardService(repoBoardService, taskRepo)

	designService.SetTaskService(taskService)
	// Wire the skills catalogue into design + task services so the
	// architect input ships builtin/org skills, and the tech-lead detail
	// phase ships full bodies of every attached skill.
	designService.SetSkillService(skillSvc)
	taskService.SetSkillService(skillSvc)
	// Eagerly provision each org's skills repo on project creation.
	projectService.SetSkillsProvisioner(skillSvc)
	// TaskSkillsService backs GET /internal/v1/tasks/:taskId/skills which the
	// runner pod calls at init. It resolves the task's design skillsApplied
	// against the org's skills repo at HEAD (no snapshot).
	taskSkillsSvc := task.NewTaskSkillsService(taskRepo, artifactStore, skillSvc)

	// trait_sync is the single shared emitter that reconciles the
	// `api-configuration` ClusterTrait on a Component CR + per-environment
	// ReleaseBindings. Hooked from both the dispatch path (after
	// CreateComponent) and the design-edit path (after
	// `components/<name>/design.md` PUT). See
	// docs/design/api-platform-integration.md §6 Phase 2.
	traitSyncService := component.NewTraitSyncService(componentClient, artifactStore)
	designService.SetTraitSync(traitSyncService)

	// Thunder admin client + IDP service. Reads
	// aep-system-client credentials from env (THUNDER_*) and exposes
	// EnsureOrgPublisher / RevokeOrgPublisher / RegenerateClientSecret
	// for per-org publisher OAuth app lifecycle. Optional — when the
	// Thunder base URL is empty the IDP service still runs and serves
	// GetProfile / GetOrCreateProfile, but mutating calls fail with
	// ErrIDPThunderUnavailable (non-fatal — protected components keep
	// deploying, just without per-org publishers).
	var thunderAdminClient thundersvc.Client
	thunderBase := cfg.ThunderAdmin.BaseURL
	if thunderBase == "" {
		// Fall back to the public Thunder URL the auth middleware
		// already trusts. setup-prerequisites and docker compose set
		// this to http://k3d-openchoreo-serverlb:8080 in-cluster /
		// http://thunder.openchoreo.localhost:8080 from the host.
		thunderBase = cfg.ServiceAuth.TokenURL
		// TokenURL contains /oauth2/token — strip back to the host:
		if idx := strings.Index(thunderBase, "/oauth2/"); idx > 0 {
			thunderBase = thunderBase[:idx]
		}
	}
	if cfg.ThunderAdmin.ClientID != "" && cfg.ThunderAdmin.ClientSecret != "" && thunderBase != "" {
		thunderAdminClient = thundersvc.New(thundersvc.Config{
			BaseURL:      thunderBase,
			ClientID:     cfg.ThunderAdmin.ClientID,
			ClientSecret: cfg.ThunderAdmin.ClientSecret,
		})
		slog.Info("Thunder admin client", "baseURL", thunderBase, "clientID", cfg.ThunderAdmin.ClientID)
	} else {
		slog.Warn("Thunder admin client disabled — set THUNDER_ADMIN_URL + THUNDER_SYSTEM_CLIENT_ID + THUNDER_SYSTEM_CLIENT_SECRET")
	}

	// Wire the Thunder OU validator into the org service so a stale/phantom JWT
	// `ouId` can't poison the org→OU mapping (the root cause behind the runner
	// publisher cc-token invalid_client: a phantom OU broke wc- namespace
	// derivation + forced a publisher re-registration under a non-existent OU →
	// Thunder 400 APP-1018). nil client → validation disabled (trust the JWT).
	if thunderAdminClient != nil {
		organizationService.SetOUValidator(thunderAdminClient)
		slog.Info("org OU validation wired — JWT ouId is validated against Thunder before the org→OU mapping is (over)written")
	}
	// WithSMAPIWriter mirrors per-org publisher client_secret to SM-API on
	// EnsureOrgPublisher / RegenerateClientSecret so the dispatcher's
	// PUBLISHER_CLIENT_SECRET ExternalSecret can materialise it into runner
	// pods without the BFF holding the plaintext.
	idpService := idp.NewIDPService(db, thunderAdminClient, idp.PlatformIDPConfig{
		Issuer:  cfg.PlatformIDP.Issuer,
		JWKSURL: cfg.PlatformIDP.JWKSURL,
	}).WithSMAPIWriter(smWriter)
	// Make idpService available to trait_sync so first-protected-deploy
	// provisions the publisher app lazily.
	traitSyncService.SetIDPService(idpService)

	// Connect-state JWT issuer (App-mode OAuth CSRF state). This HS256 signing
	// key only ever leaves the BFF as a JWT signature inside the GitHub OAuth
	// `state` query param. (Task JWTs use RS256 via taskTokens below.)
	bearerSvc := orgcreds.NewBearerService(cfg.OAuthStateSigningKey, 24*time.Hour)
	if cfg.OAuthStateSigningKey == "" {
		slog.Warn("OAUTH_STATE_SIGNING_KEY not set — connect-state JWTs will fail to mint")
	}

	// taskTokens (the RS256 Task-JWT manager) is constructed earlier, before
	// the agents client — that client uses it to mint per-call outbound
	// identity tokens, so it must exist by then.

	// asServiceIdentity marks OC API calls made from inside dispatch, webhook
	// handlers, and the watchers as orchestration / async calls: they
	// authenticate with the BFF's M2M service identity and impersonate the
	// target org (via X-Impersonate-Org, derived from the request URL's
	// namespace) instead of forwarding the inbound user JWT. The OC client's
	// AuthProvider supplies the M2M token, so this only needs to set the marker.
	asServiceIdentity := func(ctx context.Context) context.Context {
		return authn.WithServiceIdentity(ctx)
	}

	// Dispatch service drives the per-task Issue/branch/PR/Component
	// pipeline and creates a coding-agent WorkflowRun. wfRunService is
	// constructed below; we wire DispatchService after it.

	// Webhook receiver wiring. The verifier's HMAC secrets come from the
	// per-org credential record (via git-service).
	secretProvider := webhook.NewGitServiceSecretProvider(credService, 30*time.Second)
	var routingLookup webhook.OcOrgIDLookup = credService
	webhookVerifier := webhook.NewVerifier(secretProvider).
		WithRefetchLimiter(webhook.NewRefetchLimiter(1, 5))
	routingCache := webhook.NewRoutingCache(60 * time.Second)
	deliveryStore := webhook.NewDeliveryStore(db)
	webhookRouter := webhook.NewRouter()
	projector := task.NewProjector(db)

	wfRunService := codingagent.NewWorkflowRunService(db, taskRepo, componentClient, repoService, buildCredService, artifactStore, projector, asServiceIdentity)

	// Dispatch service routes to WorkflowRunService.TriggerCodingAgent
	// (ClusterWorkflow `aep-coding-agent`) for the per-task agent pod.
	// The runner pod reaches every BFF endpoint at AGENT_PLATFORM_URL, which
	// must be reachable from the WorkflowPlane namespace (cross-namespace
	// FQDN — see env-overlay).
	dispatchSvc := codingagent.NewDispatchService(taskRepo, repoService, credService, anthropicCredService, repoBoardService, componentService, configService, artifactStore, taskTokens, asServiceIdentity, wfRunService, projector, cfg.AgentPlatformURL, cfg.AgentPlatformURL)
	dispatchSvc.SetTraitSync(traitSyncService)
	// Let the proxy dispatch pre-flight provision the per-org publisher cc on
	// demand (decoupled from API security), so the runner can auth to the BFF
	// through the gateway for every component, not just protected ones.
	dispatchSvc.SetIDPService(idpService)
	// Wire the proxy-based dispatcher. nil dispatcher → the legacy
	// ClusterWorkflow path stays the only dispatch flow.
	if codingAgentDispatcher != nil {
		dispatchSvc.WithCodingAgentDispatcher(codingAgentDispatcher, db, cfg.AgentClusterSecretStore, cfg.AgentRunnerImage)
		slog.Info("dispatch: proxy-based coding-agent path enabled",
			"runnerImage", cfg.AgentRunnerImage,
			"clusterSecretStore", cfg.AgentClusterSecretStore)
	}
	runtimeConfigSvc := runtimeconfig.NewRuntimeConfigService(componentClient, artifactStore)
	runtimeConfigSvc.SetPlatformIDP(cfg.PlatformIDP.Issuer, "openid profile email")
	if thunderAdminClient != nil {
		runtimeConfigSvc.SetThunderAdmin(thunderAdminClient)
	}
	dispatchSvc.SetRuntimeConfig(runtimeConfigSvc)
	slog.Info("Dispatch service", "agentPlatformURL", cfg.AgentPlatformURL)

	// Wire the post-deploy dispatch cascade. The projector fires
	// OnTaskDeployed whenever ApplyBuildResult lands a task in `deployed`;
	// the cascade takes a per-project lock and calls DispatchTasks to
	// re-evaluate `on_hold` siblings and auto-dispatch the ones whose deps
	// are now satisfied. See docs/design/cross-component-wiring-gaps.md §3 F1.
	cascadeHook := codingagent.NewDispatchCascadeHook(db, dispatchSvc)
	cascadeHook.SetTraitSync(traitSyncService)
	cascadeHook.SetRuntimeConfig(runtimeConfigSvc)
	projector.SetDispatchHook(cascadeHook)

	task.RegisterHandlers(func(event, action string, h func(ctx context.Context, event, action string, payload []byte) error) {
		webhookRouter.Register(event, action, webhook.EventHandlerFunc(h))
	}, db, projector, wfRunService)
	webhook.RegisterInstallationHandlers(webhookRouter, db, credService, issueService, taskRepo)
	webhookCtrl := webhook.NewWebhookController(webhookVerifier, deliveryStore, webhookRouter, routingLookup, routingCache)

	// Build watcher — 10s sweep for in-flight WorkflowRuns. Started after
	// the HTTP server is up so it's not killed during handler init failures.
	// wfRunService.RetryAuthFailedBuild backs the auth retry path; authBudget
	// is configurable for tests via env.
	buildWatcher := codingagent.NewBuildWatcher(db, componentClient, projector, asServiceIdentity, wfRunService, cfg.BuildAuthRetryBudget)

	// Coding-agent watcher — same cadence, complementary to the GitHub
	// webhook path. Only acts on terminal-failed coding-agent WorkflowRuns;
	// success transitions ride the pull_request:ready_for_review webhook.
	codingAgentWatcher := codingagent.NewCodingAgentWatcher(db, componentClient, projector, asServiceIdentity)

	// trait_sync drift watcher (10 s cadence). Idempotent reconcile of the
	// `api-configuration` ClusterTrait on every (org,project,component) tuple
	// that has a task record. Closes write-write races between dispatch /
	// design PUT and provides the convergence backstop. See
	// docs/design/api-platform-integration.md §6 Phase 2.
	traitSyncWatcher := component.NewTraitSyncWatcher(db, traitSyncService, asServiceIdentity)

	// Inbound JWT verifier — Thunder publishes the User JWT and Service JWT
	// signing keys at JWKSURL. Lazy fetch on first request avoids compose
	// start-order races.
	var thunderJWKS *jwtassertion.JWKSCache
	if cfg.JWKSURL != "" {
		thunderJWKS = jwtassertion.NewJWKSCache(cfg.JWKSURL)
		slog.Info("Inbound JWT verifier", "jwksURL", cfg.JWKSURL, "audience", cfg.JWTAllowedAudience, "issuer", cfg.JWTAllowedIssuer)
	} else {
		// Fail closed: with no JWKS the verifier rejects every /api/ request
		// (401). There is no unsigned-claim fallback — both planes set JWKS_URL.
		slog.Error("JWKS_URL not set — every authenticated /api/ request will be rejected (401)")
	}

	// Org-scoped GitHub connect/disconnect surface.
	disconnectSvc := orgcreds.NewOrgDisconnectService(taskRepo, db, credService, issueService,
		func(s models.TaskStatus) (models.TaskStatus, error) {
			return contracts.ApplyTaskEvent(s, contracts.TaskEventOrgDisconnected)
		})
	orgGitHubCtrl := orgcreds.NewOrgGitHubController(
		credService,
		disconnectSvc,
		bearerSvc,
		cfg.GitHubAppSlug,
		cfg.BFFPublicURL,
		cfg.GitHubAppClientID,
	)

	// progressService is shared by the legacy TaskController (SSE routes) and the
	// code-first Huma task registration (RegisterHuma below).
	taskProgressSvc := progressService(taskService, componentClient, observerClient, cgwClient, db)

	// Internal S2S runner authorizer — verifies the dual-token runner callbacks
	// (BFF Task-JWT first, then Thunder publisher-cc) and binds the acting org
	// for auth.RunnerScopedInput.Resolve. publisherVerifier is nil in local dev
	// without the platform IDP (Task-JWT only); taskService.GetTask supplies the
	// task→org lookup the publisher-cc branch needs.
	publisherVerifier := authn.NewPublisherTokenVerifier(thunderJWKS, cfg.PlatformIDP.Issuer, "aep-publisher-")
	authn.SetRunnerAuthorizer(authn.NewRunnerAuthorizer(taskTokens, publisherVerifier,
		func(ctx context.Context, taskID string) (string, error) {
			t, err := taskService.GetTask(ctx, taskID)
			if err != nil || t == nil {
				return "", err
			}
			return t.OrgID, nil
		}))

	// Controllers
	params := api.AppParams{
		Config: cfg,
		// Runner callbacks are the internal Huma surface (InternalDeps); only the
		// connect-callback + webhook controllers remain raw handlers. Every other
		// feature registers code-first via params.HumaDeps below.
		InternalDeps: api.InternalDeps{
			TaskSkills:   taskSkillsSvc,
			CredsRefresh: credRefreshService,
		},
		WebhookController:   webhookCtrl,
		OrgGitHubController: orgGitHubCtrl,
		TaskRepo:            taskRepo,
		ConfigRepo:          configRepo,
		ThunderJWKS:         thunderJWKS,
		OrganizationService: organizationService,

		DB:                   db,
		CredService:          credService,
		AnthropicCredService: anthropicCredService,
	}

	// Code-first OpenAPI (Huma) feature dependencies. api.NewHandler creates the
	// Huma API on apiMux and registers every migrated feature via
	// RegisterAllHuma. See docs/design/bff-openapi-huma-migration.md.
	params.HumaDeps = api.HumaDeps{
		ProjectSvc:          projectService,
		OrgSvc:              organizationService,
		ComponentSvc:        componentService,
		ConfigSvc:           configService,
		RequirementsSvc:     requirementsService,
		RequirementsChatSvc: requirementsChatService,
		CollabRepo:          repoService,
		DesignSvc:           designService,
		TaskSvc:             taskService,
		TaskDispatcher:      dispatchSvc,
		TaskProgress:        taskProgressSvc,
		ComponentClient:     componentClient,
		BoardSvc:            boardService,
		IDPSvc:              idpService,
		CredentialSvc:       credService,
		DisconnectSvc:       disconnectSvc,
		BearerSvc:           bearerSvc,
		AnthropicSvc:        anthropicCredService,
		TaskTokens:          taskTokens,
		SkillSvc:            skillSvc,
		SkillMutationSvc:    skillMutationSvc,
		SkillImportSvc:      skillImportSvc,
		GitHubAppSlug:       cfg.GitHubAppSlug,
		BFFPublicURL:        cfg.BFFPublicURL,
		GitHubAppClientID:   cfg.GitHubAppClientID,
	}

	slog.Info("OpenChoreo API", "baseURL", cfg.PlatformAPI.BaseURL)

	handler := api.NewHandler(params)

	// On-hold watcher retries dispatch for tasks deferred due to OC
	// ReleaseBinding URL resolution lag (timing race at cascade time).
	// The watcher's OnHoldDispatcher port returns a dispatched count; adapt
	// dispatchSvc.DispatchTasks (which returns []DispatchResult) here at the
	// composition root so webhook needn't import services.
	onHoldWatcher := codingagent.NewOnHoldWatcher(db, func(ctx context.Context, orgID, projectID string) (int, error) {
		r, e := dispatchSvc.DispatchTasks(ctx, orgID, projectID)
		return len(r), e
	})

	// Background watchers, launched by main under a shared cancellable context.
	// State lives in Postgres, so a plain goroutine per watcher is enough.
	watchers := []Watcher{
		buildWatcher,
		onHoldWatcher,
		traitSyncWatcher,
		codingAgentWatcher,
		// Periodic credential validator — walks every active org_credentials row
		// once per cfg.CredentialValidatorInterval (default 24h), probes GitHub,
		// flags identity drift on confirmed unauthorised credentials.
		credValidator,
	}
	// Coding-agent run watchers coexist because each filters to the tasks it
	// owns by run-name prefix: the proxy-based JobWatcher only picks up "ca-…"
	// tasks; the legacy webhook.CodingAgentWatcher only "coding-agent-…" tasks.
	// When the proxy path falls back to the legacy dispatcher (e.g. SM-API
	// triplet missing), the prefix filter is what makes mixed-mode safe.
	if cgwClient != nil {
		watchers = append(watchers, codingagent.NewJobWatcher(db, cgwClient))
		slog.Info("codingagent.JobWatcher: enabled (cluster-gateway-proxy configured)")
	}

	return &App{Handler: handler, Watchers: watchers}, nil
}

// buildSecretStagerAdapter maps the concrete *orgcreds.BuildCredentialsService
// (StageBuildSecret → *StageResult) onto the component feature's
// BuildSecretStager port (→ secretRef string), so the component package need
// not import the services StageResult type. The adapter satisfies the consumer
// port at the composition root, not in the feature (§6.8).
type buildSecretStagerAdapter struct {
	svc *orgcreds.BuildCredentialsService
}

func (a buildSecretStagerAdapter) StageBuildSecret(ctx context.Context, ocOrgID, repoSlug, workflowRunName string) (string, error) {
	res, err := a.svc.StageBuildSecret(ctx, ocOrgID, repoSlug, workflowRunName)
	if err != nil {
		return "", err
	}
	if res == nil {
		return "", nil
	}
	return res.SecretRef, nil
}

// progressService builds the BFF's progress service and, when the
// cluster-gateway-proxy + DB are configured, wires the proxy-path log
// source (cgw-proxy pods/log + coding_agent_logs sidecar) so proxy-dispatched
// tasks surface logs in the UI even though Observer's hardcoded NS filter no
// longer applies. Tasks on the legacy ClusterWorkflow path are unaffected —
// same Observer fallback.
func progressService(
	taskSvc task.TaskService,
	ocClient openchoreo.ComponentClient,
	observerClient observer.Client,
	cgwClient *clustergatewayproxy.Client,
	db *gorm.DB,
) codingagent.ProgressService {
	svc := codingagent.NewProgressService(taskSvc, ocClient, observerClient)
	if cgwClient != nil && db != nil {
		svc.WithCodingAgentLogSource(cgwClient, db)
		slog.Info("progress: cluster-gateway-proxy log source enabled (new-path ca-… runs)")
	}
	return svc
}

// buildGitHost selects the git host implementation named by GIT_PROVIDER and
// returns it as gitrepo.Host. This is the only place a concrete provider client
// is constructed; every gitrepo domain service narrows Host to its own
// capability port. Deliberately a plain switch — NOT a registry or capability
// framework (see docs/design/aep-api-target-structure.md, "Explicitly NOT a
// framework"). A GitLab impl later is one new clients/gitlab package + one case.
// cfg.Validate() already rejects unknown providers at boot; the default arm is
// defensive.
func buildGitHost(cfg config.Config) (gitrepo.Host, error) {
	switch cfg.GitProvider {
	case "github":
		return githubclient.NewClient(), nil
	default:
		return nil, fmt.Errorf("unknown GIT_PROVIDER %q — supported: github", cfg.GitProvider)
	}
}
