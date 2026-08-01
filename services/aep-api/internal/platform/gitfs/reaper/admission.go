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

package reaper

import (
	"context"
	"log/slog"
)

// ForceSweep is the ENOSPC emergency path: purge every trash/<id> entry
// regardless of age, then run a full Sweep so tmp/snapshot/quota passes can
// reclaim further space. Wired from Engine.SetOnENOSPC at the composition root.
func (r *Reaper) ForceSweep(ctx context.Context) {
	if err := r.purgeTrashAll(ctx); err != nil {
		slog.WarnContext(ctx, "reaper: ForceSweep trash purge failed", "error", err)
	}
	r.Sweep(ctx)
}

// recordDiskUsage publishes max(byte used%, inode used%) onto the engine for
// Ensure admission — either pressure axis at ≥ DiskAdmissionRefusePct refuses
// new snapshots.
func (r *Reaper) recordDiskUsage(total, avail, inodesTotal, inodesFree uint64) {
	if total == 0 {
		return
	}
	pct := int((total - avail) * 100 / total)
	if inodesTotal > 0 {
		inodePct := int((inodesTotal - inodesFree) * 100 / inodesTotal)
		if inodePct > pct {
			pct = inodePct
		}
	}
	r.engine.SetDiskUsagePct(pct)
}
