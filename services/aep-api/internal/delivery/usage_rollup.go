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
	"fmt"

	"github.com/wso2/aep/aep-api/internal/contracts"
)

// PhaseUsageRollup returns delivery's whole answer to "what did this org's agent
// work cost, per project lifetime, per SDLC phase" (#291).
//
// It reads the agent-usage LEDGER and nothing else. That is the design, not an
// optimisation:
//
//   - ONE SOURCE. Delivery has two dispatch histories — cycles (where agent spend
//     lives after the issue-driven flip) and the older funnel's executions — and
//     both mirror every capture into the ledger. Summing the dispatch rows as well
//     would count the same tokens twice, so they are not summed at all.
//   - IT OUTLIVES THE PURGE. The dispatch rows are working state and a project
//     delete removes them; the ledger is deliberately outside that cascade, so the
//     Settings → Usage page can still answer for a project that no longer exists —
//     which is exactly what its `deleted` cards are for.
//   - IT KEEPS LIFETIMES APART. The result is keyed by contracts.UsageScope, so a
//     project recreated under a deleted one's name does not inherit its bill.
//
// The fold lives HERE, not in the composition root and not in the usage service,
// because "which records count, and which phase each belongs to" is delivery's
// knowledge.
func PhaseUsageRollup(ledger AgentUsageLedgerRepository) func(ctx context.Context, orgID string) (build, validation map[contracts.UsageScope]contracts.StampedUsage, err error) {
	return func(ctx context.Context, orgID string) (map[contracts.UsageScope]contracts.StampedUsage, map[contracts.UsageScope]contracts.StampedUsage, error) {
		build, validation, err := ledger.SumUsageByProjectPhase(ctx, orgID)
		if err != nil {
			return nil, nil, fmt.Errorf("delivery: agent usage rollup: %w", err)
		}
		return build, validation, nil
	}
}
