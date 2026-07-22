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

package validation

import (
	"context"

	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// The consumer ports the validation minter drives. Each is the narrow slice of
// a larger collaborator; concrete providers are wired at the composition root.
// The only feature edge is gitrepo (the issue wire types); design + criteria
// reads are adapted from artifacts/files by the composition root so this package
// imports neither.

// IssueClient is the GitHub issue surface the minter needs: list Task issues (to
// dedup the open aep:validation issue) and create the validation issue.
// sourcecontrol.IssueService satisfies it.
type IssueClient interface {
	ListIssues(ctx context.Context, orgID, projectID string, labels []string) ([]sourcecontrol.IssueInfo, error)
	CreateIssue(ctx context.Context, orgID, projectID string, req sourcecontrol.CreateIssueRequest) (*sourcecontrol.IssueResult, error)
}

// DesignReader reads the project's authored design components at HEAD — the
// validation task dependsOn every one of them (component names), so the funnel
// holds it until all deploy. Returns ONLY models-typed data so this package
// needs no artifacts edge; the composition root adapts artifacts.ArtifactStore.
// (Minting runs right after approval, so HEAD == the just-tagged content.)
type DesignReader interface {
	ReadDesignComponents(ctx context.Context, orgID, projectID string) ([]spec.DesignComponent, error)
}

// CriteriaReader reads the acceptance oracle (specs/validation/validation-criteria.json)
// at HEAD. found=false when the file does not exist yet (the design agent has
// not authored it) — the minter then skips, and a later planning pass re-mints
// once it exists. The composition root adapts the files feature's Read.
type CriteriaReader interface {
	ReadValidationCriteria(ctx context.Context, orgID, projectID string) (raw []byte, found bool, err error)
}

// ContextProvider is the internal validation-context endpoint's view of the
// context service (*ContextService satisfies it). The org is the verified
// caller's, bound into ctx by the internal runner-auth gate.
type ContextProvider interface {
	ValidationContext(ctx context.Context, executionID, orgHandle string) (*ValidationContextResponse, error)
}

// CredentialRequester is the internal test-credentials endpoint's view of the
// credential service (*CredentialService satisfies it).
type CredentialRequester interface {
	RequestCredentials(ctx context.Context, executionID, orgHandle string, req CredentialRequest) (*TestCredential, error)
}

// CriterionReporter is the internal criteria-callback endpoint's view of the
// criterion ingest service (*CriterionIngestService satisfies it).
type CriterionReporter interface {
	ReportCriterion(ctx context.Context, executionID, orgHandle string, req CriterionReportInput) error
}

// ExecutionTaskLocator resolves a runner's execution id to its Task (repo +
// issue number + project), fenced by the caller's org. Broader than
// ExecutionLocator (which returns only the project): the criteria store is keyed
// by (repo, issue_number). delivery.ExecutionRepository's GetByIDScoped satisfies
// the adapter wired at the composition root.
type ExecutionTaskLocator interface {
	LookupExecutionTask(ctx context.Context, orgHandle, executionID string) (repo string, issueNumber int, projectID string, found bool, err error)
}

// CriterionStore upserts a criterion's latest status (last-write-wins on
// (repo, issue_number, criterion_id)). delivery.CriterionStatusRepository
// satisfies the adapter wired at the composition root.
type CriterionStore interface {
	UpsertCriterion(ctx context.Context, orgID, projectID, repo string, issueNumber int, executionID, criterionID, requirementID, status string) error
}
