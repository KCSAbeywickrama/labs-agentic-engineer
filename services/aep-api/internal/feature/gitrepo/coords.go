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
	"context"
	"fmt"

	"github.com/wso2/aep/aep-api/internal/credentials"
	"github.com/wso2/aep/aep-api/models"
)

// RepoCoords is the resolved git-host coordinates + credential for one repo:
// owner/name derived from the repo URL, the org credential, and the default
// branch (with the "main" fallback). It is the shared input every GitHub-direct
// reader/writer (artifacts, files, genai, skills) starts from.
type RepoCoords struct {
	Owner  string
	Name   string
	Branch string
	Cred   credentials.Credential
}

// ResolveRepoCoords derives owner/name from the repo row's URL, resolves the
// org credential, and applies the default-branch fallback. orgID is passed
// explicitly (not read off the row) so callers keep resolving the credential
// for exactly the org they authenticated.
func ResolveRepoCoords(ctx context.Context, resolver credentials.Resolver, orgID string, repo *models.GitRepository) (RepoCoords, error) {
	owner, name := models.OwnerRepoFromURL(repo.RepoURL)
	if owner == "" || name == "" {
		return RepoCoords{}, fmt.Errorf("cannot derive owner/repo from %q", repo.RepoURL)
	}
	cred, err := resolver.Resolve(ctx, orgID)
	if err != nil {
		return RepoCoords{}, fmt.Errorf("resolve credential: %w", err)
	}
	branch := repo.DefaultBranch
	if branch == "" {
		branch = "main"
	}
	return RepoCoords{Owner: owner, Name: name, Branch: branch, Cred: cred}, nil
}

// PeelTagToCommit resolves a tag ref's object SHA to the commit it points at:
// an annotated tag object is peeled via GetTagObject; a lightweight tag ref
// already points at a commit, so a failed peel (404) falls back to the ref SHA.
func PeelTagToCommit(ctx context.Context, gd GitData, owner, repo string, cred credentials.Credential, tagSHA string) string {
	commitSHA, err := gd.GetTagObject(ctx, owner, repo, cred, tagSHA)
	if err != nil {
		return tagSHA // lightweight tag: ref already points at the commit
	}
	return commitSHA
}
