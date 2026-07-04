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

// Save = hard semantic gate → annotated tag at HEAD (no commit). These run over
// the real Git Data API fake, so the tag lands as a genuine annotated tag object
// in the bare repo.

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
)

// validComponentDesignJSON is a component design.json that satisfies the
// published schema (docs/design/agents-generation-migration.md §8) for a
// component whose directory name is `name`.
func validComponentDesignJSON(name string) string {
	return `{"name":"` + name + `","type":"service","version":"1.0.0","language":"go",` +
		`"buildpack":"go","appPath":".","entrypoint":"main.go","exposure":"internet",` +
		`"connections":[],"description":"a service"}`
}

func TestSaveRequirements_TagsAtHead(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "v1 body\n"})
	head := r.headSHA()

	res, err := r.svc.SaveRequirements(context.Background(), r.org, r.proj, SaveRequest{Message: "cut v1"})
	if err != nil {
		t.Fatalf("SaveRequirements: %v", err)
	}
	if res.Status != "approved" || res.Tag != "v1" || res.Version != 1 {
		t.Fatalf("result = %+v, want approved/v1/1", res)
	}
	if res.CommitHash != head {
		t.Errorf("tag points at %s, want HEAD %s (no new commit on save)", res.CommitHash, head)
	}
	if r.headSHA() != head {
		t.Errorf("HEAD moved to %s — save must NOT commit", r.headSHA())
	}
	if got := r.tags(); len(got) != 1 || got[0] != "v1" {
		t.Errorf("tags = %v, want [v1]", got)
	}
}

func TestSaveRequirements_Unchanged(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "v1 body\n"})
	ctx := context.Background()
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("first save: %v", err)
	}
	// HEAD still equals v1's content → re-save is a no-op.
	res, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{})
	if err != nil {
		t.Fatalf("second save: %v", err)
	}
	if res.Status != "unchanged" || res.Tag != "v1" {
		t.Fatalf("result = %+v, want unchanged/v1", res)
	}
	if got := r.tags(); len(got) != 1 {
		t.Errorf("tags = %v, want a single v1 (no duplicate tag)", got)
	}
}

func TestSaveRequirements_GateMissingMain(t *testing.T) {
	t.Parallel()
	// A requirements dir with only a sibling doc, no requirements.md → gate fails.
	r := newRig(t, map[string]string{"specs/requirements/functional.md": "stuff\n"})
	_, err := r.svc.SaveRequirements(context.Background(), r.org, r.proj, SaveRequest{})
	if !errors.Is(err, ErrArtifactPathInvalid) {
		t.Fatalf("err = %v, want ErrArtifactPathInvalid (requirements.md missing)", err)
	}
	if got := r.tags(); len(got) != 0 {
		t.Errorf("tags = %v, want none (nothing may be tagged when the gate fails)", got)
	}
}

func TestSaveRequirements_TagCollision_RecomputesToNextName(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "body\n"})
	// v1 already claimed externally at an earlier state, and the draft has since
	// moved on → save wants a new tag but must skip the taken v1 and land v2.
	r.tag("v1", "external v1")
	r.seed(map[string]string{"specs/requirements/requirements.md": "moved on\n"}, "draft edit")

	res, err := r.svc.SaveRequirements(context.Background(), r.org, r.proj, SaveRequest{})
	if err != nil {
		t.Fatalf("SaveRequirements: %v", err)
	}
	if res.Tag != "v2" || res.Version != 2 {
		t.Fatalf("result = %+v, want v2/2 (skip the taken v1)", res)
	}
	tags := r.tags()
	if len(tags) != 2 || tags[0] != "v1" || tags[1] != "v2" {
		t.Errorf("tags = %v, want [v1 v2] (v1 preserved)", tags)
	}
}

// TestSaveRequirements_TagCollision_Real422ThroughRealClient forces a true
// external-pusher collision in the window between the save's fresh tag-list
// fetch and its CreateTagRef, via the harness BeforeCreateTagRef hook. The REAL
// clients/github CreateTagRef receives a genuine 422 and must translate it to
// ErrTagAlreadyExists for retryOnTagCollision to recompute (v2) — the only test
// proving that 422→sentinel mapping.
func TestSaveRequirements_TagCollision_Real422ThroughRealClient(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "body\n"})

	fired := false
	r.gd.BeforeCreateTagRef = func() {
		if fired {
			return
		}
		fired = true
		r.tag("v1", "external claim in the race window")
	}

	res, err := r.svc.SaveRequirements(context.Background(), r.org, r.proj, SaveRequest{})
	if err != nil {
		t.Fatalf("SaveRequirements: %v", err)
	}
	if !fired {
		t.Fatal("BeforeCreateTagRef hook never fired — collision was not injected")
	}
	if res.Tag != "v2" || res.Version != 2 {
		t.Fatalf("result = %+v, want v2/2 (retry past the claimed v1)", res)
	}
}

func TestSaveDesign_TagsAtHead(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "spec\n"})
	ctx := context.Background()
	// A requirements baseline must exist for a design tag.
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("save requirements: %v", err)
	}
	// Add a valid design bundle to main.
	r.seed(map[string]string{
		"specs/design/design.md":                  "# System\n",
		"specs/design/components/svc/design.md":   "---\ntype: service\n---\n# svc\n",
		"specs/design/components/svc/design.json": validComponentDesignJSON("svc"),
	}, "add design")
	head := r.headSHA()

	res, err := r.svc.SaveDesign(ctx, r.org, r.proj, SaveRequest{})
	if err != nil {
		t.Fatalf("SaveDesign: %v", err)
	}
	if res.Status != "approved" || res.Tag != "v1-1" || res.RequirementsVersion != 1 || res.DesignRevision != 1 {
		t.Fatalf("result = %+v, want approved/v1-1/1/1", res)
	}
	if res.CommitHash != head || r.headSHA() != head {
		t.Errorf("save must tag HEAD without committing (head=%s got=%s)", head, r.headSHA())
	}
}

func TestSaveDesign_NoRequirementsBaseline(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/design/design.md": "# System\n"})
	_, err := r.svc.SaveDesign(context.Background(), r.org, r.proj, SaveRequest{})
	if !errors.Is(err, ErrNoRequirementsBaseline) {
		t.Fatalf("err = %v, want ErrNoRequirementsBaseline", err)
	}
}

func TestSaveDesign_GateMissingLayout(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "spec\n"})
	ctx := context.Background()
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("save requirements: %v", err)
	}
	// A component but no root design.md → layout gate fails.
	r.seed(map[string]string{
		"specs/design/components/svc/design.json": validComponentDesignJSON("svc"),
	}, "design without root")
	_, err := r.svc.SaveDesign(ctx, r.org, r.proj, SaveRequest{})
	if !errors.Is(err, ErrArtifactPathInvalid) {
		t.Fatalf("err = %v, want ErrArtifactPathInvalid (missing design.md)", err)
	}
}

func TestSaveDesign_GateSchemaViolation(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "spec\n"})
	ctx := context.Background()
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("save requirements: %v", err)
	}
	// design.json missing the required "description" → SCHEMA_VIOLATION.
	bad := `{"name":"svc","type":"service","version":"1.0.0","language":"go",` +
		`"buildpack":"go","appPath":".","entrypoint":"main.go","exposure":"internet","connections":[]}`
	r.seed(map[string]string{
		"specs/design/design.md":                  "# System\n",
		"specs/design/components/svc/design.json": bad,
	}, "bad design.json")

	_, err := r.svc.SaveDesign(ctx, r.org, r.proj, SaveRequest{})
	var ve *DesignValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("err = %v, want *DesignValidationError", err)
	}
	if len(ve.Files) == 0 || ve.Files[0].Code != "SCHEMA_VIOLATION" {
		t.Fatalf("validation files = %+v, want a SCHEMA_VIOLATION on the design.json", ve.Files)
	}
	if got := r.tags(); len(got) != 1 { // only the v1 requirements tag; no design tag
		t.Errorf("tags = %v, want just the requirements v1 (malformed design never tagged)", got)
	}
}

func TestSaveDesign_GateNameMismatch(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "spec\n"})
	ctx := context.Background()
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("save requirements: %v", err)
	}
	// design.json valid against the schema but name != component directory.
	r.seed(map[string]string{
		"specs/design/design.md":                  "# System\n",
		"specs/design/components/svc/design.json": validComponentDesignJSON("other"),
	}, "name mismatch")

	_, err := r.svc.SaveDesign(ctx, r.org, r.proj, SaveRequest{})
	var ve *DesignValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("err = %v, want *DesignValidationError (name != dir)", err)
	}
}

func TestSaveDesign_GateBrokenOpenAPI(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "spec\n"})
	ctx := context.Background()
	if _, err := r.svc.SaveRequirements(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("save requirements: %v", err)
	}
	r.seed(map[string]string{
		"specs/design/design.md":                   "# System\n",
		"specs/design/components/svc/openapi.yaml": "this: : : not valid yaml: [\n",
	}, "broken openapi")

	_, err := r.svc.SaveDesign(ctx, r.org, r.proj, SaveRequest{})
	var ve *DesignValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("err = %v, want *DesignValidationError (broken openapi)", err)
	}
	if ve.Files[0].Code != codeInvalidOpenAPI {
		t.Errorf("code = %s, want %s", ve.Files[0].Code, codeInvalidOpenAPI)
	}
}

// ----- CAS-under-tag-collision full-flow (moved from the clone era) -----

func TestSaveRequirements_TagCollision_ConcurrentClaim(t *testing.T) {
	t.Parallel()
	r := newRig(t, map[string]string{"specs/requirements/requirements.md": "body\n"})

	var claims int32
	var once sync.Once
	r.gd.BeforeCreateTagRef = func() {
		atomic.AddInt32(&claims, 1)
		once.Do(func() { r.tag("v1", "external") })
	}
	res, err := r.svc.SaveRequirements(context.Background(), r.org, r.proj, SaveRequest{})
	if err != nil {
		t.Fatalf("SaveRequirements: %v", err)
	}
	if res.Tag != "v2" {
		t.Fatalf("tag = %s, want v2 after the injected collision", res.Tag)
	}
	if n := atomic.LoadInt32(&claims); n < 2 {
		t.Errorf("CreateTagRef attempts = %d, want ≥2 (first collides, retry lands v2)", n)
	}
}
