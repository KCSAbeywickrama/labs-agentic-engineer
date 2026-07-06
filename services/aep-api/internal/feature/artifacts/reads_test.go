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

package artifacts

// Reads: the bundle at HEAD (the live draft) and at a `v*` tag (an approved
// version), plus the version list — all served by walking the repo tree via the
// Git Data API.

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

func TestListRequirementFiles_AtHead(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{
		"specs/requirements/requirements.md": "main\n",
		"specs/requirements/functional.md":   "func\n",
		"specs/requirements/nested/deep.md":  "ignored — requirements are flat\n",
		"specs/design/design.md":             "wrong subtree\n",
		"README.md":                          "outside specs\n",
	})
	got, err := r.svc.ListRequirementFiles(context.Background(), r.org, r.proj)
	if err != nil {
		t.Fatalf("ListRequirementFiles: %v", err)
	}
	want := map[string]string{"requirements.md": "main\n", "functional.md": "func\n"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("bundle = %v, want %v (flat, requirements-scoped)", got, want)
	}
}

func TestListDesignFiles_AtHead(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{
		"specs/design/design.md":                   "# system\n",
		"specs/design/components/svc/design.md":    "svc\n",
		"specs/design/components/svc/openapi.yaml": "openapi: 3.0.0\n",
		"specs/design/components/svc/design.json":  validComponentDesignJSON("svc"),
		"specs/requirements/requirements.md":       "wrong subtree\n",
	})
	got, err := r.svc.ListDesignFiles(context.Background(), r.org, r.proj)
	if err != nil {
		t.Fatalf("ListDesignFiles: %v", err)
	}
	want := map[string]string{
		"design.md":                   "# system\n",
		"components/svc/design.md":    "svc\n",
		"components/svc/openapi.yaml": "openapi: 3.0.0\n",
		"components/svc/design.json":  validComponentDesignJSON("svc"),
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("bundle = %v, want %v (recursive, design-scoped, keys relative to specs/design/)", got, want)
	}
}

func TestGetRequirementsAtTag_PinsApprovedVersion(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "v1 content\n"})
	ctx := context.Background()
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("save: %v", err)
	}
	// Draft moves past v1 on HEAD.
	r.seed(map[string]string{"specs/requirements/requirements.md": "later draft\n"}, "draft")

	at, err := r.svc.GetRequirementsAtTag(ctx, r.org, r.proj, "v1")
	if err != nil {
		t.Fatalf("GetRequirementsAtTag: %v", err)
	}
	if at["requirements.md"] != "v1 content\n" {
		t.Errorf("at v1 = %q, want the pinned v1 content (not HEAD)", at["requirements.md"])
	}
}

func TestGetDesignAtTag_PinsApprovedVersion(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "spec\n"})
	ctx := context.Background()
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("save requirements: %v", err)
	}
	r.seed(map[string]string{
		"specs/design/design.md":                  "# v1-1\n",
		"specs/design/components/svc/design.json": validComponentDesignJSON("svc"),
	}, "design")
	if _, err := r.svc.SaveDesign(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("save design: %v", err)
	}
	r.seed(map[string]string{"specs/design/design.md": "# later\n"}, "draft")

	at, err := r.svc.GetDesignAtTag(ctx, r.org, r.proj, "v1-1")
	if err != nil {
		t.Fatalf("GetDesignAtTag: %v", err)
	}
	if at["design.md"] != "# v1-1\n" {
		t.Errorf("at v1-1 = %q, want pinned design", at["design.md"])
	}
}

func TestGetRequirementsAtTag_MissingTag(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "x\n"})
	_, err := r.svc.GetRequirementsAtTag(context.Background(), r.org, r.proj, "v9")
	if !errors.Is(err, ErrArtifactNotFound) {
		t.Fatalf("err = %v, want ErrArtifactNotFound for an absent tag", err)
	}
}

func TestGetRequirementsAtTag_InvalidTag(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "x\n"})
	_, err := r.svc.GetRequirementsAtTag(context.Background(), r.org, r.proj, "not-a-tag")
	if !errors.Is(err, ErrInvalidVersionTag) {
		t.Fatalf("err = %v, want ErrInvalidVersionTag", err)
	}
}

func TestListRequirementsVersions_Descending(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "v1\n"})
	ctx := context.Background()
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("save v1: %v", err)
	}
	r.seed(map[string]string{"specs/requirements/requirements.md": "v2\n"}, "edit")
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("save v2: %v", err)
	}

	versions, err := r.svc.ListRequirementsVersions(ctx, r.org, r.proj)
	if err != nil {
		t.Fatalf("ListRequirementsVersions: %v", err)
	}
	if len(versions) != 2 || versions[0].Version != 2 || versions[1].Version != 1 {
		t.Fatalf("versions = %+v, want [v2, v1] descending", versions)
	}
	if versions[0].CommitHash != r.headSHA() {
		t.Errorf("v2 commit hash = %s, want the peeled tagged commit %s", versions[0].CommitHash, r.headSHA())
	}
	// The local tag read restores the annotation subject the Git Data refs API
	// could not expose — the versions endpoints now carry it.
	if versions[0].Message != "Requirements v2" || versions[1].Message != "Requirements v1" {
		t.Errorf("messages = [%q, %q], want the tag annotation subjects", versions[0].Message, versions[1].Message)
	}
}

// A fresh repo with no tags yet lists empty versions (not an error) for both
// artifact kinds — the no-tags edge of the version endpoints.
func TestListVersions_NoTagsYet_Empty(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "draft\n"})
	ctx := context.Background()
	reqs, err := r.svc.ListRequirementsVersions(ctx, r.org, r.proj)
	if err != nil || len(reqs) != 0 {
		t.Fatalf("ListRequirementsVersions = (%v, %v), want empty, nil", reqs, err)
	}
	designs, err := r.svc.ListDesignVersions(ctx, r.org, r.proj)
	if err != nil || len(designs) != 0 {
		t.Fatalf("ListDesignVersions = (%v, %v), want empty, nil", designs, err)
	}
}

// GetDesignAtCommit pins the exact commit — the publish flow's read of the
// commit its apply just created, never a ref resolution that could lag.
func TestGetDesignAtCommit_PinsExactCommit(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/design/design.md": "# early\n"})
	pinned := r.headSHA()
	r.seed(map[string]string{"specs/design/design.md": "# later\n"}, "later edit")

	at, err := r.svc.GetDesignAtCommit(context.Background(), r.org, r.proj, pinned)
	if err != nil {
		t.Fatalf("GetDesignAtCommit: %v", err)
	}
	if at["design.md"] != "# early\n" {
		t.Errorf("at %s = %q, want the pinned commit's content (not HEAD)", pinned, at["design.md"])
	}
}

// Branch-tip bundle reads freshen the mirror on every read: a commit made
// directly on the ORIGIN (an external writer) is visible immediately — there
// is no cache tier to go stale.
func TestListRequirementFiles_SeesOriginAdvanceImmediately(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "v1\n"})
	ctx := context.Background()

	got, err := r.svc.ListRequirementFiles(ctx, r.org, r.proj)
	if err != nil || got["requirements.md"] != "v1\n" {
		t.Fatalf("first read = (%v, %v), want v1", got, err)
	}

	r.seed(map[string]string{"specs/requirements/requirements.md": "v2 external\n"}, "external edit")

	got, err = r.svc.ListRequirementFiles(ctx, r.org, r.proj)
	if err != nil {
		t.Fatalf("second read: %v", err)
	}
	if got["requirements.md"] != "v2 external\n" {
		t.Errorf("second read = %q, want the origin's new commit (fetch freshness)", got["requirements.md"])
	}
}

// The agent writes component design.json (no per-component design.md since
// PR #70) — the assembler must surface those components, or the cell diagram
// and task reconciliation see an empty design.
func TestAssembleDesign_ComponentFromDesignJSON(t *testing.T) {
	t.Parallel()
	design, err := AssembleDesign(map[string]string{
		"design.md": "---\nsourceSpec: v1\n---\n# Overview\n",
		"components/task-api/design.json": `{"name":"task-api","type":"service","version":"1.0.0",` +
			`"language":"go","buildpack":"go","appPath":"task-api","entrypoint":"main.go",` +
			`"exposure":"internet","connections":[` +
			`{"to":"task-db","type":"datastore"},` +
			`{"to":"web-ui","type":"http","onPlatform":true},` +
			`{"to":"stripe","type":"http","onPlatform":false}` +
			`],"description":"Task CRUD API"}`,
		"components/task-api/openapi.yaml": "openapi: 3.0.0\n",
		"components/web-ui/design.json": `{"name":"web-ui","type":"web-app","version":"1.0.0",` +
			`"language":"ts","buildpack":"node","appPath":"web-ui","entrypoint":"index.ts",` +
			`"exposure":"internet","connections":[],"description":"UI"}`,
	})
	if err != nil {
		t.Fatalf("AssembleDesign: %v", err)
	}
	if len(design.Components) != 2 {
		t.Fatalf("components = %d, want 2 (design.json-only components must assemble)", len(design.Components))
	}
	c := design.Components[0]
	if c.Name != "task-api" || c.ComponentType != "service" || c.Language != "go" {
		t.Errorf("component = %+v, want task-api/service/go from design.json", c)
	}
	if c.OpenAPISpec != "openapi: 3.0.0\n" {
		t.Errorf("OpenAPISpec = %q, want sibling openapi.yaml content", c.OpenAPISpec)
	}
	if c.ComponentAgentInstructions != "Task CRUD API" {
		t.Errorf("instructions = %q, want design.json description", c.ComponentAgentInstructions)
	}
	// DependsOn keeps its legacy meaning: sibling components only. task-db is
	// on-platform but not a component dir; stripe is off-platform.
	if len(c.DependsOn) != 1 || c.DependsOn[0] != "web-ui" {
		t.Errorf("dependsOn = %v, want [web-ui]", c.DependsOn)
	}
	if len(c.DependentApis) != 1 || c.DependentApis[0].Name != "stripe" {
		t.Errorf("dependentApis = %+v, want [stripe] (off-platform connection)", c.DependentApis)
	}
}

// design.json wins over a legacy design.md when both exist — the json is the
// gated, schema-validated authority.
func TestAssembleDesign_DesignJSONPrecedesLegacyMd(t *testing.T) {
	t.Parallel()
	design, err := AssembleDesign(map[string]string{
		"design.md":                   "# o\n",
		"components/svc/design.md":    "---\ntype: web-app\nlanguage: python\n---\nlegacy body\n",
		"components/svc/design.json":  validComponentDesignJSON("svc"),
		"components/legacy/design.md": "---\ntype: service\nlanguage: java\n---\nold-style component\n",
	})
	if err != nil {
		t.Fatalf("AssembleDesign: %v", err)
	}
	if len(design.Components) != 2 {
		t.Fatalf("components = %d, want 2", len(design.Components))
	}
	byName := map[string]int{}
	for i, c := range design.Components {
		byName[c.Name] = i
	}
	svc := design.Components[byName["svc"]]
	if svc.ComponentType != "service" || svc.Language != "go" {
		t.Errorf("svc = %+v, want design.json values (service/go), not legacy md (web-app/python)", svc)
	}
	legacy := design.Components[byName["legacy"]]
	if legacy.ComponentType != "service" || legacy.Language != "java" {
		t.Errorf("legacy = %+v, want frontmatter fallback to keep working", legacy)
	}
}

// A malformed design.json fails the assemble loudly (same strictness as broken
// design.md frontmatter) — never a silently missing component.
func TestAssembleDesign_MalformedDesignJSONErrors(t *testing.T) {
	t.Parallel()
	_, err := AssembleDesign(map[string]string{
		"design.md":                  "# o\n",
		"components/bad/design.json": "{not json",
	})
	if err == nil {
		t.Fatal("want error for malformed design.json, got nil")
	}
}
