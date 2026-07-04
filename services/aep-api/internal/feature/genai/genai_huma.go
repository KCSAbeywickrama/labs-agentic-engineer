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

package genai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/wso2/aep/aep-api/internal/clients/agentsvc"
	"github.com/wso2/aep/aep-api/internal/platform/humakit"
)

// --- Inputs / Outputs ------------------------------------------------------
// Every input embeds humakit.OrgScopedInput (org from the verified token; the
// IDOR fence). conversationId is a FE-chosen uuid; the service namespaces it
// into the authenticated tenant scope before it reaches the agents service.

type turnInput struct {
	humakit.OrgScopedInput
	ProjectName    string `path:"projectName" doc:"Project name (DNS-label slug)"`
	ConversationID string `path:"conversationId" doc:"FE-chosen conversation uuid"`
	Body           struct {
		UseCase                string            `json:"useCase" enum:"requirements-generate,requirements-chat,design-generate" doc:"Which generation/chat flow"`
		Instruction            string            `json:"instruction" doc:"User message / generation directive"`
		Files                  map[string]string `json:"files,omitempty" doc:"The FE's current draft (latest truth)"`
		FilesChangedExternally bool              `json:"filesChangedExternally,omitempty" doc:"User hand-edited since the last turn (chat)"`
		Target                 string            `json:"target,omitempty" doc:"Optional target (e.g. a doc type)"`
	}
}

type rehydrateInput struct {
	humakit.OrgScopedInput
	ProjectName    string `path:"projectName" doc:"Project name (DNS-label slug)"`
	ConversationID string `path:"conversationId" doc:"FE-chosen conversation uuid"`
}

type rehydrateOutput struct{ Body json.RawMessage }

// turnMaxBodyBytes bounds the turn request body to agree with the agents
// service's 10 MiB limit (§7). Huma returns 413 above it (mapped, like the
// upstream 413, straight through).
const turnMaxBodyBytes = 10 << 20

// turnInProgressError renders the 409 body verbatim as {"code":"turn_in_progress"}
// (Huma writes a StatusError value directly). The FE uses it to show "a turn is
// already running".
type turnInProgressError struct {
	Code string `json:"code"`
}

func (e *turnInProgressError) Error() string {
	return "a turn is already running for this conversation"
}
func (e *turnInProgressError) GetStatus() int { return http.StatusConflict }

// statusError carries an arbitrary status + message body for the upstream
// mappings that have no dedicated huma helper (413).
type statusError struct {
	status  int
	Message string `json:"message"`
}

func (e *statusError) Error() string  { return e.Message }
func (e *statusError) GetStatus() int { return e.status }

// RegisterGenAI registers the unified turn (SSE) + chat rehydrate operations.
func RegisterGenAI(api huma.API, svc GenAIService) {
	huma.Register(api, huma.Operation{
		OperationID: "create-turn",
		Method:      http.MethodPost,
		Path:        "/projects/{projectName}/conversations/{conversationId}/turns",
		Summary:     "Run a generation/chat turn (SSE — raw StreamPart frames + [DONE])",
		Tags:        []string{"GenAI"},
		Security:    humakit.SecurityUserJWT,
		// Agree with the agents service body limit (AGENT_BODY_LIMIT=10mb): the
		// FE snapshot rides in the body, so a too-large turn is a 413 here.
		MaxBodyBytes: turnMaxBodyBytes,
	}, func(ctx context.Context, in *turnInput) (*huma.StreamResponse, error) {
		body, err := svc.Turn(ctx, in.OrgHandle, in.ProjectName, TurnInput{
			UseCase:                in.Body.UseCase,
			ConversationID:         in.ConversationID,
			Instruction:            in.Body.Instruction,
			Files:                  in.Body.Files,
			FilesChangedExternally: in.Body.FilesChangedExternally,
			Target:                 in.Body.Target,
		})
		if err != nil {
			return nil, mapTurnError(err)
		}
		return &huma.StreamResponse{Body: func(hctx huma.Context) {
			hctx.SetHeader("Content-Type", "text/event-stream")
			hctx.SetHeader("Cache-Control", "no-cache")
			hctx.SetHeader("Connection", "keep-alive")
			hctx.SetHeader("X-Accel-Buffering", "no")
			hctx.SetStatus(http.StatusOK)
			w := hctx.BodyWriter()
			flush := func() {
				if f, ok := w.(http.Flusher); ok {
					f.Flush()
				}
			}
			flush()
			defer body.Close()
			// Verbatim passthrough — frames, `: keep-alive` comments and [DONE]
			// flow through unchanged; the BFF injects and folds nothing.
			passThrough(w, body, flush)
		}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-conversation",
		Method:      http.MethodGet,
		Path:        "/projects/{projectName}/conversations/{conversationId}",
		Summary:     "Rehydrate a chat conversation (messages only)",
		Tags:        []string{"GenAI"},
		Security:    humakit.SecurityUserJWT,
	}, func(ctx context.Context, in *rehydrateInput) (*rehydrateOutput, error) {
		raw, err := svc.Rehydrate(ctx, in.OrgHandle, in.ProjectName, in.ConversationID)
		if err != nil {
			return nil, mapRehydrateError(err)
		}
		return &rehydrateOutput{Body: raw}, nil
	})
}

// passThrough copies the upstream SSE body to the client writer, flushing after
// every chunk so frames and keep-alives are not buffered behind ingress.
func passThrough(w io.Writer, r io.Reader, flush func()) {
	buf := make([]byte, 16*1024)
	for {
		n, rerr := r.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return
			}
			flush()
		}
		if rerr != nil {
			return
		}
	}
}

// mapTurnError maps pre-stream failures to a BFF status. Upstream statuses map
// per §12.2: 409 → 409 turn_in_progress, 413 → 413, 400/500 → 502.
func mapTurnError(err error) error {
	var ue *agentsvc.UpstreamError
	if errors.As(err, &ue) {
		switch ue.StatusCode {
		case http.StatusConflict:
			return &turnInProgressError{Code: "turn_in_progress"}
		case http.StatusRequestEntityTooLarge:
			return &statusError{status: http.StatusRequestEntityTooLarge, Message: "request too large"}
		default:
			return huma.Error502BadGateway("agents service error")
		}
	}
	switch {
	case errors.Is(err, ErrProjectRepoNotFound):
		return huma.Error404NotFound("project repository not found")
	case errors.Is(err, ErrInvalidUseCase):
		return huma.Error400BadRequest("invalid use case")
	case errors.Is(err, ErrInvalidConversationID):
		return huma.Error400BadRequest("invalid conversation id")
	case errors.Is(err, ErrNoAnthropicKey):
		return huma.Error400BadRequest(ErrNoAnthropicKey.Error())
	case errors.Is(err, ErrRequirementsNotApproved):
		return huma.Error409Conflict(ErrRequirementsNotApproved.Error())
	default:
		return huma.Error500InternalServerError("internal error")
	}
}

func mapRehydrateError(err error) error {
	switch {
	case errors.Is(err, ErrConversationNotFound):
		return huma.Error404NotFound("conversation not found")
	case errors.Is(err, ErrProjectRepoNotFound):
		return huma.Error404NotFound("project repository not found")
	case errors.Is(err, ErrInvalidConversationID):
		return huma.Error400BadRequest("invalid conversation id")
	default:
		var ue *agentsvc.UpstreamError
		if errors.As(err, &ue) {
			return huma.Error502BadGateway("agents service error")
		}
		return huma.Error500InternalServerError("internal error")
	}
}
