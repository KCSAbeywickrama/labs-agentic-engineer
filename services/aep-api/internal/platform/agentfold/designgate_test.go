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

package agentfold

import (
	"fmt"
	"testing"
)

// designWithEndpoint builds a minimal valid component design.json for dir "svc",
// splicing in the given `endpoint` fragment (or none when empty).
func designWithEndpoint(endpointFragment string) string {
	ep := ""
	if endpointFragment != "" {
		ep = `,"endpoint":` + endpointFragment
	}
	return fmt.Sprintf(`{"name":"svc","type":"service","version":"0.1.0",`+
		`"language":"Go","buildpack":"docker","appPath":"svc",`+
		`"entrypoint":"deployment/service","exposure":"internet",`+
		`"description":"x","dependencies":[]%s}`, ep)
}

// TestDesignGate_Endpoint locks fold-parity for the design.json `endpoint`
// block against the zod endpointSchema (component-design-schema.ts): a
// zod-accepted write must fold here, and a zod-rejected shape must reject here.
func TestDesignGate_Endpoint(t *testing.T) {
	cases := []struct {
		name     string
		fragment string
		wantOK   bool
	}{
		{"absent — still valid", "", true},
		{"valid name", `{"name":"http"}`, true},
		{"valid non-default name", `{"name":"api"}`, true},
		{"empty name rejected", `{"name":""}`, false},
		{"unknown key rejected", `{"name":"http","port":8080}`, false},
		{"not an object rejected", `"http"`, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := validateComponentDesign(designWithEndpoint(c.fragment), "svc")
			if c.wantOK && p != nil {
				t.Fatalf("want accepted, got rejected: %s", p.message)
			}
			if !c.wantOK && p == nil {
				t.Fatalf("want rejected, got accepted")
			}
		})
	}
}
