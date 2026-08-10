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

package edge

import "testing"

// The edge body ceiling exists to bound abuse, not to undercut a documented
// feature. The largest legitimate request is the reference-document batch
// (#383/#384): 10 files × 5 MiB, base64-encoded on the wire (4·⌈n/3⌉), plus
// JSON structure. A ceiling below that turns a valid upload into a 413 —
// which is precisely the regression this test exists to catch (the cap sat at
// 10 MiB while the contract allowed ~67 MiB).
func TestMaxBodyBytes_AdmitsTheFullReferenceBatch(t *testing.T) {
	const decoded = 10 * (5 << 20)  // ≤10 files × ≤5 MiB, the FE contract
	wire := 4 * ((decoded + 2) / 3) // base64 length
	wire += 64 << 10                // JSON keys, paths, message — generous slack
	if maxBodyBytes < wire {
		t.Fatalf("maxBodyBytes = %d, but a full reference batch needs %d on the wire — valid uploads would 413", maxBodyBytes, wire)
	}
}
