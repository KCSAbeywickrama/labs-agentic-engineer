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

package runread

import (
	"context"
	"fmt"
	"log/slog"
)

// Commands is the one write on the run surface: cancel.
type Commands struct {
	runs   RunReader
	cancel RunCanceller
	// reaper stops the cancelled cycle's agent pod by deleting its Component.
	// nil → the run still settles, nothing is reaped.
	reaper CycleReaper
}

// NewCommands wires the command service.
func NewCommands(runs RunReader, cancel RunCanceller) *Commands {
	return &Commands{runs: runs, cancel: cancel}
}

// WithCycleReaper enables reaping the cancelled run's agent Component. Returns
// the receiver for chained construction.
func (c *Commands) WithCycleReaper(r CycleReaper) *Commands {
	c.reaper = r
	return c
}

// Cancel abandons an increment — the only expiry the run's unbounded wait state
// has.
//
// It resolves the run through the org-scoped read FIRST, so a run in another org
// or another project is a 404 before any signal is sent, and then hands off to
// the supervisor. It does NOT write the run row: the run settles its own row on
// the ordinary code path once it receives the signal, which is the whole reason
// cancel is a signal rather than a workflow cancellation.
func (c *Commands) Cancel(ctx context.Context, orgID, projectID, runID string) error {
	if c == nil || c.runs == nil || c.cancel == nil {
		return fmt.Errorf("runread: cancel not configured")
	}
	row, err := c.runs.GetByIDScoped(ctx, orgID, runID)
	if err != nil {
		return err
	}
	if row == nil || row.ProjectID != projectID {
		return ErrRunNotFound
	}
	if err := c.cancel.CancelRun(ctx, row); err != nil {
		return err
	}
	// The signal settles the RUN; this stops the POD. Ordered after the signal
	// deliberately: if the signal failed nothing was cancelled and the caller
	// retries, so killing the agent first would abandon a run that is about to
	// carry on.
	//
	// A failed reap does NOT fail the cancel: the run is already stopping, and
	// the only cost is a component that keeps holding a billing slot until it
	// is swept — answering "cancel failed" would invite a retry that changes
	// nothing.
	if c.reaper != nil {
		if err := c.reaper.ReapRunCycle(ctx, orgID, row.ProjectID, row.ID); err != nil {
			slog.WarnContext(ctx, "cancel: could not delete the cycle's agent component; the run is still cancelled",
				"org", orgID, "project", row.ProjectID, "run", row.ID, "error", err)
		}
	}
	return nil
}
