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

package migrate

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// RunMilestoneRuns creates the spec-run mutex on the milestone_runs table: a
// partial unique index admitting at most ONE non-terminal spec-build run per
// (org_id, project_id). It is the database twin of the build endpoint's 409 —
// the endpoint answers the user, the index makes the invariant true under
// concurrency, because dispatch inserts with ON CONFLICT DO NOTHING against it
// and the losing racer writes zero rows.
//
// Incident-adoption runs are deliberately OUTSIDE the index: they work their
// own milestones and execute concurrently with each other and with a live spec
// run. Only the non-terminal states are covered, so a settled run never blocks
// the next build. The predicate must list exactly delivery's
// nonTerminalRunStates — a state in one and not the other lets a second spec
// run in.
//
// AutoMigrate creates the milestone_runs and run_cycles tables from the models
// (migrate.BaseModels) but cannot express a partial (WHERE-clause) index, so it
// is added here.
//
// The index is VERSIONED IN ITS NAME because a predicate cannot be altered in
// place: CREATE UNIQUE INDEX IF NOT EXISTS matches on the name alone, so an
// existing index with the old predicate would be silently kept. Widening it is
// therefore create-then-drop, in that order — dropping first would leave the
// mutex unenforced for the width of the migration, which is exactly the window
// a double-click lands in.
//
// Idempotent: CREATE … IF NOT EXISTS and DROP … IF EXISTS are both no-ops on
// re-run, and the step no-ops entirely if the table is not present yet.
func RunMilestoneRuns(ctx context.Context, db *gorm.DB) error {
	if !hasTable(db, "milestone_runs") {
		return nil
	}
	if err := db.WithContext(ctx).Exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS ux_milestone_runs_spec_active_v2
		ON milestone_runs (org_id, project_id)
		WHERE origin = 'spec-build' AND state IN ('planning', 'waiting', 'running')`).Error; err != nil {
		return fmt.Errorf("milestone_runs spec-run mutex index: %w", err)
	}
	// The narrower predecessor. It only ever refused a subset of what the new
	// index refuses, so by here the invariant has never been unguarded.
	if err := db.WithContext(ctx).Exec(
		`DROP INDEX IF EXISTS ux_milestone_runs_spec_active`).Error; err != nil {
		return fmt.Errorf("milestone_runs drop superseded mutex index: %w", err)
	}
	// ONE LIVE RUN PER MILESTONE, whatever its origin.
	//
	// This is not a new rule — it is the one the whole loop already assumes and
	// nothing enforced. The workflow id is per-milestone
	// (run-<org>-<project>-<milestone>), the read model states that only the
	// newest run can be live, and adoption refuses to start a second. Two live
	// runs on one milestone would put two agents on one branch.
	//
	// The mutex above cannot express it: it is keyed on (org, project) and
	// narrowed to spec-build, which is a per-PROJECT rule about starting a new
	// version. Every other origin sat outside it, so the guard against a second
	// run was a read-then-insert in application code — a check two concurrent
	// requests both pass. The loser's row is then admitted with no workflow behind
	// it (Temporal answers AlreadyStarted on the reused id), and because it is
	// non-terminal it makes LiveRunForMilestone answer forever: every later
	// revalidation of that version is refused until somebody cancels a run that
	// was never running.
	//
	// Insertion goes through the same ON CONFLICT DO NOTHING, which names no
	// conflict target and so catches this index too — the losing racer writes
	// zero rows and TryAdmit reports admitted=false, unchanged.
	if err := db.WithContext(ctx).Exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS ux_milestone_runs_active_per_milestone_v1
		ON milestone_runs (org_id, project_id, milestone_number)
		WHERE state IN ('planning', 'waiting', 'running')`).Error; err != nil {
		return fmt.Errorf("milestone_runs per-milestone active index: %w", err)
	}
	return nil
}
