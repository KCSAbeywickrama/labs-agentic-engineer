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
// Platform-resource machinery (platform_*.go, resources_service.go):
//
//   - ResourceTypeCatalog (platform_catalog.go) — read-only discovery of the
//     installed cluster-scoped ClusterResourceTypes (AEP never authors them).
//   - ResourceProvisioner / OCNativeProvisioner (platform_provisioner.go) —
//     authors the OC Resource model for a platform-resource dep against a
//     DISCOVERED ClusterResourceType (never EnsureResourceType), async: it
//     pins the per-env bindings and returns without waiting for readiness.
//   - ResourceService (resources_service.go) — design read → kind policy →
//     provision → move the resource-provisioning task pending→building via
//     the contracts TaskEventProvisionStarted event through the TaskCompleter.
//
// HTTP surface (resources_huma.go, org-implicit paths):
//
//	GET    /dependencies/external-resources
//	DELETE /dependencies/external-resources/{name}
//	POST   /projects/{p}/dependencies/external-resources/{name}/values
//	POST   /projects/{p}/components/{c}/dependencies/{dep}/provision   (202)
//	GET    /projects/{p}/components/{c}/dependencies/{dep}/status
//
// The package holds NO feature imports (empty arch-allowlist row): the org
// catalog, SM-API writer, task repo, task projector and design reader are
// consumer-side ports in ports.go, wired concretely in the composition root.
package resources
