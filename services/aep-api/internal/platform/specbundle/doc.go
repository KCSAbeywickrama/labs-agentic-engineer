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

// Package specbundle opens an `.aespecs` bundle: the spec tree a developer
// skill (`code-to-spec`) wrote from a product's existing code, packed so a
// project can be seeded from it with one upload (`seed-project`).
//
// The format, `aespecs/1`, is a zip whose root holds `manifest.json` and a
// `specs/` tree:
//
//	manifest.json                                  {format, producer{name, version}, product, source{repository, commit}, createdAt}
//	specs/requirements/**.md                       the requirements, their features and coverage files
//	specs/design/domain-model.md
//	specs/design/dependencies/<name>/dependency.json
//	specs/design/dependencies/<name>/assumptions.md
//	specs/design/dependencies/<name>/{openapi.yaml|openapi.yml|openapi.json|schema.graphql|schema.graphqls|sdk.json}
//
// Nothing else is admitted: the reader is an allow-list, not a scan for bad
// types, because the legitimate contents are small and known. Every file is
// UTF-8 text; a directory entry is skipped, a symlink, a traversal, a dot-led
// segment or the platform's own files (the descriptor, the ignore file, the
// reference documents) are refused. The archive is read under fixed bounds
// (MaxBundleBytes on the archive, MaxEntries, MaxUnpackedBytes across every
// entry, MaxFileBytes per file: the Room's own cap) with the one-byte-past
// LimitReader idiom the Office conversion uses, so a small archive cannot
// inflate into anything. A file that carries what looks like a credential is
// refused too: the commit lands in the project's repository, and the skill
// that writes bundles promises never to write a value.
//
// Every refusal is ErrRejected wrapped with one sentence naming the entry
// and the rule; Reason unwraps it for the caller's 400 message. The package
// knows nothing about requirements or designs: the spec domain parses what it
// returns with its own readers before anything is committed.
package specbundle
