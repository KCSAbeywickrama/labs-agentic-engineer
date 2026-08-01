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

package gitfs

import (
	"errors"
	"fmt"
	"syscall"
)

// Disk admission / ENOSPC sentinels. ErrDiskAdmission refuses new snapshot
// materialization when the reaper last recorded usage >= 90%. ErrDiskFull is
// the unwrap target of DiskFullError after an emergency sweep is triggered.
var (
	// ErrDiskAdmission is returned by Ensure when DiskUsagePct() >= 90 and
	// the destination snapshot does not already exist.
	ErrDiskAdmission = errors.New("gitfs: disk admission refused: workspace usage >= 90%")
	// ErrDiskFull is the sentinel underneath DiskFullError (errors.Is).
	ErrDiskFull = errors.New("gitfs: disk full")
)

// DiskAdmissionRefusePct is the usage threshold at which Ensure refuses to
// materialize a new snapshot. Existing snapshots and read paths stay open.
const DiskAdmissionRefusePct = 90

// DiskFullError names the workspace root and last-recorded usage after an
// ENOSPC was observed and the reaper emergency sweep was triggered.
type DiskFullError struct {
	Root    string
	UsedPct int
}

func (e *DiskFullError) Error() string {
	return fmt.Sprintf("gitfs: ENOSPC on workspace %s (usage ~%d%%) — reaper emergency sweep triggered", e.Root, e.UsedPct)
}

func (e *DiskFullError) Unwrap() error { return ErrDiskFull }

// isENOSPC reports whether err wraps syscall.ENOSPC (os.PathError, git child
// I/O failures that preserve the errno, etc.).
func isENOSPC(err error) bool {
	return errors.Is(err, syscall.ENOSPC)
}
