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

package resources

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	ocmocks "github.com/wso2/aep/aep-api/internal/clients/openchoreo/mocks"
)

func TestResourceTypeCatalog_List(t *testing.T) {
	t.Parallel()

	rc := &ocmocks.ResourceClientMock{
		ListClusterResourceTypesFunc: func(_ context.Context) ([]openchoreo.ResourceType, error) {
			return []openchoreo.ResourceType{
				{Metadata: openchoreo.OCObjectMeta{Name: "redis-cnpg"}},
				{
					Metadata: openchoreo.OCObjectMeta{Name: "postgres-cnpg"},
					Spec: openchoreo.ResourceTypeSpec{
						Parameters: &openchoreo.SchemaSection{OpenAPIV3Schema: map[string]any{
							"properties": map[string]any{"version": map[string]any{"type": "string"}},
						}},
						Outputs: []openchoreo.ResourceTypeOutput{{Name: "host"}, {Name: "port"}, {Name: "password"}},
					},
				},
			}, nil
		},
	}

	got, err := NewResourceTypeCatalog(rc).List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	// Sorted by name: postgres-cnpg first.
	if len(got) != 2 || got[0].Name != "postgres-cnpg" {
		t.Fatalf("want postgres-cnpg first, got %+v", got)
	}
	if !reflect.DeepEqual(got[0].Outputs, []string{"host", "port", "password"}) {
		t.Fatalf("outputs: %+v", got[0].Outputs)
	}
	if _, ok := got[0].Parameters["version"]; !ok {
		t.Fatalf("parameters not projected from openAPIV3Schema.properties: %+v", got[0].Parameters)
	}
	// redis-cnpg carries no Parameters spec and no Outputs (zero-value path).
	if got[1].Name != "redis-cnpg" {
		t.Fatalf("want redis-cnpg at index 1, got %q", got[1].Name)
	}
	if got[1].Parameters != nil {
		t.Fatalf("want nil Parameters for redis-cnpg, got %+v", got[1].Parameters)
	}
	if len(got[1].Outputs) != 0 {
		t.Fatalf("want empty Outputs for redis-cnpg, got %+v", got[1].Outputs)
	}
}

func TestResourceTypeCatalog_ListError(t *testing.T) {
	t.Parallel()

	rc := &ocmocks.ResourceClientMock{
		ListClusterResourceTypesFunc: func(_ context.Context) ([]openchoreo.ResourceType, error) {
			return nil, errors.New("OC down")
		},
	}
	if _, err := NewResourceTypeCatalog(rc).List(context.Background()); err == nil {
		t.Fatal("want the client error surfaced")
	}
}
