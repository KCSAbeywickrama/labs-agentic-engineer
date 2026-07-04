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

package resources

// ExternalResourceName is the per-project OC Resource name (== the Workload
// dependency `ref`) for a project's external resource. metadata.name is
// namespace-unique — owner.projectName does NOT scope it — so the project
// prefixes the name. Exported: the dispatch-time consumer-dependency renderer
// derives the same name through this single source of truth.
func ExternalResourceName(project, name string) string { return project + "-" + name }

// ExternalResourceBindingName is the per-env ResourceReleaseBinding name an
// external resource's outputs are read from — mirrors the provisioner's
// binding naming.
func ExternalResourceBindingName(project, name, env string) string {
	return ExternalResourceName(project, name) + "-" + env
}
