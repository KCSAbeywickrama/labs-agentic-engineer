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

package taskplan

import (
	"encoding/json"
	"testing"
)

func TestDecodeBuildPlanOk(t *testing.T) {
	ok := `{"ok":true,"op":"build","items":[{"item":"foundation","components":["api"],"note":"Set up."},{"item":"F1","components":["api","web"],"note":"Claims."}]}`
	p, err := DecodeBuildPlanOk(json.RawMessage(ok))
	if err != nil {
		t.Fatalf("DecodeBuildPlanOk: %v", err)
	}
	if len(p.Items) != 2 || p.Items[1].Item != "F1" || len(p.Items[1].Components) != 2 {
		t.Fatalf("items: %+v", p.Items)
	}
	for name, raw := range map[string]string{
		"a refused call":      `{"ok":false,"op":"build","code":"MISSING_ITEM","message":"F2 is left out"}`,
		"another op":          `{"ok":true,"op":"plan","items":[{"item":"F1","components":["api"],"note":""}]}`,
		"an empty checklist":  `{"ok":true,"op":"build","items":[]}`,
		"not a result at all": `[]`,
	} {
		if _, err := DecodeBuildPlanOk(json.RawMessage(raw)); err == nil {
			t.Errorf("%s decoded as a build plan", name)
		}
	}
}
