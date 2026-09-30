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

import (
	"context"
	"log/slog"
	"time"

	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// settleTimeout bounds the ledger write that records a run's outcome. It gets
// its own context because the handler's may already be past its deadline, and
// an unrecorded outcome leaves the delivery held until its lease lapses.
const settleTimeout = 10 * time.Second

// deliveryAttempt is one claimed run of a delivery's handlers.
type deliveryAttempt struct {
	deliveryID string
	event      string
	action     string
	ocOrgID    string
	// attempt is the claim's attempt number (1 for the receiver's own run).
	attempt int
	payload []byte
	// source names who dispatched it ("receiver" or "replay"), for the logs.
	source string
}

// deliveryRunner runs one claimed attempt and records its outcome on the
// ledger. The receiver and the Replayer share it, so a run settles the same way
// whoever started it: processed, or failed and held for its retry backoff.
type deliveryRunner struct {
	deliveries *sourcecontrol.DeliveryStore
	router     *Router
}

// run executes the handlers under handlerBudget. ctx must already be detached
// from any request (the receiver passes context.WithoutCancel of its own).
func (r deliveryRunner) run(ctx context.Context, a deliveryAttempt) {
	started := time.Now()
	handlerCtx, cancel := context.WithTimeout(ctx, handlerBudget)
	err := r.router.Dispatch(handlerCtx, a.event, a.payload)
	cancel()

	settleCtx, cancelSettle := context.WithTimeout(context.WithoutCancel(ctx), settleTimeout)
	defer cancelSettle()
	attrs := []any{
		"deliveryId", a.deliveryID, "event", a.event, "action", a.action, "ocOrgId", a.ocOrgID,
		"attempt", a.attempt, "source", a.source, "handleMs", time.Since(started).Milliseconds(),
	}
	if err != nil {
		retryIn := deliveryBackoff(a.attempt)
		if merr := r.deliveries.MarkFailed(settleCtx, a.deliveryID, err.Error(), retryIn); merr != nil {
			slog.WarnContext(ctx, "webhook: mark failed failed", append(attrs, "error", merr)...)
		}
		if a.attempt >= maxDeliveryAttempts {
			// Terminal: no replay will pick this delivery up again. What it was
			// for is the reconcile sweeps' to heal from ground truth.
			slog.ErrorContext(ctx, "webhook: delivery abandoned — handler failed on its last attempt",
				append(attrs, "error", err, "result", "abandoned")...)
			return
		}
		slog.ErrorContext(ctx, "webhook: handler failed — will be replayed",
			append(attrs, "error", err, "retryIn", retryIn.String(), "result", "handler_failed")...)
		return
	}
	if merr := r.deliveries.MarkProcessed(settleCtx, a.deliveryID); merr != nil {
		slog.WarnContext(ctx, "webhook: mark processed failed", append(attrs, "error", merr)...)
	}
	slog.InfoContext(ctx, "webhook: processed", append(attrs, "result", "processed")...)
}
