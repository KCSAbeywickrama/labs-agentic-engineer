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

package agentsvc

// ConversationID weaves the authenticated tenant scope + use case into the
// service-side conversation id: org_{orgId}--proj_{projectId}--{useCase}--{suffix}.
// This encoding is the ONLY tenant-isolation fence on the agents service (its
// conversation store is tenancy-blind), so every BFF feature that opens a
// conversation must build the id here — a turn/rehydrate outside the scope maps
// to a different id (isolated by construction). Callers must reject "--" in
// caller-supplied suffixes so a crafted suffix cannot forge extra segments.
func ConversationID(orgID, projectID, useCase, suffix string) string {
	return "org_" + orgID + "--proj_" + projectID + "--" + useCase + "--" + suffix
}
