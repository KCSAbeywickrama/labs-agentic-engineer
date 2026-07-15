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

package models

type Project struct {
	UID                string `json:"uid,omitempty"`
	Name               string `json:"name"`
	NamespaceName      string `json:"namespaceName,omitempty"`
	DisplayName        string `json:"displayName,omitempty"`
	Description        string `json:"description,omitempty"`
	DeploymentPipeline string `json:"deploymentPipeline,omitempty"`
	CreatedAt          string `json:"createdAt,omitempty"`
	Status             string `json:"status,omitempty"`
	// RepoURL is the clone URL of the project's git repo, joined from the
	// BFF's own git_repositories rows on list reads (#108); absent when no
	// repo is provisioned.
	RepoURL string `json:"repoUrl,omitempty" doc:"Clone URL of the project's Git repository; absent when no repo is provisioned."`
}

type ProjectList struct {
	Items []Project `json:"items"`
	// NextCursor is the OpenChoreo continuation token for the next page,
	// surfaced verbatim; empty/absent on the last page. The console pages on it.
	NextCursor string `json:"nextCursor,omitempty" doc:"Cursor for the next page; absent on the last page."`
}

type CreateProjectRequest struct {
	Name               string `json:"name"`
	DisplayName        string `json:"displayName,omitempty"`
	Description        string `json:"description,omitempty"`
	DeploymentPipeline string `json:"deploymentPipeline,omitempty"`
	// Prompt is the requirement text the console's create flow captures; it
	// is accepted per the contract but not consumed until spec derivation
	// lands (issue #72).
	Prompt string `json:"prompt,omitempty" doc:"Optional requirement prompt that kicks off spec derivation."`
	// RepoName overrides the provisioned Git repository's name; defaults to
	// the project name. DNS-label slug (validated in the handler).
	RepoName string `json:"repoName,omitempty" doc:"Git repository name override; defaults to the project name."`
}

// ProjectStatus represents the computed SDLC phase and artifact states.
type ProjectStatus struct {
	Phase            string `json:"phase"`      // "no-repo", "repo-cloning", "repo-error", "prompt", "spec", "architecture", "tasks", "components"
	RepoStatus       string `json:"repoStatus"` // "", "pending", "cloning", "ready", "error"
	RepoURL          string `json:"repoUrl"`
	RepoErrorMessage string `json:"repoErrorMessage,omitempty"` // set when phase is "repo-error"
	HasSpec          bool   `json:"hasSpec"`
	HasDesign        bool   `json:"hasDesign"`
	HasTasks         bool   `json:"hasTasks"`
	SpecStatus       string `json:"specStatus"`   // "", "draft", "approved"
	DesignStatus     string `json:"designStatus"` // "", "draft", "approved"

	// The three per-stage aggregates the overview pipeline renders from a
	// single status poll (#184). All required by the contract — always
	// present, zero-valued when the repo is not ready yet.
	Spec   SpecStage   `json:"spec"`
	Build  BuildStage  `json:"build"`
	Deploy DeployStage `json:"deploy"`
}

// SpecStage is the spec-stage aggregate on ProjectStatus (#184).
// Approved/draft is derived, not stored — version set and not dirty =
// approved (vN); dirty = draft changes (vN+); no version = unpublished
// draft; exists false = no spec yet.
type SpecStage struct {
	Exists  bool   `json:"exists" doc:"Any spec file created; false renders the Generate-spec CTA."`
	Version string `json:"version" doc:"Latest v<N> spec tag; \"\" if never published."`
	Dirty   bool   `json:"dirty" doc:"specs/ moved on GitHub past the latest tag."`
	Design  bool   `json:"design" doc:"Design files exist for the spec (gates the Spec view's design button)."`
}

// BuildStage is the build-stage aggregate on ProjectStatus (#184) — the tag
// being/last built and its task counts, so the overview needs no list-tasks
// read. Counts are the run's own tally, frozen when the run ends.
type BuildStage struct {
	Version string `json:"version" doc:"Spec tag the current/last build built; \"\" if never built."`
	Status  string `json:"status" enum:"idle,running,failed,succeeded" doc:"idle (never built), running, failed, succeeded"`
	Tasks   struct {
		Total  int64 `json:"total"`
		Done   int64 `json:"done"`
		Failed int64 `json:"failed"`
		Active int64 `json:"active"`
	} `json:"tasks" doc:"Task counts bucketed from derivedStatus."`
}

// DeployStage is the deploy-stage aggregate on ProjectStatus (#184) — what's
// live in dev and rollout progress.
type DeployStage struct {
	Version    string `json:"version" doc:"Spec tag live in dev; \"\" if nothing deployed."`
	Status     string `json:"status" enum:"none,deploying,deployed,failed"`
	Components struct {
		Total int64 `json:"total"`
		Ready int64 `json:"ready"`
	} `json:"components" doc:"Component rollout progress for the current deploy."`
	// Validation is the coarse validation-task run state for the latest build:
	// none (not reached, or no acceptance criteria authored → no child run),
	// running, completed (ran to completion — the pass/fail verdict lives in the
	// report, behind GitHub), failed (the validation run failed mechanically).
	Validation string `json:"validation" enum:"none,running,completed,failed" doc:"Coarse validation-task run state for the latest build."`
	// ValidationUrl links to the associated validation PR (the validation issue
	// as a fallback before a PR exists); "" when there is no validation.
	ValidationUrl string `json:"validationUrl,omitempty" doc:"Link to the associated validation PR (issue as fallback); \"\" when no validation."`
}
