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
// This package holds the provisioner CORES only — the value/param-collection
// services + the HTTP surface were git-rm'd at the dependency-management merge
// and REBUILT on our GitHub-native aep:provision funnel in
// internal/feature/provisioning (dependency-management §3.6). What lives here:
//
// External-resource machinery (external_*.go, naming.go):
//
//   - ExternalResourceProvisioner (external_provisioner.go) — authors the OC
//     Resource model (ResourceType → Resource → pinned per-env bindings) with
//     secret values routed through SM-API; Deprovision and
//     ResolveRunnerSecrets (the per-run ExternalSecret inputs for the coding
//     runner).
//   - naming.go — ExternalResourceName / ExternalResourceBindingName, the
//     single source of truth for the OC CR names (shared with the platform half).
//
// Platform-resource machinery (platform_*.go):
//
//   - ResourceTypeCatalog (platform_catalog.go) — read-only discovery of the
//     installed cluster-scoped ClusterResourceTypes (AEP never authors them).
//   - ResourceProvisioner / OCNativeProvisioner (platform_provisioner.go) —
//     authors the OC Resource model for a platform-resource dep against a
//     DISCOVERED ClusterResourceType (never EnsureResourceType), async: it
//     pins the per-env bindings and returns without waiting for readiness.
//
// The value/param collection surface, the aep:provision gate issues, the
// provision-Execution lifecycle and the readiness watcher that DRIVE these cores
// live in internal/feature/provisioning (ValueService / ResourceService /
// ResourceWatcher / resources_huma there).
//
// The package holds NO feature imports (empty arch-allowlist row): the org
// catalog, SM-API writer and OC client are consumer-side ports in ports.go,
// wired concretely in the composition root.
package resources
