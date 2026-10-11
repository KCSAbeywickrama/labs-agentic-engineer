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

package spec

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/platform/reqspec"
)

// The build order among a version's features (B3): a file's `Needs:` is
// followed; a story's own need joins unless it would close a loop, and a
// feature an earlier version built is not waited on.
func TestFeatureOrder(t *testing.T) {
	spec := reqspec.Parse(map[string]string{
		"features/F1-claims.md":    "# Claims\n\n## User Stories\n\n- F1.1 Submit. \n- F1.3 See the decision. Needs: F2.\n",
		"features/F2-approvals.md": "# Approvals\n\n## Purpose\n\nDecide claims.\n\nNeeds: F1.\n\n## User Stories\n\n- F2.1 Approve.\n",
		"features/F3-report.md":    "# Report\n\n## Purpose\n\nNeeds: F2.\n\n## User Stories\n\n- F3.1 Total. Needs: F1.\n",
		"features/F4-export.md":    "# Export\n\n## User Stories\n\n- F4.1 Export. Needs: F3.\n",
	})
	got := featureOrder(spec, []string{"F1", "F2", "F3", "F4"})
	want := map[string]string{"F1": "[]", "F2": "[F1]", "F3": "[F1 F2]", "F4": "[F3]"}
	for id, w := range want {
		if fmt.Sprint(got[id]) != w {
			t.Errorf("%s is built after %v, want %s", id, got[id], w)
		}
	}

	// F1 built earlier: F2 waits on nothing this version brings.
	if got := featureOrder(spec, []string{"F2", "F3"}); fmt.Sprint(got["F2"]) != "[]" || fmt.Sprint(got["F3"]) != "[F2]" {
		t.Errorf("with F1 built = %v", got)
	}
}

// A repair version (B4) is a point release at the fixed version's commit,
// carrying its features, recorded as fixing it, and taking no number of its own.
func TestTagRepair(t *testing.T) {
	t.Parallel()
	seed := validSpecSeed()
	r := newRig(t, seed)
	ctx := context.Background()
	v1, err := r.svc.SaveSpec(ctx, r.org, r.proj, SaveRequest{Pick: &reqspec.Pick{Features: []string{"F1"}}})
	if err != nil {
		t.Fatal(err)
	}
	first, err := r.svc.TagRepair(ctx, r.org, r.proj, v1.Tag)
	if err != nil || first != v1.Tag+".1" {
		t.Fatalf("TagRepair = %q, %v", first, err)
	}
	// A repair of the repair fixes the version the repair fixed.
	if second, err := r.svc.TagRepair(ctx, r.org, r.proj, first); err != nil || second != v1.Tag+".2" {
		t.Fatalf("TagRepair(%s) = %q, %v", first, second, err)
	}
	versions, err := r.svc.ListVersions(ctx, r.org, r.proj)
	if err != nil || len(versions) != 3 {
		t.Fatalf("versions = %+v, %v", versions, err)
	}
	if v := versions[1]; v.Fixes != v1.Tag || fmt.Sprint(v.Features[0].ID) != "F1" {
		t.Errorf("repair = %+v, want F1 fixing %s", v, v1.Tag)
	}
	if _, err := r.svc.TagRepair(ctx, r.org, r.proj, "v9"); !errors.Is(err, ErrNothingToRepair) {
		t.Errorf("repair of an unknown version = %v", err)
	}
	facts, err := r.svc.BuildVersionFacts(ctx, r.org, r.proj)
	if err != nil || facts.SuggestedVersion != "v2" {
		t.Errorf("next suggested = %+v, %v, want v2: a repair takes no number", facts, err)
	}
}

// The spec workspace's state (N5): each designed feature's basis as its last
// design read it — so an edit since shows as out of date in the console — and
// nothing for a feature no design covered.
func TestSpecState_DesignedFrom(t *testing.T) {
	t.Parallel()
	seed := validSpecSeed()
	seed["specs/requirements/features/F2-notify.md"] = "# Notify\n\n## User Stories\n\n- F2.1 As a user, I want S, so that s.\n"
	r := newRig(t, seed)
	designedAt := r.headSHA()
	r.svc.SetDesignLedger(stubLedger{runs: []DesignRun{{BaseRef: designedAt, Features: []string{"F2"}}}})
	r.seed(map[string]string{
		"specs/requirements/features/F2-notify.md": "# Notify\n\n## User Stories\n\n- F2.1 As a user, I want S by Slack, so that s.\n",
	}, "F2 edit")

	st, err := r.svc.SpecState(context.Background(), r.org, r.proj)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := st.DesignedFrom["F1"]; ok {
		t.Errorf("F1 was never designed, but has a basis")
	}
	if got := st.DesignedFrom["F2"]; got != "Notify\nUser Stories\nF2.1 As a user, I want S, so that s." {
		t.Errorf("F2's basis = %q, want what the design read, before the edit", got)
	}
}

// L30: a design run's own requirement edits (the gap check's assumed lines and
// questions) are part of what it designed, so its basis is the requirements
// as the run left them (EndRef) and those edits never read as out of date. An
// edit after the run still does.
func TestSpecState_DesignedFromIsWhereTheRunLeftTheRequirements(t *testing.T) {
	t.Parallel()
	seed := validSpecSeed()
	seed["specs/requirements/features/F2-notify.md"] = "# Notify\n\n## User Stories\n\n- F2.1 As a user, I want S, so that s.\n"
	seed["specs/design/components/svc/design.json"] = svcDesignCovering("F1.1", "F2.1", "F2.2")
	r := newRig(t, seed)
	startedAt := r.headSHA()
	// The run's gap check adds an assumed line to F2 while it designs.
	endedAt := r.seed(map[string]string{
		"specs/requirements/features/F2-notify.md": "# Notify\n\n## User Stories\n\n- F2.1 As a user, I want S, so that s.\n- F2.2 Notices go out nightly. *assumed*\n",
	}, "the design run's gap check")
	r.svc.SetDesignLedger(stubLedger{runs: []DesignRun{{BaseRef: startedAt, EndRef: endedAt, Features: []string{"F2"}}}})
	ctx := context.Background()

	st, err := r.svc.SpecState(ctx, r.org, r.proj)
	if err != nil {
		t.Fatal(err)
	}
	if got := st.DesignedFrom["F2"]; got != "Notify\nUser Stories\nF2.1 As a user, I want S, so that s.\nF2.2 Notices go out nightly." {
		t.Errorf("F2's basis = %q, want the requirements as the run left them", got)
	}
	if _, err := r.svc.SaveSpec(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("the design run's own edit made F2 out of date: %v", err)
	}

	// Confirming the assumption drops a tag and moves no words.
	r.seed(map[string]string{
		"specs/requirements/features/F2-notify.md": "# Notify\n\n## User Stories\n\n- F2.1 As a user, I want S, so that s.\n- F2.2 Notices go out nightly.\n",
	}, "confirm")
	if _, err := r.svc.SaveSpec(ctx, r.org, r.proj, SaveRequest{}); err != nil {
		t.Fatalf("confirming the run's assumption made F2 out of date: %v", err)
	}

	r.seed(map[string]string{
		"specs/requirements/features/F2-notify.md": "# Notify\n\n## User Stories\n\n- F2.1 As a user, I want S by Slack, so that s.\n- F2.2 Notices go out nightly.\n",
	}, "a later edit")
	if _, err := r.svc.SaveSpec(ctx, r.org, r.proj, SaveRequest{}); !containsPath(specErrPaths(t, err), "specs/requirements/features/F2-notify.md") {
		t.Fatalf("an edit after the run did not make F2 out of date: %v", err)
	}
}

// A bare `/design` covers the features designable when it started: its basis
// is where it left them, but a stub its edits filled in was not designed.
// A run whose end cannot be read falls back to its start.
func TestSpecState_BareDesignRunKeepsItsScope(t *testing.T) {
	t.Parallel()
	seed := validSpecSeed()
	seed["specs/requirements/features/F2-notify.md"] = "# Notify\n"
	r := newRig(t, seed)
	startedAt := r.headSHA()
	endedAt := r.seed(map[string]string{
		"specs/requirements/features/F1-core.md":   "# Core\n\n## User Stories\n\n- F1.1 As a user, I want the thing, so that value.\n- F1.2 It runs daily. *assumed*\n",
		"specs/requirements/features/F2-notify.md": "# Notify\n\n## User Stories\n\n- F2.1 As a user, I want S, so that s.\n",
	}, "the design run")
	resolve := func(runs ...DesignRun) {
		r.svc.SetDesignLedger(stubLedger{runs: runs})
	}
	resolve(DesignRun{BaseRef: startedAt, EndRef: endedAt})
	st, err := r.svc.SpecState(context.Background(), r.org, r.proj)
	if err != nil {
		t.Fatal(err)
	}
	if got := st.DesignedFrom["F1"]; got != "Core\nUser Stories\nF1.1 As a user, I want the thing, so that value.\nF1.2 It runs daily." {
		t.Errorf("F1's basis = %q, want where the run left it", got)
	}
	if _, ok := st.DesignedFrom["F2"]; ok {
		t.Errorf("F2 was a stub when the run started, but reads as designed")
	}

	resolve(DesignRun{BaseRef: startedAt, EndRef: "0000000000000000000000000000000000000000"})
	st, err = r.svc.SpecState(context.Background(), r.org, r.proj)
	if err != nil {
		t.Fatal(err)
	}
	if got := st.DesignedFrom["F1"]; got != "Core\nUser Stories\nF1.1 As a user, I want the thing, so that value." {
		t.Errorf("F1's basis with an unreadable end = %q, want the run's start", got)
	}
}

// Address comments (L18) designs again the features its own requirement edits
// reached, as it left them; every other feature keeps the design run's basis,
// so an edit made before it still reads as out of date. Without an end it
// designs none.
func TestSpecState_AddressCommentsDesignsWhatItsEditsReached(t *testing.T) {
	t.Parallel()
	seed := validSpecSeed()
	seed["specs/requirements/features/F2-notify.md"] = "# Notify\n\n## User Stories\n\n- F2.1 As a user, I want S, so that s.\n"
	seed["specs/design/components/svc/design.json"] = svcDesignCovering("F1.1", "F2.1")
	r := newRig(t, seed)
	designed := r.headSHA()
	r.seed(map[string]string{
		"specs/requirements/features/F1-core.md": "# Core\n\n## User Stories\n\n- F1.1 As a user, I want the other thing, so that value.\n",
	}, "a user edit to F1")
	addressFrom := r.headSHA()
	addressedAt := r.seed(map[string]string{
		"specs/requirements/features/F2-notify.md": "# Notify\n\n## User Stories\n\n- F2.1 As a user, I want S by email, so that s.\n",
	}, "address comments")
	design := DesignRun{BaseRef: designed, EndRef: designed}
	resolve := func(runs ...DesignRun) {
		r.svc.SetDesignLedger(stubLedger{runs: runs})
	}
	ctx := context.Background()

	resolve(DesignRun{Flow: FlowAddressComments, BaseRef: addressFrom, EndRef: addressedAt}, design)
	st, err := r.svc.SpecState(ctx, r.org, r.proj)
	if err != nil {
		t.Fatal(err)
	}
	if got := st.DesignedFrom["F2"]; got != "Notify\nUser Stories\nF2.1 As a user, I want S by email, so that s." {
		t.Errorf("F2's basis = %q, want where Address comments left it", got)
	}
	if got := st.DesignedFrom["F1"]; got != "Core\nUser Stories\nF1.1 As a user, I want the thing, so that value." {
		t.Errorf("F1's basis = %q, want the design run's: Address comments did not touch it", got)
	}
	_, err = r.svc.SaveSpec(ctx, r.org, r.proj, SaveRequest{})
	if paths := specErrPaths(t, err); len(paths) != 1 || paths[0] != "specs/requirements/features/F1-core.md" {
		t.Fatalf("out of date = %v, want only F1", paths)
	}

	resolve(DesignRun{Flow: FlowAddressComments, BaseRef: addressFrom}, design)
	st, err = r.svc.SpecState(ctx, r.org, r.proj)
	if err != nil {
		t.Fatal(err)
	}
	if got := st.DesignedFrom["F2"]; got != "Notify\nUser Stories\nF2.1 As a user, I want S, so that s." {
		t.Errorf("F2's basis with no end = %q, want the design run's", got)
	}
}

// The spec state carries each design artifact's revision number as the
// ledger counts it (L18), and an empty map when no run changed any.
func TestSpecState_ArtifactRevisions(t *testing.T) {
	t.Parallel()
	r := newRig(t, validSpecSeed())
	ctx := context.Background()
	st, err := r.svc.SpecState(ctx, r.org, r.proj)
	if err != nil || st.ArtifactRevisions == nil || len(st.ArtifactRevisions) != 0 {
		t.Fatalf("SpecState with no ledger = (%v, %v), want no revisions", st.ArtifactRevisions, err)
	}
	r.svc.SetDesignLedger(stubLedger{revisions: map[string]int{"specs/design/domain-model.md": 2}})
	st, err = r.svc.SpecState(ctx, r.org, r.proj)
	if err != nil || st.ArtifactRevisions["specs/design/domain-model.md"] != 2 {
		t.Fatalf("SpecState = (%v, %v), want revision 2", st.ArtifactRevisions, err)
	}
}

// svcDesignCovering is the seed's svc design.json, listing stories.
func svcDesignCovering(stories ...string) string {
	return `{"name":"svc","type":"service","version":"1.0.0","language":"go",` +
		`"buildpack":"go","appPath":".","entrypoint":"main.go","exposure":"internet",` +
		`"stories":["` + strings.Join(stories, `","`) + `"],"dependencies":[],"description":"a service"}`
}
