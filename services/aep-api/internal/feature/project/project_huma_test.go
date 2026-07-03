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

package project

import (
	"context"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2/humatest"

	"github.com/wso2/aep/aep-api/models"
)

// fakeSpecProjectService satisfies ProjectService for registration only; no
// request ever reaches it in this file.
type fakeSpecProjectService struct{}

func (fakeSpecProjectService) ListProjects(context.Context, string, int, string) (*models.ProjectList, error) {
	return nil, nil
}
func (fakeSpecProjectService) GetProject(context.Context, string, string) (*models.Project, error) {
	return nil, nil
}
func (fakeSpecProjectService) CreateProject(context.Context, string, *models.CreateProjectRequest) (*models.Project, error) {
	return nil, nil
}
func (fakeSpecProjectService) DeleteProject(context.Context, string, string) error { return nil }
func (fakeSpecProjectService) GetProjectStatus(context.Context, string, string) (*models.ProjectStatus, error) {
	return nil, nil
}

// TestRegisterProject_Spec is a registration/spec check ONLY: RegisterProject
// does not panic and the generated OpenAPI carries every project operation.
// It deliberately sends no requests — behavioral coverage (status codes,
// validation, error mapping, the ENFORCE gate) lives in
// project_component_test.go, which drives the real production chain through
// the componenttest harness. This split is bff-component-testing.md §8.3:
// spec tests must not flip the (now request-scoped) gate mode.
func TestRegisterProject_Spec(t *testing.T) {
	t.Parallel()

	_, api := humatest.New(t)
	RegisterProject(api, fakeSpecProjectService{})

	spec, err := api.OpenAPI().YAML()
	if err != nil {
		t.Fatalf("spec: %v", err)
	}
	for _, want := range []string{
		"list-projects", "create-project", "get-project", "delete-project",
		"get-project-status", "/projects", "/projects/{projectName}",
	} {
		if !strings.Contains(string(spec), want) {
			t.Fatalf("spec missing %q", want)
		}
	}
}
