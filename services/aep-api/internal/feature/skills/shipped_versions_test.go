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

// shippedBuiltin is one row of the last-reviewed (version, contentSHA) pair
// for an embedded builtin skill — the fixture behind
// TestBuiltinSkills_VersionBumpedOnContentChange.
type shippedBuiltin struct {
	Version    int
	ContentSHA string
}

// shippedBuiltins pins the version + ContentSHA every embedded builtin
// carried as of this commit.
//
// THE INVARIANT: reconcile.go's version gate (embed.version > repo.version →
// overwrite, else skip — reconcileEmbedded) is the ONLY mechanism that pushes
// a changed builtin out to orgs whose skills repo already has an older copy.
// If a SKILL.md body changes but metadata.aep.version does not, every org
// seeded before the edit silently keeps the stale copy forever — this is
// exactly what happened to thunder-authentication/api-management/react-webapp
// across the thunder-app dependency rewrite (2e25858, 6b03d34), which is why
// this fixture exists.
//
// So: whenever you edit a builtin SKILL.md body, bump its metadata.aep.version
// AND update this skill's row below to the new (Version, ContentSHA) — get the
// hash from a failing test run's diff, or from Skill.ContentSHA via
// loadEmbeddedBuiltins(). TestBuiltinSkills_VersionBumpedOnContentChange fails
// the build if the content hash moved but the version didn't.
var shippedBuiltins = map[string]shippedBuiltin{
	"api-management":         {Version: 3, ContentSHA: "1042e0e2957367d5f1db1050dee387b70c46025274086678961163c711c4cf96"},
	"go":                     {Version: 2, ContentSHA: "cb7c65ac587947310146adcebf015bfe13365492d700d1b1f4a1cf45b8b0f3a8"},
	"react-webapp":           {Version: 3, ContentSHA: "ae0f28d1bb90c032378769fd1de8ab969f2c4fbd49c8e4f713fbc88ab0daad22"},
	"thunder-authentication": {Version: 3, ContentSHA: "ee1ed214f99693958e1924b3dcd7a874c36d9c7b179c6579c00521c56ac0535e"},
}

// TestBuiltinSkills_VersionBumpedOnContentChange is the regression test for
// the "rewrote a skill, forgot to bump the version" class of bug: a stale
// SKILL.md body silently never reaches orgs seeded before the edit, because
// reconcile only overwrites when embed.version > repo.version (§6.2,
// reconcile.go). It asserts two things per embedded builtin:
//
//  1. The parsed version is always positive (a missing/unparseable version
//     defaults to 1 — never 0 or negative — so the gate always has a baseline
//     to compare against).
//  2. If the body changed since shippedBuiltins was last recorded (content
//     hash differs), the version must have increased too. A hash mismatch
//     with an unchanged version is precisely a content edit that reconcile
//     will never propagate to existing orgs — fail loudly instead.
func TestBuiltinSkills_VersionBumpedOnContentChange(t *testing.T) {
	t.Parallel()
	embedded, err := loadEmbeddedBuiltins()
	if err != nil {
		t.Fatalf("loadEmbeddedBuiltins: %v", err)
	}
	if len(embedded) == 0 {
		t.Fatalf("no embedded builtins found — loader or embed glob broken")
	}
	for _, sk := range embedded {
		if sk.Version <= 0 {
			t.Fatalf("%q: parsed version = %d, want > 0", sk.Name, sk.Version)
		}
		recorded, ok := shippedBuiltins[sk.Name]
		if !ok {
			// A newly added builtin has no history yet — nothing to compare.
			continue
		}
		if sk.ContentSHA == recorded.ContentSHA {
			continue // Body unchanged since it was recorded — nothing to enforce.
		}
		if sk.Version <= recorded.Version {
			t.Fatalf(
				"%q: body changed (contentSHA %s -> %s) but metadata.aep.version stayed at %d — "+
					"bump the version in the SKILL.md frontmatter (see reconcile.go's version gate) "+
					"and update this skill's row in shippedBuiltins, or orgs seeded before this edit "+
					"never receive it",
				sk.Name, recorded.ContentSHA, sk.ContentSHA, sk.Version,
			)
		}
	}
}
