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

package skills

import "testing"

// shippedSkill is one row of the last-reviewed (version, contentSHA) pair for
// an embedded skill — the fixture behind
// TestEmbeddedSkills_VersionBumpedOnContentChange.
type shippedSkill struct {
	Version    int
	ContentSHA string
}

// shippedBuiltins / shippedFlow pin the version + ContentSHA every embedded
// skill carried as of this commit. Both kinds ride the SAME reconcile version
// gate, so both need the invariant.
//
// THE INVARIANT: reconcile.go's version gate (embed.version > repo.version →
// overwrite, else skip — reconcileEmbedded) is the ONLY mechanism that pushes
// a changed embedded skill out to orgs whose skills repo already has an older
// copy. If a skill's content changes but metadata.aep.version does not, every
// org seeded before the edit silently keeps the stale copy forever — this is
// exactly what happened to thunder-authentication/api-management/react-webapp
// (and flow high-level-architecture, which LOST its metadata block entirely)
// across the thunder-app dependency rewrite (2e25858, 6b03d34), which is why
// these fixtures exist.
//
// So: whenever you edit an embedded skill's content, bump its
// metadata.aep.version AND update that skill's row below to the new
// (Version, ContentSHA) — get the hash from the failing test's message, or
// from Skill.ContentSHA via loadEmbeddedBuiltins()/loadEmbeddedFlow().
// TestEmbeddedSkills_VersionBumpedOnContentChange fails the build if a
// content hash moved but the version didn't. For flow skills, edit the
// repo-root skills/ source of truth and re-vendor (`go generate ./skills/...`
// in services/aep-api) — TestFlowSkillsMirror_MatchesRepoRootSource catches
// drift between the two copies.
var shippedBuiltins = map[string]shippedSkill{
	"api-management":         {Version: 3, ContentSHA: "1042e0e2957367d5f1db1050dee387b70c46025274086678961163c711c4cf96"},
	"go":                     {Version: 2, ContentSHA: "cb7c65ac587947310146adcebf015bfe13365492d700d1b1f4a1cf45b8b0f3a8"},
	"react-webapp":           {Version: 4, ContentSHA: "76cbd13aee4425b3ee79426048b6a360b01a1b7712f2078d51fe03b6b1475ed4"},
	"thunder-authentication": {Version: 4, ContentSHA: "d6eb8e89afd268d51b6d9082527b0153b1b1b60c9c1c9aa10ae0e82166687077"},
}

var shippedFlow = map[string]shippedSkill{
	"excalidraw-wireframes":   {Version: 1, ContentSHA: "ba99ae40fe332a6f11d498f1029be574f819120a452660a77db95d9679bd8566"},
	"high-level-architecture": {Version: 3, ContentSHA: "f6a5e5f2bd024ec27026e851e20a5091b56c2dc9a97f3826fdc897349e6ce274"},
	"openapi-conventions":     {Version: 1, ContentSHA: "cb2a9afa912ecfa053564a5009d738c2c88f577037733682f9ed98007f7efd6b"},
	"task-planning":           {Version: 1, ContentSHA: "d01320808d95c3b7021bdd257eb89032659ed064c6c83cdae155b33562cbcb81"},
}

// TestEmbeddedSkills_VersionBumpedOnContentChange is the regression test for
// the "rewrote a skill, forgot to bump the version" class of bug: a stale
// skill silently never reaches orgs seeded before the edit, because reconcile
// only overwrites when embed.version > repo.version (§6.2, reconcile.go). It
// asserts two things per embedded skill of BOTH kinds:
//
//  1. The parsed version is always positive (a missing/unparseable version
//     defaults to 1 — never 0 or negative — so the gate always has a baseline
//     to compare against).
//  2. If the content changed since the shipped fixture was last recorded
//     (content hash differs), the version must have increased too. A hash
//     mismatch with an unchanged version is precisely a content edit that
//     reconcile will never propagate to existing orgs — fail loudly instead.
func TestEmbeddedSkills_VersionBumpedOnContentChange(t *testing.T) {
	t.Parallel()
	kinds := []struct {
		kind    string
		load    func() ([]Skill, error)
		shipped map[string]shippedSkill
	}{
		{"builtin", loadEmbeddedBuiltins, shippedBuiltins},
		{"flow", loadEmbeddedFlow, shippedFlow},
	}
	for _, k := range kinds {
		t.Run(k.kind, func(t *testing.T) {
			t.Parallel()
			embedded, err := k.load()
			if err != nil {
				t.Fatalf("load embedded %s: %v", k.kind, err)
			}
			if len(embedded) == 0 {
				t.Fatalf("no embedded %s skills found — loader or embed glob broken", k.kind)
			}
			for _, sk := range embedded {
				if sk.Version <= 0 {
					t.Fatalf("%q: parsed version = %d, want > 0", sk.Name, sk.Version)
				}
				recorded, ok := k.shipped[sk.Name]
				if !ok {
					// A newly added skill has no history yet — nothing to compare.
					continue
				}
				if sk.ContentSHA == recorded.ContentSHA {
					continue // Content unchanged since it was recorded — nothing to enforce.
				}
				if sk.Version <= recorded.Version {
					t.Fatalf(
						"%q (%s): content changed (contentSHA %s -> %s) but metadata.aep.version stayed at %d — "+
							"bump the version in the SKILL.md frontmatter (see reconcile.go's version gate) "+
							"and update this skill's row in the shipped fixture, or orgs seeded before this "+
							"edit never receive it",
						sk.Name, k.kind, recorded.ContentSHA, sk.ContentSHA, sk.Version,
					)
				}
			}
		})
	}
}
