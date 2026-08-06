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
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIsInternalComponent(t *testing.T) {
	if !isInternalComponent(map[string]string{"aep.wso2.com/internal": "true"}, nil) {
		t.Fatal("annotation should mark internal")
	}
	if !isInternalComponent(nil, map[string]string{"aep.wso2.com/internal": "true"}) {
		t.Fatal("label should mark internal")
	}
	if isInternalComponent(map[string]string{"aep.wso2.com/internal": "false"}, nil) {
		t.Fatal("false must not filter")
	}
	if isInternalComponent(nil, nil) {
		t.Fatal("empty must not filter")
	}
}

func TestListComponents_FiltersInternal(t *testing.T) {
	const project = "proj"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || !strings.HasSuffix(r.URL.Path, "/components") {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		writeJSON(t, w, http.StatusOK, map[string]any{
			"items": []any{
				map[string]any{
					"metadata": map[string]any{
						"name": ScopedComponentName(project, "ca-hidden"),
						"annotations": map[string]string{
							annotationInternal: "true",
						},
					},
					"spec": map[string]any{
						"componentType": map[string]any{"kind": "ClusterComponentType", "name": "coding-agent"},
						"owner":         map[string]any{"projectName": project},
					},
				},
				map[string]any{
					"metadata": map[string]any{
						"name": ScopedComponentName(project, "web"),
					},
					"spec": map[string]any{
						"componentType": map[string]any{"kind": "ClusterComponentType", "name": "deployment/web-application"},
						"owner":         map[string]any{"projectName": project},
					},
				},
			},
		})
	}))
	defer srv.Close()

	c := NewComponentClient(Config{BaseURL: srv.URL})
	list, err := c.ListComponents(context.Background(), "org", project, 100, "")
	if err != nil {
		t.Fatalf("ListComponents: %v", err)
	}
	if len(list.Items) != 1 {
		t.Fatalf("Items length = %d, want 1", len(list.Items))
	}
	if list.Items[0].Name != "web" {
		t.Fatalf("Name = %q, want %q", list.Items[0].Name, "web")
	}
}
