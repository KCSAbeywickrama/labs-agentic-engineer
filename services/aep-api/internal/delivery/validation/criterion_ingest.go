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
	"fmt"
	"strings"
)

// CriterionReportInput is one criterion status transition the validation
// runner's Playwright reporter reports live (per test begin/end). The parent
// requirement id is optional — the reporter only reliably knows the criterion
// id (parsed from the Playwright test title); the console fills in the
// requirement from the criteria file it already reads.
type CriterionReportInput struct {
	CriterionID   string
	Status        string
	RequirementID string
}

// CriterionIngestService records live per-criterion validation status: it
// resolves the runner's execution id to its Task (org-fenced) and upserts the
// status into the durable criteria store the console reads back by issue number.
type CriterionIngestService struct {
	execs ExecutionTaskLocator
	store CriterionStore
}

// NewCriterionIngestService wires the criteria ingest service.
func NewCriterionIngestService(execs ExecutionTaskLocator, store CriterionStore) *CriterionIngestService {
	return &CriterionIngestService{execs: execs, store: store}
}

// ReportCriterion upserts one criterion's status for the runner's execution.
// orgHandle is the verified caller org (the internal runner-auth gate fences it
// against the execution). A blank criterion id or status is rejected; an
// execution that does not resolve in the caller's org is ErrExecutionNotFound
// (surfaced as 404).
func (s *CriterionIngestService) ReportCriterion(ctx context.Context, executionID, orgHandle string, req CriterionReportInput) error {
	criterionID := strings.TrimSpace(req.CriterionID)
	status := strings.TrimSpace(req.Status)
	if criterionID == "" || status == "" {
		return fmt.Errorf("criterion report: criterionId and status are required")
	}
	repo, issue, projectID, found, err := s.execs.LookupExecutionTask(ctx, orgHandle, executionID)
	if err != nil {
		return fmt.Errorf("criterion report: resolve execution: %w", err)
	}
	if !found {
		return ErrExecutionNotFound
	}
	if err := s.store.UpsertCriterion(ctx, orgHandle, projectID, repo, issue, executionID, criterionID, strings.TrimSpace(req.RequirementID), status); err != nil {
		return fmt.Errorf("criterion report: upsert: %w", err)
	}
	return nil
}
