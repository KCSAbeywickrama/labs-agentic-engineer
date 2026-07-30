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

package delivery

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// WorkflowRunRepository is the lookup index for Temporal devflow workflows
// (internal/delivery/devflow). Temporal is the source of truth for workflow
// state; these rows exist so webhook handlers and watchers can resolve
// "which running workflow wants this event?" and so the list endpoint can
// enumerate a project's runs. Lookups miss with (nil, nil) — never
// gorm.ErrRecordNotFound — matching the house convention.
type WorkflowRunRepository interface {
	// Record upserts the row for a workflow execution (keyed by workflow_id +
	// run_id). Written from workflow activities, so a workflow retry re-runs it
	// — the upsert makes that idempotent.
	Record(ctx context.Context, row *DevflowRun) error

	// SetStatus marks the row for workflowID terminal (or running again). reason
	// is the failure detail for a `failed` status (empty otherwise) — persisted so
	// the build summary can show WHY a run failed. failureKind is the
	// machine-readable cause beside it (ValidationFailure* / DevFailure*), empty
	// for non-failures and for causes not yet modelled.
	SetStatus(ctx context.Context, workflowID, status, reason, failureKind string) error

	// SetValidationVerdict records a validation row's computed verdict
	// (ValidationVerdict*) — written by the report-ingest activity once the run
	// reached an answer.
	SetValidationVerdict(ctx context.Context, workflowID, verdict string) error

	// ResolveValidationVerdict records a HUMAN verdict, but only while the row's
	// verdict is still ValidationVerdictAwaitingReview. Reports false when the
	// verdict was already decided — automatically, or by an earlier human — which
	// is the endpoint's 409. The guard lives in the UPDATE's WHERE clause so two
	// concurrent decisions cannot both win.
	ResolveValidationVerdict(ctx context.Context, workflowID, verdict, actor, note string) (bool, error)

	// SetTaskCounts writes the dev run's task tally as ABSOLUTE values —
	// idempotent under activity retry, never an increment. Scoped to one
	// EXECUTION (workflow_id, run_id): a same-tag rebuild reuses the
	// deterministic workflow id with a new run id, and the historical row's
	// frozen tally must survive it. Record's upsert deliberately excludes
	// these columns so the workflow's re-Record cannot zero a tally written
	// before it.
	SetTaskCounts(ctx context.Context, workflowID, runID string, total, done, failed int) error

	// RunningTaskByIssue returns the running row that owns an issue's webhook
	// signals — a coding task's row, or the validation-phase orchestrator's
	// (kind=validation) row for the project's validation issue — or (nil, nil)
	// when none. The webhook signaler's point lookup.
	RunningTaskByIssue(ctx context.Context, repo string, issueNumber int) (*DevflowRun, error)

	// RunningDevByProject returns the running dev-kind row for a project, or
	// (nil, nil) when none. At most one dev workflow runs per project (the
	// start endpoint enforces it via this lookup).
	RunningDevByProject(ctx context.Context, orgID, projectID string) (*DevflowRun, error)

	// ValidationRunByParent returns the newest validation-kind row (the
	// validation-phase orchestrator) spawned by a dev run (matched on
	// parent_workflow_id), or (nil, nil) when none — the status builder's
	// cheap read of the project's validation phase state.
	ValidationRunByParent(ctx context.Context, orgID, projectID, parentWorkflowID string) (*DevflowRun, error)

	// LatestValidationRunByTag returns the newest validation-kind row for a
	// project at a tag, or (nil, nil) when none. An empty tag means the newest
	// regardless of tag. The validation endpoints' entry point: the row carries
	// both the issue the report was posted to and the workflow id the verdict is
	// written against.
	LatestValidationRunByTag(ctx context.Context, orgID, projectID, tag string) (*DevflowRun, error)

	// ListByProject returns a project's rows, newest first, optionally
	// filtered to one kind ("" = all).
	ListByProject(ctx context.Context, orgID, projectID, kind string) ([]DevflowRun, error)

	// GetByWorkflowID returns the row for a workflow ID fenced to orgID, or
	// (nil, nil) when absent / another org's.
	GetByWorkflowID(ctx context.Context, orgID, workflowID string) (*DevflowRun, error)

	// DeleteByProject purges a project's rows — the project-delete cascade.
	// Without it a recreated same-named project resurrects stale runs (and
	// the status poll would chase spec tags the fresh repo never had).
	DeleteByProject(ctx context.Context, orgID, projectID string) error
}

type workflowRunRepository struct{ db *gorm.DB }

// NewWorkflowRunRepository wires the gorm-backed repository.
func NewWorkflowRunRepository(db *gorm.DB) WorkflowRunRepository {
	return &workflowRunRepository{db: db}
}

func (r *workflowRunRepository) Record(ctx context.Context, row *DevflowRun) error {
	if row.Status == "" {
		row.Status = WorkflowStatusRunning
	}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "workflow_id"}, {Name: "run_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"kind", "org_id", "project_id", "tag", "repo", "issue_number",
			"parent_workflow_id", "status", "updated_at",
		}),
	}).Create(row).Error
}

func (r *workflowRunRepository) SetStatus(ctx context.Context, workflowID, status, reason, failureKind string) error {
	// Truncate defensively: the reason is a workflow error string, so a
	// pathological one must not blow the row up. text has no hard cap, but a sane
	// bound keeps the column and the UI honest.
	if len(reason) > 2000 {
		reason = reason[:2000]
	}
	return r.db.WithContext(ctx).Model(&DevflowRun{}).
		Where("workflow_id = ?", workflowID).
		Updates(map[string]any{"status": status, "reason": reason, "failure_kind": failureKind}).Error
}

func (r *workflowRunRepository) SetValidationVerdict(ctx context.Context, workflowID, verdict string) error {
	return r.db.WithContext(ctx).Model(&DevflowRun{}).
		Where("workflow_id = ?", workflowID).
		Update("verdict", verdict).Error
}

func (r *workflowRunRepository) ResolveValidationVerdict(ctx context.Context, workflowID, verdict, actor, note string) (bool, error) {
	if len(note) > 2000 {
		note = note[:2000]
	}
	now := time.Now().UTC()
	// The awaiting_review guard is part of the WHERE clause, not a read-then-write:
	// two humans deciding at once must not both succeed, and an automatic pass or
	// fail must never be overwritable.
	res := r.db.WithContext(ctx).Model(&DevflowRun{}).
		Where("workflow_id = ? AND verdict = ?", workflowID, ValidationVerdictAwaitingReview).
		Updates(map[string]any{
			"verdict":        verdict,
			"verdict_set_by": actor,
			"verdict_set_at": now,
			"verdict_note":   note,
		})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

func (r *workflowRunRepository) SetTaskCounts(ctx context.Context, workflowID, runID string, total, done, failed int) error {
	return r.db.WithContext(ctx).Model(&DevflowRun{}).
		Where("workflow_id = ? AND run_id = ?", workflowID, runID).
		Updates(map[string]any{
			"tasks_total":  total,
			"tasks_done":   done,
			"tasks_failed": failed,
		}).Error
}

func (r *workflowRunRepository) RunningTaskByIssue(ctx context.Context, repo string, issueNumber int) (*DevflowRun, error) {
	var row DevflowRun
	// kind IN (task, validation): the validation-phase orchestrator owns its
	// issue's signals the same way a coding task owns its own. Dev rows carry
	// issue_number 0, so they can never match a webhook lookup.
	err := r.db.WithContext(ctx).
		Where("kind IN ? AND repo = ? AND issue_number = ? AND status = ?",
			[]string{WorkflowKindTask, WorkflowKindValidation},
			repo, issueNumber, WorkflowStatusRunning).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *workflowRunRepository) RunningDevByProject(ctx context.Context, orgID, projectID string) (*DevflowRun, error) {
	var row DevflowRun
	err := r.db.WithContext(ctx).
		Where("kind = ? AND org_id = ? AND project_id = ? AND status = ?",
			WorkflowKindDev, orgID, projectID, WorkflowStatusRunning).
		Order("created_at DESC").
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *workflowRunRepository) ValidationRunByParent(ctx context.Context, orgID, projectID, parentWorkflowID string) (*DevflowRun, error) {
	var row DevflowRun
	err := r.db.WithContext(ctx).
		Where("kind = ? AND org_id = ? AND project_id = ? AND parent_workflow_id = ?",
			WorkflowKindValidation, orgID, projectID, parentWorkflowID).
		Order("created_at DESC").
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *workflowRunRepository) LatestValidationRunByTag(ctx context.Context, orgID, projectID, tag string) (*DevflowRun, error) {
	q := r.db.WithContext(ctx).
		Where("kind = ? AND org_id = ? AND project_id = ?", WorkflowKindValidation, orgID, projectID)
	if tag != "" {
		q = q.Where("tag = ?", tag)
	}
	var row DevflowRun
	err := q.Order("created_at DESC").First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *workflowRunRepository) ListByProject(ctx context.Context, orgID, projectID, kind string) ([]DevflowRun, error) {
	q := r.db.WithContext(ctx).
		Where("org_id = ? AND project_id = ?", orgID, projectID).
		Order("created_at DESC")
	if kind != "" {
		q = q.Where("kind = ?", kind)
	}
	var rows []DevflowRun
	if err := q.Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func (r *workflowRunRepository) DeleteByProject(ctx context.Context, orgID, projectID string) error {
	return r.db.WithContext(ctx).
		Where("org_id = ? AND project_id = ?", orgID, projectID).
		Delete(&DevflowRun{}).Error
}

func (r *workflowRunRepository) GetByWorkflowID(ctx context.Context, orgID, workflowID string) (*DevflowRun, error) {
	var row DevflowRun
	err := r.db.WithContext(ctx).
		Where("org_id = ? AND workflow_id = ?", orgID, workflowID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}
