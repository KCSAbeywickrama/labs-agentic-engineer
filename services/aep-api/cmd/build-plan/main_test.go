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

package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// requirements is a two-feature product: F1 (the page) needs F2 (the API).
var requirements = map[string]string{
	"prd.md": "# Hello\n\n## Problem Statement\n\nA greeting.\n\n## Solution\n\nA page and an API.\n\n## Features\n\n" +
		"- F1 [Greeting page](features/F1-greeting-page.md)\n- F2 [Greeting API](features/F2-greeting-api.md)\n",
	"product-wide.md": "# Product-wide\n\n## Requirements\n\n- P1 Users sign in through SSO. Applies to: all.\n",
	"features/F1-greeting-page.md": "# Greeting page\n\n## Purpose\n\nShow the greeting.\n\nNeeds: F2.\n\n## User Stories\n\n" +
		"- F1.1 As a signed-in user, I see the hello message.\n",
	"features/F2-greeting-api.md": "# Greeting API\n\n## Purpose\n\nServe the greeting.\n\n## User Stories\n\n" +
		"- F2.1 As a signed-in user, I get the hello message.\n",
}

// design is a design of both features that passes the build gate: each
// component enriched, claiming its feature's story, the service with its
// openapi.yaml.
var design = map[string]string{
	"design.cell":                         "component hello-api service\ncomponent hello-webapp web-application\n",
	"components/hello-api/design.json":    enriched("hello-api", "service", "F2.1"),
	"components/hello-api/openapi.yaml":   "openapi: 3.0.3\n",
	"components/hello-webapp/design.json": enriched("hello-webapp", "web-application", "F1.1"),
}

func enriched(id, typ, story string) string {
	return `{"name":"` + id + `","type":"` + typ + `","version":"0.1.0","language":"Go","buildpack":"docker","appPath":"` + id +
		`","entrypoint":"deployment/` + typ + `","exposure":"intranet","stories":["` + story + `"],"dependencies":[],"description":"Serves the greeting."}`
}

func writeTree(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for path, body := range files {
		if err := os.MkdirAll(filepath.Join(dir, filepath.Dir(path)), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, path), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func writeRequirements(t *testing.T) string { return writeTree(t, requirements) }

func writeDesign(t *testing.T) string { return writeTree(t, design) }

func runCmd(t *testing.T, stdin string, args ...string) (int, string, string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code := run(args, strings.NewReader(stdin), &out, &errOut)
	return code, out.String(), errOut.String()
}

// Picking F1 pulls in F2, which it needs: the scope carries both, F1 after
// F2, and the product-wide item that reaches them.
func TestScope_APickPullsInWhatItNeeds(t *testing.T) {
	dir := writeRequirements(t)
	code, out, errOut := runCmd(t, "", "scope", "--requirements-dir", dir, "--design-dir", writeDesign(t), "--version", "v1", "--features", "F1", "--product-wide", "P1")
	if code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	var got struct {
		Plan  wirePlan  `json:"plan"`
		Scope wireScope `json:"scope"`
	}
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	if strings.Join(got.Plan.Features, " ") != "F1 F2" || strings.Join(got.Plan.PulledIn, " ") != "F2" {
		t.Errorf("plan = %+v, want F1 picked and F2 pulled in", got.Plan)
	}
	if got.Scope.Tag != "v1" || len(got.Scope.Features) != 2 || strings.Join(got.Scope.Features[0].Needs, ",") != "F2" {
		t.Errorf("scope = %+v, want F1 needing F2", got.Scope)
	}
	if len(got.Scope.ProductWide) != 1 || got.Scope.ProductWide[0].ID != "P1" {
		t.Errorf("product-wide = %+v", got.Scope.ProductWide)
	}
}

// What an earlier version built is not built again: v2 picking F1 after a v1
// that built F2 carries F1 alone.
func TestScope_WhatWasBuiltIsNotCarriedAgain(t *testing.T) {
	dir := writeRequirements(t)
	code, out, errOut := runCmd(t, "", "scope", "--requirements-dir", dir, "--design-dir", writeDesign(t), "--version", "v2", "--features", "F1", "--built-features", "F2", "--built-product-wide", "P1")
	if code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	if !strings.Contains(out, `"features": [
      "F1"
    ]`) {
		t.Errorf("plan does not carry F1 alone: %s", out)
	}
}

// A feature the requirements do not have is refused, with the reason, as
// POST /build refuses it.
func TestScope_AnUnknownFeatureIsRefused(t *testing.T) {
	code, _, errOut := runCmd(t, "", "scope", "--requirements-dir", writeRequirements(t), "--design-dir", writeDesign(t), "--version", "v1", "--features", "F9")
	if code != 1 || !strings.Contains(errOut, "F9 is not a feature of the requirements") {
		t.Fatalf("exit %d, stderr %q, want the refusal", code, errOut)
	}
}

// scope runs POST /build's hard gate over the design: a story no component
// claims, and a web-application's half prototype, refuse the build with the
// gate's findings, one `<path>: <message>` line each, beside the selection's
// own refusal.
func TestScope_TheBuildGateRefusesAnUnbuildableDesign(t *testing.T) {
	files := map[string]string{}
	for path, body := range design {
		files[path] = body
	}
	files["components/hello-webapp/design.json"] = enriched("hello-webapp", "web-application", "F2.1")
	files["components/hello-webapp/prototype.tsx"] = "export default function App() { return null; }\n"
	code, out, errOut := runCmd(t, "", "scope", "--requirements-dir", writeRequirements(t), "--design-dir", writeTree(t, files),
		"--version", "v1", "--features", "F1,F9")
	if code != 1 || out != "" {
		t.Fatalf("exit %d, stdout %q, want a refusal", code, out)
	}
	for _, want := range []string{
		"F9 is not a feature of the requirements",
		"specs/design/design.cell: story F1.1 is in the requirements but no component's design.json lists it",
		"specs/design/components/hello-webapp/prototype.json: component \"hello-webapp\" has prototype.tsx but no prototype.json",
	} {
		if !strings.Contains(errOut, want) {
			t.Errorf("stderr lacks %q:\n%s", want, errOut)
		}
	}
}

// A project with no design yet is refused as POST /build refuses it, and a
// story an acceptance file tags that the requirements do not have refuses the
// build too: the acceptance folder is optional, the gate over it is not.
func TestScope_TheGateReadsTheDesignAndAcceptanceFolders(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "design")
	code, _, errOut := runCmd(t, "", "scope", "--requirements-dir", writeRequirements(t), "--design-dir", missing, "--version", "v1")
	if code != 1 || !strings.Contains(errOut, "design.cell missing") {
		t.Fatalf("no design: exit %d, stderr %q, want the missing-design refusal", code, errOut)
	}

	acceptance := writeTree(t, map[string]string{"F1-greeting-page.feature": "Feature: Greeting\n\n  @story-F1.9\n  Scenario: hello\n"})
	code, _, errOut = runCmd(t, "", "scope", "--requirements-dir", writeRequirements(t), "--design-dir", writeDesign(t),
		"--acceptance-dir", acceptance, "--version", "v1")
	if code != 1 || !strings.Contains(errOut, "specs/validation/acceptance/F1-greeting-page.feature: @story-F1.9") {
		t.Fatalf("stale acceptance tag: exit %d, stderr %q, want the acceptance refusal", code, errOut)
	}
}

// issue renders the build issue from the same selection and the planner's
// checklist: the plan service's own render.
func TestIssue_RendersTheBuildIssue(t *testing.T) {
	items := `{"items":[{"item":"foundation","components":["hello-api"],"note":"Sign-in."},{"item":"F2","components":["hello-api"],"note":"The endpoint."},{"item":"F1","components":["hello-webapp"],"note":"The page."}]}`
	code, out, errOut := runCmd(t, items, "issue", "--requirements-dir", writeRequirements(t), "--version", "v1", "--features", "F1", "--product-wide", "P1")
	if code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	var got struct{ Title, Body string }
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatal(err)
	}
	want := "Version `v1`: the spec is `specs/` at tag `v1`.\n\n" +
		"- [ ] **foundation** Shared setup and product-wide requirements: `hello-api`. Sign-in.\n" +
		"- [ ] **F2** Greeting API: `hello-api`. The endpoint.\n" +
		"- [ ] **F1** Greeting page: `hello-webapp`. The page.\n" +
		"\nProduct-wide: P1\n"
	if got.Title != "Build v1" || got.Body != want {
		t.Fatalf("issue = %q\n%s\nwant:\n%s", got.Title, got.Body, want)
	}
}

func TestUsageErrors(t *testing.T) {
	for _, args := range [][]string{
		{},
		{"plan"},
		{"scope", "--version", "v1"},
		{"scope", "--requirements-dir", "x", "--design-dir", "y", "--version", "tags/../v1"},
		{"scope", "--requirements-dir", "x", "--version", "v1"},
		{"issue", "--requirements-dir", "x", "--design-dir", "y", "--version", "v1"},
	} {
		if code, _, _ := runCmd(t, "", args...); code != 2 {
			t.Errorf("%v: exit %d, want 2", args, code)
		}
	}
	if code, _, _ := runCmd(t, "{}", "issue", "--requirements-dir", writeRequirements(t), "--version", "v1"); code != 2 {
		t.Errorf("issue with no items: exit %d, want 2", code)
	}
}
