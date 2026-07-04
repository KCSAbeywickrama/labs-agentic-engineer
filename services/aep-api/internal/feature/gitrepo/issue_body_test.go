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
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/models"
)

func TestIssueTitle(t *testing.T) {
	t.Parallel()
	task := &models.ComponentTask{Title: "Implement auth service"}
	if got := IssueTitle(task); got != "Implement auth service" {
		t.Fatalf("IssueTitle = %q, want %q", got, task.Title)
	}
}

func TestNormalizeAppPath(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"/hello-api": "hello-api",
		"hello-api":  "hello-api",
		"/a/b":       "a/b",
		"":           "",
	}
	for in, want := range cases {
		if got := normalizeAppPath(in); got != want {
			t.Errorf("normalizeAppPath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestBuildIssueBody_FullLayout(t *testing.T) {
	t.Parallel()
	task := &models.ComponentTask{
		ComponentName: "auth-api",
		Title:         "Implement auth-api",
		Rationale:     "the platform needs authentication",
		Body:          "## Overview\nBuild the service.",
		IssueNumber:   42,
	}
	comp := &models.DesignComponent{
		ComponentType: "service",
		Language:      "go",
		AppPath:       "/auth-api",
		OpenAPISpec:   "openapi: 3.0.0",
	}
	out := BuildIssueBody(task, comp, "ignored-url", "ignored-slug")

	wantSubstrings := []string{
		"> the platform needs authentication\n\n", // rationale blockquote
		"## Overview\nBuild the service.",         // LLM body verbatim
		"## Component Reference",
		"- **Name:** auth-api",
		"- **Type:** service",
		"- **Language/Stack:** go",
		"- **App Path (within repo):** `auth-api`", // leading slash normalized
		"- **Design:** `specs/design/components/auth-api/design.json`",
		"- **Contract:** `specs/design/components/auth-api/openapi.yaml`",
		"- **System overview:** `specs/design/design.md`",
		"include `Closes #42`",
	}
	for _, sub := range wantSubstrings {
		if !strings.Contains(out, sub) {
			t.Errorf("BuildIssueBody output missing %q\n--- full output ---\n%s", sub, out)
		}
	}
}

func TestBuildIssueBody_NoRationale(t *testing.T) {
	t.Parallel()
	task := &models.ComponentTask{ComponentName: "c", Body: "body text", IssueNumber: 1}
	out := BuildIssueBody(task, nil, "", "")
	if strings.HasPrefix(out, ">") {
		t.Fatalf("output starts with a blockquote despite empty rationale:\n%s", out)
	}
}

func TestBuildIssueBody_NilComponent_OnlyName(t *testing.T) {
	t.Parallel()
	task := &models.ComponentTask{ComponentName: "c", IssueNumber: 5}
	out := BuildIssueBody(task, nil, "", "")
	if !strings.Contains(out, "- **Name:** c") {
		t.Fatalf("output missing component name line:\n%s", out)
	}
	// With a nil component, the type/language/design lines are omitted.
	for _, sub := range []string{"**Type:**", "**Language/Stack:**", "**Design:**"} {
		if strings.Contains(out, sub) {
			t.Fatalf("output has %q despite nil component:\n%s", sub, out)
		}
	}
}

func TestBuildIssueBody_ExternalContractLine(t *testing.T) {
	t.Parallel()
	task := &models.ComponentTask{ComponentName: "orders", IssueNumber: 7}
	comp := &models.DesignComponent{
		Name:          "orders",
		ComponentType: "service",
		Language:      "go",
		Dependencies: []models.Dependency{
			{Kind: models.DependencyKindExternal, Name: "stripe", SpecPath: "dependencies/stripe.openapi.yaml"},
			{Kind: models.DependencyKindExternal, Name: "nospec"},                        // no SpecPath → omitted
			{Kind: models.DependencyKindOrgService, Name: "employee-api", SpecPath: "x"}, // not external → omitted
		},
	}
	out := BuildIssueBody(task, comp, "", "")
	want := "- **API contract — stripe:** `specs/design/components/orders/dependencies/stripe.openapi.yaml` — implement the client against these exact operations; do not invent endpoints."
	if !strings.Contains(out, want) {
		t.Errorf("missing external contract line %q\n--- full output ---\n%s", want, out)
	}
	if strings.Contains(out, "nospec") {
		t.Errorf("external dep without SpecPath must not render a contract line:\n%s", out)
	}
	if strings.Contains(out, "employee-api") {
		t.Errorf("org-service dep must not render an external contract line:\n%s", out)
	}
}

func TestBuildIssueBody_OrgPublishedBlock(t *testing.T) {
	t.Parallel()
	task := &models.ComponentTask{ComponentName: "employee-api", IssueNumber: 3}

	published := &models.DesignComponent{Name: "employee-api", ComponentType: "service", ExposesAPI: &models.ExposesAPI{OrgPublished: true}}
	out := BuildIssueBody(task, published, "", "")
	for _, sub := range []string{
		"## Org-published service — endpoint visibility",
		"published org-wide",
		"visibility: [external, namespace]",
	} {
		if !strings.Contains(out, sub) {
			t.Errorf("org-published body missing %q\n--- full output ---\n%s", sub, out)
		}
	}

	// Not org-published (nil ExposesAPI, or OrgPublished false) → block absent.
	for _, comp := range []*models.DesignComponent{
		{Name: "employee-api", ComponentType: "service"},
		{Name: "employee-api", ComponentType: "service", ExposesAPI: &models.ExposesAPI{OrgPublished: false}},
	} {
		if got := BuildIssueBody(task, comp, "", ""); strings.Contains(got, "Org-published service") {
			t.Errorf("non-published component must not render the org-published block:\n%s", got)
		}
	}
}

func TestBuildOrgPublishIssueBody(t *testing.T) {
	t.Parallel()

	withPath := BuildOrgPublishIssueBody("employee-api", "/services/employee-api", "store-front")
	for _, sub := range []string{
		"Access request from project `store-front`",
		"publish the **employee-api** service org-wide",
		"## What to do",
		"targeted change to an already-built component",
		"Open `services/employee-api/workload.yaml`.", // leading slash normalized
		"visibility: [external, namespace]",
		"- **Name:** employee-api",
		"Closes #<this-issue>",
	} {
		if !strings.Contains(withPath, sub) {
			t.Errorf("BuildOrgPublishIssueBody missing %q\n--- full output ---\n%s", sub, withPath)
		}
	}

	// No app path → the generic workload.yaml instruction, no App Path line.
	noPath := BuildOrgPublishIssueBody("employee-api", "", "store-front")
	if !strings.Contains(noPath, "Open the component's `workload.yaml`.") {
		t.Errorf("empty appPath should render the generic workload.yaml step:\n%s", noPath)
	}
	if strings.Contains(noPath, "App Path") {
		t.Errorf("empty appPath must omit the App Path reference line:\n%s", noPath)
	}
}

func TestBuildIssueBody_OmitsContractWhenNoOpenAPI(t *testing.T) {
	t.Parallel()
	task := &models.ComponentTask{ComponentName: "c", IssueNumber: 9}
	comp := &models.DesignComponent{ComponentType: "webapp", Language: "ts"} // no OpenAPISpec, no AppPath
	out := BuildIssueBody(task, comp, "", "")
	if strings.Contains(out, "openapi.yaml") {
		t.Fatalf("output includes a Contract line despite empty OpenAPISpec:\n%s", out)
	}
	if strings.Contains(out, "App Path") {
		t.Fatalf("output includes an App Path line despite empty AppPath:\n%s", out)
	}
	// Design + Type lines still render (component is non-nil).
	if !strings.Contains(out, "- **Type:** webapp") {
		t.Fatalf("output missing Type line:\n%s", out)
	}
}
