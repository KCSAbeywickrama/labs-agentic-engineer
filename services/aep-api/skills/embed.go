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

// Package skills embeds the platform-bundled skill sources shipped in the
// aep-api binary — the shipping vehicle; each org's `org-skills` repo is the
// live store they are seeded + version-reconciled into (skills-repo-storage.md
// §6/§10, shared-volume-clone-architecture.md §17.8):
//
//   - builtin/  — coding-agent skills (kind "builtin"), listed on the skills
//     page, SKILL.md only.
//   - flow/     — generation flow skills (kind "flow"), hidden from the skills
//     page; SKILL.md + references/*.md. Vendored from the repo-root skills/
//     directory (the single source of truth, which cannot be go:embed-ed
//     across the module boundary) — keep in sync via `go generate`. The genai
//     feature carries its own vendored copy (internal/feature/genai/assets)
//     that it pushes inline until Phase 4 reads everything from _skills
//     snapshots.
package skills

import "embed"

//go:embed builtin/*/SKILL.md
var BuiltinFS embed.FS

//go:generate sh -c "rm -rf flow && cp -R ../../../skills flow"
//go:embed flow
var FlowFS embed.FS
