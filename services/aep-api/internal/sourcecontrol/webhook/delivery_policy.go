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

package webhook

import "time"

// handlerBudget bounds one run of a delivery's handlers. It is the only clock
// a handler runs against: GitHub's 10-second delivery timeout no longer
// reaches it, because the receiver acknowledges before dispatching.
const handlerBudget = 2 * time.Minute

// deliveryLease is how long a claim on a delivery lasts. It outlives
// handlerBudget, so a lease only lapses once its holder's context is already
// dead (finished, timed out, or gone with its pod) and a takeover can never
// overlap a run that is still going.
const deliveryLease = handlerBudget + time.Minute

// maxDeliveryAttempts caps the handler runs one delivery gets, the receiver's
// own run included. What a delivery that exhausts them was for is left to the
// reconcile sweeps (eventcore), which heal from ground truth rather than from
// the delivery.
const maxDeliveryAttempts = 5

// replayWindow is how long after receipt an unprocessed delivery is still
// replayed. Past it, the world the delivery described has moved on (a later
// cycle may be open), so re-running it would act on stale facts; the reconcile
// sweeps own it from there. It also keeps the first boot of a new build from
// replaying the ledger's whole history.
const replayWindow = 15 * time.Minute

// deliveryBackoffBase is the wait after a first failed attempt; each further
// failure doubles it (30s, 1m, 2m, 4m), which fits every attempt inside
// replayWindow.
const deliveryBackoffBase = 30 * time.Second

// deliveryBackoff is the hold after the given failed attempt (1-based).
func deliveryBackoff(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	return deliveryBackoffBase << (attempt - 1)
}

// ReplayHorizon is the latest a delivery's handlers can still run after its
// receipt: the last replay starts inside replayWindow and runs for at most
// handlerBudget. A reconcile that must never act on the same work as a
// delivery's own attempts waits at least this long after the fact it heals
// (see app wiring of eventcore.BuildSweep).
const ReplayHorizon = replayWindow + handlerBudget
