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

package files

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/platform/humakit"
)

// --- Inputs / Outputs ------------------------------------------------------
// Every input embeds humakit.OrgScopedInput — the active org is derived solely
// from the verified token (the IDOR fence); {projectName} and the file path are
// sibling params. There is NO org path/query/header field (arch-locked).

type listInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
	Prefix      string `query:"prefix" doc:"Only list paths under this prefix (e.g. specs/design/)"`
}

type readInput struct {
	humakit.OrgScopedInput
	ProjectName string `path:"projectName" doc:"Project name (DNS-label slug)"`
	Path        string `path:"path" doc:"File path under specs/"`
}

type applyInput struct {
	humakit.OrgScopedInput
	ProjectName string       `path:"projectName" doc:"Project name (DNS-label slug)"`
	Body        ApplyRequest `doc:"Atomic write/delete batch with per-file baseSha"`
}

// applyMaxBodyBytes bounds the apply request body (file contents ride in the
// apply batch, unlike turn bodies). Huma returns 413 above it; the per-file
// 5 MiB cap (a 400) is the finer guard below it.
const applyMaxBodyBytes = 10 << 20

type listOutput struct{ Body []FileMeta }
type readOutput struct{ Body *FileContent }
type applyOutput struct{ Body *ApplyResult }

// applyConflictError renders the 409 body verbatim as {"conflicts":[...]} —
// Huma writes a StatusError value directly as the response body. Nothing was
// applied when this is returned.
type applyConflictError struct {
	Conflicts []Conflict `json:"conflicts"`
}

func (e *applyConflictError) Error() string  { return "apply conflict: stale baseSha" }
func (e *applyConflictError) GetStatus() int { return http.StatusConflict }

// RegisterFiles registers the generic Files API (list / read / apply) on the
// Huma API. Reads are GitHub-at-HEAD; the single write is the atomic apply.
func RegisterFiles(api huma.API, svc FilesService) {
	base := "/projects/{projectName}/files"

	huma.Register(api, huma.Operation{
		OperationID: "list-files",
		Method:      http.MethodGet,
		Path:        base,
		Summary:     "List spec files at HEAD",
		Tags:        []string{"Files"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *listInput) (*listOutput, error) {
		metas, err := svc.List(ctx, in.OrgHandle, in.ProjectName, in.Prefix)
		if err != nil {
			return nil, mapFilesError(err)
		}
		return &listOutput{Body: metas}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "read-file",
		Method:      http.MethodGet,
		Path:        base + "/{path...}",
		Summary:     "Read a spec file at HEAD",
		Tags:        []string{"Files"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *readInput) (*readOutput, error) {
		if in.Path == "" {
			return nil, huma.Error400BadRequest("path is required")
		}
		fc, err := svc.Read(ctx, in.OrgHandle, in.ProjectName, in.Path)
		if err != nil {
			return nil, mapFilesError(err)
		}
		return &readOutput{Body: fc}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "apply-files",
		Method:      http.MethodPost,
		Path:        base + "/apply",
		Summary:     "Atomically apply a batch of writes/deletes (single commit to main)",
		Tags:        []string{"Files"},
		Security:    humakit.SecurityUserJWT,
		// A too-large batch is a clean 413 here rather than a surprise
		// mid-commit; the per-file 5 MiB cap (a 400) is the finer guard.
		MaxBodyBytes: applyMaxBodyBytes,
	}, func(ctx context.Context, in *applyInput) (*applyOutput, error) {
		res, conflicts, err := svc.Apply(ctx, in.OrgHandle, in.ProjectName, in.Body)
		if err != nil {
			if errors.Is(err, ErrApplyConflict) {
				return nil, &applyConflictError{Conflicts: conflicts}
			}
			return nil, mapFilesError(err)
		}
		return &applyOutput{Body: res}, nil
	})
}

// mapFilesError maps the service's typed errors to problem responses.
func mapFilesError(err error) error {
	switch {
	case errors.Is(err, ErrProjectRepoNotFound):
		return huma.Error404NotFound("project repository not found")
	case errors.Is(err, ErrFileNotFound):
		return huma.Error404NotFound("file not found")
	case errors.Is(err, ErrPathInvalid):
		return huma.Error400BadRequest(err.Error())
	case errors.Is(err, gitrepo.ErrRefNotFastForward):
		// Workspace.Mutate exhausted its CAS retries: the ref tip moved under
		// us on every attempt. That is a concurrent-write conflict, not a
		// server fault — surface it as a retryable 409, never a 500.
		return huma.Error409Conflict("the repository changed during the write; retry")
	default:
		return huma.Error500InternalServerError("internal error")
	}
}
