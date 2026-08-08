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

// Package codingagent launches the coding agent and watches what it launched.
//
// It has ONE dispatch entry point — delivery.MilestoneDispatcher: one cycle of
// a milestone run, one agent pod — and writes no platform state on that path,
// because the cycle record is the run supervisor's bookkeeping. What state it
// does write belongs to the two watchers it owns: the JobWatcher (Job phase and
// the captured agent log) and the ExecWatcher (OpenChoreo WorkflowRun outcomes,
// including the git-clone-auth build retry).
//
// Two dispatch paths: the cluster-gateway-proxy path (per-org namespace,
// per-run ExternalSecrets, a Job through the proxy) when the proxy and SM-API
// are both configured, and the direct in-cluster K8s Job otherwise.
package codingagent

import (
	"context"
	"time"

	"github.com/wso2/aep/aep-api/internal/organization"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// Identities resolves the org's git identity (author/committer + login) for a
// coding-agent run. Wired from orgcreds.CredentialService at the composition
// root, so this feature holds no orgcreds import.
type Identities interface {
	IdentityFor(ctx context.Context, ocOrgID string) (name, email, login string, err error)
}

// DeployObserver is notified when a component deploys (a build Execution
// succeeds). The provisioning feature uses it to grant any pending cross-project
// access request targeting the just-deployed provider component (the grant
// cascade). Wired at the composition root; nil → skipped. Primitives-only so this
// feature holds no provisioning import.
type DeployObserver interface {
	OnComponentDeployed(ctx context.Context, orgID, projectID, component string) error
}

// RunnerSecretResolver resolves the coding runner's per-run external-resource
// secret bundles for a component (SM-API vault path + secret keys) — the
// dispatcher materialises each into a per-run ExternalSecret so the agent can
// integration-test against the live external service. Wired from the
// provisioning feature at the composition root; nil → the runner gets no
// external-resource secrets. Returns the codingagent input type so this feature
// holds no provisioning/resources import.
type RunnerSecretResolver interface {
	ResolveRunnerSecrets(ctx context.Context, orgID, projectID, component, env string) ([]ExternalResourceSecretInputs, error)
}

// WiringPublisher publishes the platform-resolved `endpoints:` block for the
// project onto the run's working-set issues (ADR-0004). It is called ONCE per
// cycle dispatch, immediately before the Job is launched.
//
// Dispatch is the correct moment because the dispatch predicate already
// guarantees what the comment needs: no gate is open in the milestone (so every
// dependency that can resolve has) and the working set is non-empty (so there is
// somebody to tell). The previous trigger — gate resolution — had neither
// guarantee, and a project whose gates closed before its issues were planned got
// no comment at all and no retry.
//
// Best-effort and non-fatal: a GitHub hiccup must not fail a dispatch, and the
// publisher withholds its idempotency marker on a partial post so the next
// dispatch supersedes it. Wired from the provisioning feature at the composition
// root; nil → skipped.
type WiringPublisher interface {
	PublishResolvedWiring(ctx context.Context, orgID, projectID string)
}

// SkillMirror refreshes the project repo's `.claude/skills/` copies from the
// org library. Called before the Job launches so the clone the agent works in
// carries the guidance its build was designed against. Diff-first: an
// already-current repo costs a read and no commit. Wired from
// spec.SkillService at the composition root; nil → skipped.
type SkillMirror interface {
	SyncProjectSkills(ctx context.Context, orgID, projectID string) error
}

// AnthropicProvisioner materializes the per-org Anthropic key Secret on the
// workflow plane and returns its ref. Best-effort at dispatch. Wired from
// orgcreds.AnthropicCredentialService.
type AnthropicProvisioner interface {
	ApplyWPSecret(ctx context.Context, ocOrgID string) (secretRef string, err error)
}

// CodingKeyResolver answers which Anthropic credential this run must bill: the
// org's coding-agent key when it configured one, its default key otherwise. The
// choice is the organization domain's to make — dispatch only mounts what it is
// handed — so this port deliberately exposes no way to ask "is there an
// override?", which is what keeps the reuse rule stated in exactly one place
// (ADR-0016). Wired from organization.AnthropicCredentialService.
type CodingKeyResolver interface {
	ResolveCodingSecretRef(ctx context.Context, ocOrgID string) (organization.SecretRefTriplet, error)
}

// TokenIssuer mints the runner's bearer (§9.2: the id it carries is the
// dispatching CYCLE's id). Wired from auth.TaskTokenManager.
type TokenIssuer interface {
	Issue(id, ocOrgID, projectID string) (string, error)

	// IssueServiceToken mints a dedicated BFF-signed identity token for a given
	// audience (e.g. auth.AudienceMCP) — used to mint the coding runner's
	// AEP_MCP_TOKEN, since the runner bearer above (aud git-service) is
	// rejected by the MCP verifier. ttl <= 0 falls back to the manager's
	// configured task TTL. Wired from auth.TaskTokenManager.IssueServiceToken.
	IssueServiceToken(audience, ocOrgID string, ttl time.Duration) (string, error)
}

// ProjectRepos resolves a project's git repo row (RepoURL/RepoSlug). Wired from
// sourcecontrol.RepoService.
type ProjectRepos interface {
	GetRepo(ctx context.Context, orgID, projectID string) (*sourcecontrol.GitRepository, error)
}

// OrgPublisherProvisioner get-or-creates the org's Thunder publisher OAuth
// client (for the proxy-dispatched runner's cc auth through the cloud gateway).
// Optional — nil / a local http platform URL skips it. Wired from idp.IDPService.
type OrgPublisherProvisioner interface {
	EnsureOrgPublisher(ctx context.Context, orgID, actor string) (clientID, clientSecret string, created bool, err error)
}

// BuildSecretStager pre-stages the org's build git credential on the workflow
// plane and returns the secretRef the build WorkflowRun consumes so its
// checkout-source step can clone a PRIVATE repo (the local plane sets
// GITHUB_REPO_VISIBILITY=private, so project builds need it). A nil error with
// an empty secretRef means degrade-to-unauthenticated (correct for the public
// repos aep creates by default); a non-nil error is an ownership/disconnect
// refusal or a transient failure that must block the build. Consumer-side port:
// the composition root maps the concrete *orgcreds.BuildCredentialsService's
// *StageResult onto the secretRef string (the same adapter feature/component
// uses), so this feature holds no orgcreds import. Optional — nil skips staging.
type BuildSecretStager interface {
	StageBuildSecret(ctx context.Context, ocOrgID, repoSlug, workflowRunName string) (secretRef string, err error)
}
