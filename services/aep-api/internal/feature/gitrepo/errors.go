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

import "errors"

// Sentinel errors. Those a git-provider implementation must return are part of
// the port contract (ports.go): conflict_retry.go keys off ErrRefNotFastForward
// and ErrTagAlreadyExists to drive CAS/tag-collision retries, and repoService
// keys off ErrRepoNameConflict. Any Host impl (clients/github today) MUST
// reproduce them, and IsRepoNameConflict / IsHTTPStatus (wire.go) are the
// caller-side checks.
var (
	// ErrRepoNotFound is a gitrepo-domain error (no repo row) returned by
	// repoService/issueService lookups.
	ErrRepoNotFound = errors.New("repository not found")
	// ErrRepoNotReady is a gitrepo-domain error (repo row not in "ready" state).
	ErrRepoNotReady = errors.New("repository is not ready")

	// ErrTagAlreadyExists — port contract: CreateTagRef returns it on a 422
	// tag-collision so the save flow recomputes the next tag.
	ErrTagAlreadyExists = errors.New("tag already exists")
	// ErrRefNotFastForward — port contract: UpdateRef(force=false) returns it
	// when the ref tip moved between read and write so conflict_retry re-anchors.
	ErrRefNotFastForward = errors.New("github ref: update is not a fast-forward")
	// ErrRepoNameConflict — port contract: CreateOrgRepo returns it when the
	// requested repo name is already taken (repoService retries with a fresh suffix).
	ErrRepoNameConflict = errors.New("repo name already taken")
)

// IsRepoNameConflict reports whether err represents a host name-conflict rejection.
func IsRepoNameConflict(err error) bool {
	return errors.Is(err, ErrRepoNameConflict)
}
