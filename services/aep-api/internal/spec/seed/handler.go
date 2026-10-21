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

package seed

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"

	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/platform/apierr"
	"github.com/wso2/aep/aep-api/internal/platform/specbundle"
	"github.com/wso2/aep/aep-api/internal/platform/tenant"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// bundleField is the multipart field the contract names.
const bundleField = "bundle"

// The envelope codes the contract documents.
const (
	codeBundleRejected = "bundle_rejected"
	codeAlreadyStarted = "already_started"
)

// Handler serves seed-project. The operation is org-scoped: the tenant gate
// bound the token org before it runs.
type Handler struct {
	seed *spec.SeedService
}

// New returns the slice's handler over the root's seed service.
func New(seed *spec.SeedService) *Handler {
	return &Handler{seed: seed}
}

// SeedProject reads the one `bundle` part whole — a bundle is held whole by
// definition, and specbundle.MaxBundleBytes bounds it with one byte to
// spare so an oversized upload is a 400, never a buffer — then seeds the
// project from it.
func (h *Handler) SeedProject(ctx context.Context, request gen.SeedProjectRequestObject) (gen.SeedProjectResponseObject, error) {
	org := tenant.BoundOrgFromContext(ctx)
	if request.Body == nil {
		return nil, apierr.BadRequest("missing '" + bundleField + "' field")
	}
	data, err := readBundlePart(request.Body)
	if err != nil {
		return nil, err
	}
	if err := h.seed.Seed(ctx, org, request.ProjectName, data); err != nil {
		return nil, mapSeedError(ctx, err)
	}
	return gen.SeedProject204Response{}, nil
}

// readBundlePart answers the bytes of the first `bundle` part; other fields
// are skipped, as the contract names only that one. One byte past the bound
// is the refusal, so the declared size is never trusted.
func readBundlePart(body *multipart.Reader) ([]byte, error) {
	for {
		part, err := body.NextPart()
		if errors.Is(err, io.EOF) {
			return nil, apierr.BadRequest("missing '" + bundleField + "' field")
		}
		if err != nil {
			return nil, apierr.BadRequest("can't decode multipart body: " + err.Error())
		}
		if part.FormName() != bundleField {
			continue
		}
		data, err := io.ReadAll(io.LimitReader(part, specbundle.MaxBundleBytes+1))
		if err != nil {
			return nil, apierr.BadRequest("can't read the bundle: " + err.Error())
		}
		if len(data) > specbundle.MaxBundleBytes {
			return nil, apierr.New(http.StatusBadRequest, codeBundleRejected,
				fmt.Sprintf("the bundle is over %d MiB", specbundle.MaxBundleBytes>>20), nil)
		}
		return data, nil
	}
}

// mapSeedError maps what the seed answered onto the envelope.
func mapSeedError(ctx context.Context, err error) error {
	var rejected *spec.SeedRejectedError
	switch {
	case errors.As(err, &rejected):
		return apierr.New(http.StatusBadRequest, codeBundleRejected, rejected.Reason, nil)
	case errors.Is(err, specbundle.ErrRejected):
		return apierr.New(http.StatusBadRequest, codeBundleRejected, specbundle.Reason(err), nil)
	case errors.Is(err, spec.ErrProjectAlreadyStarted):
		return apierr.New(http.StatusConflict, codeAlreadyStarted, "the project has already run an agent turn; a seed would overwrite its work", nil)
	case errors.Is(err, sourcecontrol.ErrRepoNotFound):
		return apierr.NotFound("project repository not found")
	default:
		slog.ErrorContext(ctx, "seed: failed", "error", err)
		return apierr.WithCause(apierr.Internal("internal error"), err)
	}
}
