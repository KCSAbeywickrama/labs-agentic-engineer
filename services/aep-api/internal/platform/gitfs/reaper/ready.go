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

import "sync/atomic"

// ReadyGate is the workspace-root readiness signal for GET /readyz.
// Set true after a successful boot layout / healthy sweep; set false when
// root-health fails so Kubernetes marks the pod NotReady (R8b PVC-prune
// detector). Nil receivers are treated as always-ready (tests without a disk).
type ReadyGate struct {
	ready atomic.Bool
}

// Set stores the readiness value. Nil-safe.
func (g *ReadyGate) Set(ready bool) {
	if g == nil {
		return
	}
	g.ready.Store(ready)
}

// Ready reports the current readiness. Nil → true.
func (g *ReadyGate) Ready() bool {
	if g == nil {
		return true
	}
	return g.ready.Load()
}
