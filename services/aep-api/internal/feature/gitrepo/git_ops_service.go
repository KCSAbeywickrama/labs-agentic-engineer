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

package gitrepo

import (
	"github.com/wso2/aep/aep-api/internal/credentials"
)

// TagInfo describes a git tag.
type TagInfo struct {
	Name       string `json:"name"`
	CommitHash string `json:"commitHash"`
	Message    string `json:"message,omitempty"`
}

// GitOpsService is the git-object gateway consumed by the artifacts + skills
// stores: the GitData port (blobs/trees/commits/refs/tags), the credential
// resolver, and the save-identity helper. Since the GitHub-direct rework
// (docs/design/agents-generation-migration.md §5) there is NO local clone —
// reads, commits, and tags all go over the Git Data API — so this surface no
// longer carries any per-project clone/working-tree primitives.
type GitOpsService interface {
	ResolveSaveIdentities(cred credentials.Credential) (*GitIdentity, *GitIdentity)
	GitData() GitData
	Resolver() credentials.Resolver
}

type gitOpsService struct {
	resolver credentials.Resolver
	// gitHub is the GitData port (git-host client) the save/read flows drive.
	gitHub GitData
}

// NewGitOpsService builds the git-object gateway. `github` is the GitData port
// (git-host client) used by the artifact + skills stores.
func NewGitOpsService(resolver credentials.Resolver, github GitData) GitOpsService {
	return &gitOpsService{resolver: resolver, gitHub: github}
}

// GitData returns the GitData port wired in at construction.
func (s *gitOpsService) GitData() GitData { return s.gitHub }

// Resolver returns the credential resolver wired in at construction.
func (s *gitOpsService) Resolver() credentials.Resolver { return s.resolver }

// ResolveSaveIdentities returns (author, committer) identities for a save. Both
// are the credential identity, falling back to a default AEP name/email when the
// credential carries none.
func (s *gitOpsService) ResolveSaveIdentities(cred credentials.Credential) (*GitIdentity, *GitIdentity) {
	id := cred.Identity()
	if id.Name == "" {
		id.Name = "AEP"
	}
	if id.Email == "" {
		id.Email = "noreply@aep.dev"
	}
	gi := &GitIdentity{Name: id.Name, Email: id.Email}
	return gi, gi
}
