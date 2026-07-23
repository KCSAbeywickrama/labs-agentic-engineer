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

package delivery_test

import (
	"context"
	"testing"

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/platform/dbtest"
)

func validationCriterionRow(org, repo string, issue int, id, status string) *delivery.ValidationCriterionStatus {
	return &delivery.ValidationCriterionStatus{
		Repo: repo, IssueNumber: issue, CriterionID: id,
		OrgID: org, ProjectID: "proj", Status: status, ExecutionID: "exec-1",
	}
}

// TestCriterionStatusRepository_UpsertLastWriteWins: the same criterion re-upserts
// onto one row (a validating→passed transition, or a same-issue retry), so the
// checklist collapses to the latest status per (repo, issue, criterion).
func TestCriterionStatusRepository_UpsertLastWriteWins(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := delivery.NewValidationCriterionStatusRepository(db)
	ctx := context.Background()

	if err := repo.Upsert(ctx, validationCriterionRow("orga", "o/r", 30, "AC-001-a", "validating")); err != nil {
		t.Fatalf("upsert validating: %v", err)
	}
	if err := repo.Upsert(ctx, validationCriterionRow("orga", "o/r", 30, "AC-001-a", "passed")); err != nil {
		t.Fatalf("upsert passed: %v", err)
	}
	if err := repo.Upsert(ctx, validationCriterionRow("orga", "o/r", 30, "AC-002-a", "failed")); err != nil {
		t.Fatalf("upsert second criterion: %v", err)
	}

	rows, err := repo.ListByIssueScoped(ctx, "orga", "o/r", 30)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("want 2 rows (one per criterion), got %d: %+v", len(rows), rows)
	}
	// Ordered by criterion id; AC-001-a collapsed to its latest status.
	if rows[0].CriterionID != "AC-001-a" || rows[0].Status != "passed" {
		t.Errorf("row[0] = %+v; want AC-001-a/passed (last write wins)", rows[0])
	}
	if rows[1].CriterionID != "AC-002-a" || rows[1].Status != "failed" {
		t.Errorf("row[1] = %+v; want AC-002-a/failed", rows[1])
	}
}

// TestCriterionStatusRepository_SameKeyDifferentOrgs: org_id is part of the
// conflict identity, so the SAME (repo, issue, criterion) reported by two orgs
// persists as two independent rows — neither upsert overwrites the other.
func TestCriterionStatusRepository_SameKeyDifferentOrgs(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := delivery.NewValidationCriterionStatusRepository(db)
	ctx := context.Background()

	if err := repo.Upsert(ctx, validationCriterionRow("orga", "o/r", 30, "AC-001-a", "passed")); err != nil {
		t.Fatalf("upsert orga: %v", err)
	}
	if err := repo.Upsert(ctx, validationCriterionRow("orgb", "o/r", 30, "AC-001-a", "failed")); err != nil {
		t.Fatalf("upsert orgb (same repo/issue/criterion): %v", err)
	}

	mine, err := repo.ListByIssueScoped(ctx, "orga", "o/r", 30)
	if err != nil {
		t.Fatalf("list orga: %v", err)
	}
	if len(mine) != 1 || mine[0].Status != "passed" {
		t.Fatalf("orga = %+v; want one row AC-001-a/passed (not overwritten by orgb)", mine)
	}

	other, err := repo.ListByIssueScoped(ctx, "orgb", "o/r", 30)
	if err != nil {
		t.Fatalf("list orgb: %v", err)
	}
	if len(other) != 1 || other[0].Status != "failed" {
		t.Fatalf("orgb = %+v; want one row AC-001-a/failed", other)
	}
}

// TestCriterionStatusRepository_OrgFence: ListByIssueScoped never leaks another
// org's rows, and a miss is an empty slice.
func TestCriterionStatusRepository_OrgFence(t *testing.T) {
	t.Parallel()
	db := dbtest.New(t)
	repo := delivery.NewValidationCriterionStatusRepository(db)
	ctx := context.Background()

	if err := repo.Upsert(ctx, validationCriterionRow("orga", "o/r", 30, "AC-001-a", "passed")); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	// Different org, same (repo, issue) → no leak.
	other, err := repo.ListByIssueScoped(ctx, "orgb", "o/r", 30)
	if err != nil {
		t.Fatalf("list other org: %v", err)
	}
	if len(other) != 0 {
		t.Errorf("org fence leaked %d rows to orgb: %+v", len(other), other)
	}

	// Owner sees its row.
	mine, err := repo.ListByIssueScoped(ctx, "orga", "o/r", 30)
	if err != nil {
		t.Fatalf("list owner: %v", err)
	}
	if len(mine) != 1 {
		t.Fatalf("owner sees %d rows, want 1", len(mine))
	}
}
