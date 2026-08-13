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
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/platform/apierr"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// Handler serves the files feature: list-files / read-file / apply-spec. Reads
// are served at the branch tip through the workspace mirror; the single write
// is the atomic apply. Every operation is org-scoped — the tenant gate bound
// the token org before these run. read-file's {path} spans multiple segments:
// the generated single-segment pattern serves plain paths and the ServeMux
// catch-all registered in server.go routes nested ones — both land here with
// PathValue-decoded (unescaped) bytes, so unicode/escaped paths survive the
// chain byte-identically.
type Handler struct {
	files    spec.FilesService
	activity spec.SpecUpdatedRecorder
}

// New returns the slice's handler.
func New(files spec.FilesService, activity spec.SpecUpdatedRecorder) *Handler {
	return &Handler{files: files, activity: activity}
}

func (h *Handler) ListFiles(ctx context.Context, request gen.ListFilesRequestObject) (gen.ListFilesResponseObject, error) {
	org := tenant.BoundOrgFromContext(ctx)
	prefix := ""
	if request.Params.Prefix != "" {
		prefix = request.Params.Prefix
	}
	metas, err := h.files.List(ctx, org, request.ProjectName, prefix)
	if err != nil {
		return nil, mapFilesError(err)
	}
	out := make([]gen.FileMeta, 0, len(metas))
	for _, m := range metas {
		out = append(out, gen.FileMeta{Path: m.Path, Sha: m.SHA, Size: m.Size})
	}
	return gen.ListFiles200JSONResponse(out), nil
}

func (h *Handler) ReadFile(ctx context.Context, request gen.ReadFileRequestObject) (gen.ReadFileResponseObject, error) {
	org := tenant.BoundOrgFromContext(ctx)
	if request.Path == "" {
		return nil, apierr.BadRequest("path is required")
	}
	// `ref` pins the read to one commit; empty reads the branch tip, which is what
	// every caller but the validation report wants. The service validates its
	// shape — an object name, never a revision expression.
	fc, err := h.files.ReadAt(ctx, org, request.ProjectName, request.Path, request.Params.Ref)
	if err != nil {
		return nil, mapFilesError(err)
	}
	return gen.ReadFile200JSONResponse(fileContentToWire(fc)), nil
}

// fileContentToWire is the read half of decodeContent: a binary file rides
// base64 with the encoding flag set, because a JSON string cannot carry its
// bytes (json.Marshal swaps invalid UTF-8 for U+FFFD — silent corruption).
// Text keeps today's wire shape exactly, encoding omitted.
func fileContentToWire(fc *spec.FileContent) gen.FileContent {
	out := gen.FileContent{Path: fc.Path, Content: fc.Content, Sha: fc.SHA}
	if !utf8.ValidString(fc.Content) || strings.ContainsRune(fc.Content, 0) {
		out.Content = base64.StdEncoding.EncodeToString([]byte(fc.Content))
		out.Encoding = gen.FileContentEncodingBase64
	}
	return out
}

// ReadFileBundle serves the whole-prefix read. It is registered under the
// LITERAL path segment `bundle`, which sits beneath read-file's trailing
// wildcard: ServeMux prefers the literal (it matches a strict subset), and no
// readable file address can collide with it anyway, since every readable path
// starts with specs/.
func (h *Handler) ReadFileBundle(ctx context.Context, request gen.ReadFileBundleRequestObject) (gen.ReadFileBundleResponseObject, error) {
	org := tenant.BoundOrgFromContext(ctx)
	bundle, err := h.files.Bundle(ctx, org, request.ProjectName, request.Params.Prefix, request.Params.Ref)
	if err != nil {
		return nil, mapFilesError(err)
	}
	files := make([]gen.FileContent, 0, len(bundle.Files))
	for _, f := range bundle.Files {
		files = append(files, gen.FileContent{Path: f.Path, Content: f.Content, Sha: f.SHA})
	}
	return gen.ReadFileBundle200JSONResponse(gen.FileBundle{
		CommitSha: bundle.CommitSHA,
		Files:     files,
	}), nil
}

func (h *Handler) ApplyFiles(ctx context.Context, request gen.ApplyFilesRequestObject) (gen.ApplyFilesResponseObject, error) {
	org := tenant.BoundOrgFromContext(ctx)
	if request.Body == nil {
		return nil, apierr.BadRequest("request body required")
	}
	applyReq, err := applyRequestFromWire(*request.Body)
	if err != nil {
		return nil, err
	}
	res, conflicts, err := h.files.Apply(ctx, org, request.ProjectName, applyReq)
	if err != nil {
		if errors.Is(err, spec.ErrApplyConflict) {
			return applyConflictsToWire(conflicts), nil
		}
		return nil, mapFilesError(err)
	}
	// A byte-identical apply makes no commit — nothing happened, so nothing
	// reaches the feed.
	if h.activity != nil && res.Changed {
		h.activity.RecordSpecUpdated(ctx, org, request.ProjectName, res.CommitSHA, appliedPaths(*request.Body, res))
	}
	return gen.ApplyFiles200JSONResponse(applyResultToWire(res)), nil
}

// applyConflictsToWire projects the service conflicts onto the contract's
// declared 409 body (ApplyConflicts — the FE's baseSha CAS flow consumes it;
// nothing was applied when this is returned). files_component_test.go pins the
// field set + values.
func applyConflictsToWire(conflicts []spec.Conflict) gen.ApplyFiles409JSONResponse {
	out := gen.ApplyConflicts{Conflicts: make([]gen.ApplyConflict, 0, len(conflicts))}
	for _, c := range conflicts {
		out.Conflicts = append(out.Conflicts, gen.ApplyConflict{
			Path: c.Path, BaseSha: c.BaseSHA, CurrentSha: c.CurrentSHA,
		})
	}
	return gen.ApplyFiles409JSONResponse(out)
}

// appliedPaths lists what the commit touched: the written files from the
// result (authoritative — the service drops byte-identical writes) plus the
// requested deletes.
func appliedPaths(body gen.ApplyRequest, res *spec.ApplyResult) []string {
	paths := make([]string, 0, len(res.Files)+len(body.Deletes))
	for _, f := range res.Files {
		paths = append(paths, f.Path)
	}
	for _, d := range body.Deletes {
		paths = append(paths, d.Path)
	}
	return paths
}

// applyRequestFromWire converts the generated body into the service's shape,
// decoding each write's content to the file's real bytes. `encoding` is the
// wire's concern only: everything below this line — validation, size limits,
// the commit itself — sees raw content, so a base64 write of a PDF lands as
// the PDF, not as its base64 text.
func applyRequestFromWire(in gen.ApplyRequest) (spec.ApplyRequest, error) {
	out := spec.ApplyRequest{Message: in.Message}
	for _, w := range in.Writes {
		content, err := decodeContent(w.Content, w.Encoding)
		if err != nil {
			return spec.ApplyRequest{}, err
		}
		out.Writes = append(out.Writes, spec.WriteOp{Path: w.Path, Content: content, BaseSHA: w.BaseSha})
	}
	for _, d := range in.Deletes {
		out.Deletes = append(out.Deletes, spec.DeleteOp{Path: d.Path, BaseSHA: d.BaseSha})
	}
	return out, nil
}

// decodeContent turns a write's wire content into the bytes to commit. utf8 —
// the contract's default, and what an omitted field means — is already those
// bytes. Undecodable base64 is the caller's error, so it is a 400: committing
// it would silently corrupt the file. So is an encoding outside the contract's
// enum: nothing here can know what those bytes are, and falling through to utf8
// would commit the caller's mistake as the file.
func decodeContent(content string, encoding gen.WriteOpEncoding) (string, error) {
	switch encoding {
	case "", gen.WriteOpEncodingUTF8:
		return content, nil
	case gen.WriteOpEncodingBase64:
		raw, err := base64.StdEncoding.DecodeString(content)
		if err != nil {
			return "", apierr.BadRequest("content is not valid base64")
		}
		return string(raw), nil
	default:
		return "", apierr.BadRequest(fmt.Sprintf("unsupported content encoding %q; want utf8 or base64", encoding))
	}
}

// applyResultToWire converts the service result into the contract schema.
func applyResultToWire(res *spec.ApplyResult) gen.ApplyResult {
	out := gen.ApplyResult{CommitSha: res.CommitSHA, Files: make([]gen.FileMeta, 0, len(res.Files))}
	for _, f := range res.Files {
		out.Files = append(out.Files, gen.FileMeta{Path: f.Path, Sha: f.SHA, Size: f.Size})
	}
	for _, w := range res.Warnings {
		out.Warnings = append(out.Warnings, gen.Warning{Path: w.Path, Code: w.Code, Message: w.Message})
	}
	return out
}

// mapFilesError maps the files service's typed errors onto the envelope —
// the strict-server port of the feature's Huma-era mapper.
func mapFilesError(err error) error {
	switch {
	case errors.Is(err, spec.ErrProjectRepoNotFound):
		return apierr.NotFound("project repository not found")
	case errors.Is(err, spec.ErrFileNotFound):
		return apierr.NotFound("file not found")
	case errors.Is(err, spec.ErrPathInvalid):
		return apierr.BadRequest(err.Error())
	case errors.Is(err, sourcecontrol.ErrRefNotFastForward):
		// Workspace.Mutate exhausted its CAS retries: the ref tip moved under
		// us on every attempt. That is a concurrent-write conflict, not a
		// server fault — surface it as a retryable 409, never a 500.
		return apierr.Conflict("the repository changed during the write; retry")
	default:
		return apierr.Internal("internal error")
	}
}
