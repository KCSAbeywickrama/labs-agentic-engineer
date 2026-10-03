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

package sreagent

import (
	"testing"

	"github.com/wso2/aep/aep-api/internal/organization"
	"github.com/wso2/aep/aep-api/internal/platform/modelconn"
)

func TestDesiredFrom(t *testing.T) {
	e := organization.EffectiveSRE{Source: organization.SRESourceOverride, Key: "sk-xxxxxxxxxxxx",
		Conn: modelconn.Connection{Format: modelconn.FormatOpenAICompatible, BaseURL: "https://api.openai.com/v1", Model: "gpt-5.4"}}
	d := DesiredFrom(e, "tok")
	if !d.Configured || d.Model != "openai:gpt-5.4" || d.Replicas() != 1 {
		t.Fatalf("%+v", d)
	}
	none := DesiredFrom(organization.EffectiveSRE{Source: organization.SRESourceNone}, "tok")
	if none.Configured || none.Replicas() != 0 || string(none.SecretData()["RCA_LLM_API_KEY"]) != "" {
		t.Fatalf("%+v", none)
	}
	if len(none.SecretData()) != 4 {
		t.Fatal("SecretData must always carry all four keys (the Deployment's secretKeyRefs require them)")
	}
}

func TestHashChangesWithAnyValue(t *testing.T) {
	a := Desired{Configured: true, Model: "openai:m", BaseURL: "https://h/v1", APIKey: "k1", MCPToken: "t"}
	b := a
	b.APIKey = "k2"
	if a.Hash() == b.Hash() {
		t.Fatal("key rotation must change the hash (forces a restart)")
	}
}
