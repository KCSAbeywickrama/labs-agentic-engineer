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

// Package dependencies is the umbrella for a design component's external
// dependency graph, mirroring OpenChoreo's
// Workload.spec.dependencies.{endpoints[],resources[]} split into two child
// features by kind:
//
//   - dependencies/endpoints — the components (in-org or published by
//     another org) this component calls;
//   - dependencies/resources — the external systems and platform-provisioned
//     resources this component consumes.
//
// This parent package holds no code of its own beyond the doc comment; it
// exists so the two families share one addressable umbrella in the feature
// tree. An MCP discovery surface that lets agents query the graph at build
// time arrives in a later task.
package dependencies
