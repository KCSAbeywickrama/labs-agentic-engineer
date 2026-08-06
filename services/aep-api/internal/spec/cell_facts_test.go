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
	"reflect"
	"testing"
)

const cellFixture = `title Lunch Coordinator
version v1
phase 1

# own components
component lunch-api as "Lunch API" service [stories: 1, 2, 4]
component lunch-web web-application [stories: 1,2]
component slack-notifier service [stories: 7]
component orders-db database

east team-auth as "Thunder Auth" identity-server
south slack as "Slack" saas

lunch-web -> lunch-api
lunch-api -> orders-db
slack-notifier -> south slack | notifications
north -> lunch-web
east team-auth -> lunch-api
`

func TestParseCellFacts_FullFixture(t *testing.T) {
	facts, err := parseCellFacts(cellFixture)
	if err != nil {
		t.Fatalf("parseCellFacts: %v", err)
	}
	if facts.Phase != 1 {
		t.Errorf("phase = %d, want 1", facts.Phase)
	}
	wantComponents := []CellComponent{
		{ID: "lunch-api", Type: "service", Stories: []int{1, 2, 4}},
		{ID: "lunch-web", Type: "web-application", Stories: []int{1, 2}},
		{ID: "slack-notifier", Type: "service", Stories: []int{7}},
		{ID: "orders-db", Type: "database"},
	}
	if !reflect.DeepEqual(facts.Components, wantComponents) {
		t.Errorf("components = %+v\nwant %+v", facts.Components, wantComponents)
	}
	// Stories cited anywhere in the cell, deduplicated.
	if got, want := facts.CitedStories(), []int{1, 2, 4, 7}; !reflect.DeepEqual(got, want) {
		t.Errorf("cited stories = %v, want %v", got, want)
	}
}

func TestParseCellFacts_NoPhaseIsZero(t *testing.T) {
	facts, err := parseCellFacts("component api service [stories: 3]")
	if err != nil {
		t.Fatalf("parseCellFacts: %v", err)
	}
	if facts.Phase != 0 {
		t.Errorf("phase = %d, want 0 (absent)", facts.Phase)
	}
}

func TestParseCellFacts_RejectsMalformed(t *testing.T) {
	for _, src := range []string{
		"phase zero\ncomponent api",
		"component api [stories: a]",
		"component api [stories: ]",
	} {
		if _, err := parseCellFacts(src); err == nil {
			t.Errorf("parseCellFacts(%q): want error, got nil", src)
		}
	}
}

// Quoted labels may contain the word component / brackets — the tokenizer
// must not trip on them, and unknown statements are ignored (the TS parser is
// the authoritative validator; Go extracts facts permissively).
func TestParseCellFacts_PermissiveOnUnknownStatements(t *testing.T) {
	facts, err := parseCellFacts("something odd here\ncomponent api as \"An [api] component\" service [stories: 2]")
	if err != nil {
		t.Fatalf("parseCellFacts: %v", err)
	}
	if len(facts.Components) != 1 || facts.Components[0].ID != "api" ||
		!reflect.DeepEqual(facts.Components[0].Stories, []int{2}) {
		t.Errorf("components = %+v", facts.Components)
	}
}

func TestCellFacts_StubDerivation(t *testing.T) {
	facts, err := parseCellFacts(cellFixture)
	if err != nil {
		t.Fatalf("parseCellFacts: %v", err)
	}
	inScope := map[int]bool{1: true, 2: true, 4: true} // Phase 1 stories
	// slack-notifier cites only story 7 (outside the phase) → stub.
	// orders-db cites nothing → infrastructure node, not a stub, but also not
	// detail-gated (no stories to cover).
	if !facts.IsStub("slack-notifier", inScope) {
		t.Error("slack-notifier should derive as a stub for phase 1")
	}
	for _, id := range []string{"lunch-api", "lunch-web", "orders-db"} {
		if facts.IsStub(id, inScope) {
			t.Errorf("%s should NOT be a stub", id)
		}
	}
}
