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

// run_cycle_logs.go — legacy milestone cycle log table.
//
// Created when milestone runs were planned to capture agent logs in Postgres.
// The shipped design reads logs from OpenChoreo and the observability archive
// instead; nothing in the codebase writes or reads this table. The migration
// stays idempotent so existing deployments keep a harmless empty table. FK'd to
// run_cycles(id); runs after milestone_runs so the target exists.
func RunRunCycleLogs(ctx context.Context, db *gorm.DB) error {
	stmt := `
		CREATE TABLE IF NOT EXISTS run_cycle_logs (
		  cycle_id     UUID         NOT NULL REFERENCES run_cycles(id) ON DELETE CASCADE,
		  run_name     TEXT         NOT NULL,
		  final_phase  TEXT         NOT NULL,
		  captured_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
		  log_text     TEXT         NOT NULL,
		  size_bytes   BIGINT       NOT NULL,
		  PRIMARY KEY (cycle_id, run_name)
		);
		CREATE INDEX IF NOT EXISTS idx_run_cycle_logs_cycle_id ON run_cycle_logs(cycle_id);`
	if err := db.WithContext(ctx).Exec(stmt).Error; err != nil {
		return fmt.Errorf("run_cycle_logs: %w", err)
	}
	return nil
}
