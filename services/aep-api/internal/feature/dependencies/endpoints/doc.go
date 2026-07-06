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

// Package endpoints models the dependencies/endpoints family: a design
// component's calls to OTHER endpoints, i.e. the DependencyKind values
// "component" (another component in the same org/project) and "org-service"
// (an endpoint published across an org boundary). It is the endpoints half
// of OpenChoreo's Workload.spec.dependencies.endpoints[].
//
// Catalog (catalog.go) is the dynamic source of "org-service" targets: it
// enumerates every provider-side endpoint published by an org namespace's
// Workloads (via the OC ResourceClient's ListWorkloadEndpoints) and resolves
// them by namespace visibility, project sibling, or owning component. Naming
// (naming.go) derives the `<UPPER_SNAKE>_URL` env var OC binds a resolved
// org-service address to. This package depends only on the OC client and
// models — no other feature package.
package endpoints
