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

// Package resources models the dependencies/resources family: the
// non-endpoint dependencies a design component consumes, i.e. the
// DependencyKind values "external" (a third-party system the platform does
// not provision) and "platform-resource" (a resource provisioned through an
// OpenChoreo cluster resource type, e.g. a database or cache). It is the
// resources half of OpenChoreo's Workload.spec.dependencies.resources[].
//
// External-resource machinery (external_*.go, naming.go):
//
//   - ValueService (external_values.go) — per-env value submission: split by
//     the registered schema, provision, complete the config-collection task
//     via the contracts state machine, re-dispatch gated tasks.
//   - ExternalResourceProvisioner (external_provisioner.go) — authors the OC
//     Resource model (ResourceType → Resource → pinned per-env bindings) with
//     secret values routed through SM-API; Deprovision and
//     ResolveRunnerSecrets for the dispatch path.
//   - naming.go — ExternalResourceName / ExternalResourceBindingName, the
//     single source of truth for the OC CR names.
//
// The package holds NO feature imports (empty arch-allowlist row): the org
// catalog, SM-API writer, task repo and task projector are consumer-side
// ports in ports.go, wired concretely in the composition root.
package resources
