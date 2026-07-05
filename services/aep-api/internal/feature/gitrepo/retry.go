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

package gitrepo

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// IsRefNotFastForward reports whether err is the non-fast-forward ref-update
// sentinel (a concurrent writer moved the ref between read and write).
func IsRefNotFastForward(err error) bool {
	return errors.Is(err, ErrRefNotFastForward)
}

// RetryCAS re-runs fn on a non-fast-forward ref update (a concurrent writer),
// with a linear 50ms·attempt backoff, re-running the whole read-modify-write
// so the base tree stays fresh. Any other error aborts immediately. On
// exhaustion the last error is wrapped as "<label>: <err> (after N attempts)".
// (feature/artifacts keeps its own leaky-bucket + jitter policy — this is the
// plain bounded retry the files and skills writers share.)
func RetryCAS(ctx context.Context, label string, attempts int, fn func() error) error {
	var err error
	for i := 0; i < attempts; i++ {
		if err = fn(); err == nil {
			return nil
		}
		if !IsRefNotFastForward(err) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(50*(i+1)) * time.Millisecond):
		}
	}
	return fmt.Errorf("%s: %w (after %d attempts)", label, err, attempts)
}
