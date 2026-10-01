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

package openchoreo

import (
	"encoding/json"
	"testing"

	"github.com/wso2/aep/aep-api/internal/gen"
)

// Every project create names the org's namespaced ProjectType/default on the
// wire. A typeless create is defaulted by OpenChoreo's API to
// ClusterProjectType/default, which wso2cloud does not have, and the Project
// then never reconciles (ProjectTypeNotFound).
func TestBuildCreateProjectBody_ReferencesNamespacedDefaultProjectType(t *testing.T) {
	t.Parallel()
	cases := map[string]*gen.CreateProjectRequest{
		"with pipeline":    {Name: "todo", DeploymentPipeline: "default"},
		"without pipeline": {Name: "todo"},
	}
	for name, req := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			raw, err := json.Marshal(buildCreateProjectBody(req))
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var wire struct {
				Spec struct {
					Type map[string]string `json:"type"`
				} `json:"spec"`
			}
			if err := json.Unmarshal(raw, &wire); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			want := map[string]string{"kind": "ProjectType", "name": "default"}
			if len(wire.Spec.Type) != len(want) || wire.Spec.Type["kind"] != want["kind"] || wire.Spec.Type["name"] != want["name"] {
				t.Errorf("spec.type = %v, want %v (body %s)", wire.Spec.Type, want, raw)
			}
		})
	}
}

// The pipeline reference is sent only when the caller names one; OpenChoreo
// defaults it otherwise.
func TestBuildCreateProjectBody_DeploymentPipelineRef(t *testing.T) {
	t.Parallel()
	body := buildCreateProjectBody(&gen.CreateProjectRequest{Name: "todo", DeploymentPipeline: "default"})
	if body.Spec == nil || body.Spec.DeploymentPipelineRef == nil || body.Spec.DeploymentPipelineRef.Name != "default" {
		t.Fatalf("deploymentPipelineRef = %+v, want name default", body.Spec)
	}
	body = buildCreateProjectBody(&gen.CreateProjectRequest{Name: "todo"})
	if body.Spec != nil && body.Spec.DeploymentPipelineRef != nil {
		t.Errorf("deploymentPipelineRef = %+v, want omitted", body.Spec.DeploymentPipelineRef)
	}
}
