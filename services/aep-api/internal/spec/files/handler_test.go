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
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/platform/apierr"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// A wrapped Workspace.Mutate CAS-exhaustion (ErrRefNotFastForward) is a
// concurrent-write conflict, so mapFilesError must render it as a 409 — not
// the 500 the default arm would otherwise produce. (Ported from the files
// feature's Huma-era internal test at the contract-first cutover.)
func TestMapFilesError_CASExhaustionMapsTo409(t *testing.T) {
	err := mapFilesError(fmt.Errorf("apply: mutate: %w", sourcecontrol.ErrRefNotFastForward))
	var ae *apierr.Error
	if !errors.As(err, &ae) {
		t.Fatalf("mapped error %T is not an *apierr.Error", err)
	}
	if ae.Status != http.StatusConflict || ae.Code != apierr.CodeConflict {
		t.Fatalf("status/code = %d/%s, want 409/%s (CAS exhaustion is a retryable conflict)",
			ae.Status, ae.Code, apierr.CodeConflict)
	}
}

// A write declaring encoding=base64 carries binary bytes (a PDF reference
// document, issue #383/#384). The server decodes before the content reaches
// the service, so what gets committed is the file's real bytes — not the
// base64 text. Without decoding, the blob is silently corrupt.
func TestApplyRequestFromWire_Base64WriteDecodesToRawBytes(t *testing.T) {
	// A minimal PDF header — bytes that are not valid UTF-8 text, so a
	// pass-through would be visible as corruption.
	raw := []byte{0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A, 0xFF, 0xFE, 0x00}
	body := gen.ApplyRequest{Writes: []gen.WriteOp{{
		Path:     "specs/requirements/references/doc.pdf",
		Content:  base64.StdEncoding.EncodeToString(raw),
		Encoding: gen.WriteOpEncodingBase64,	}}}

	got, err := applyRequestFromWire(body)
	if err != nil {
		t.Fatalf("applyRequestFromWire returned error %v, want nil", err)
	}
	if len(got.Writes) != 1 {
		t.Fatalf("got %d writes, want 1", len(got.Writes))
	}
	if got.Writes[0].Content != string(raw) {
		t.Fatalf("content = %q, want the decoded bytes %q", got.Writes[0].Content, string(raw))
	}
}

// utf8 is the default encoding: content is already the file's bytes and must
// survive byte-identically. An empty encoding means the same thing — every
// caller predating the field keeps working.
func TestApplyRequestFromWire_UTF8AndDefaultPassContentThrough(t *testing.T) {
	const content = "# Requirements\n\nplain markdown — with unicode ✅\n"
	for _, enc := range []gen.WriteOpEncoding{gen.WriteOpEncodingUTF8, ""} {		body := gen.ApplyRequest{Writes: []gen.WriteOp{{
			Path: "specs/requirements/requirements.md", Content: content, Encoding: enc,
		}}}

		got, err := applyRequestFromWire(body)
		if err != nil {
			t.Fatalf("encoding %q: returned error %v, want nil", enc, err)
		}
		if got.Writes[0].Content != content {
			t.Fatalf("encoding %q: content = %q, want it unchanged %q", enc, got.Writes[0].Content, content)
		}
	}
}

// Content that claims to be base64 but is not decodable is the client's
// error, so it must surface as a 400 — never a 500, and never a commit of
// garbage bytes.
func TestApplyRequestFromWire_InvalidBase64IsBadRequest(t *testing.T) {
	body := gen.ApplyRequest{Writes: []gen.WriteOp{{
		Path: "specs/requirements/references/doc.pdf", Content: "!!!not base64!!!", Encoding: gen.WriteOpEncodingBase64,	}}}

	_, err := applyRequestFromWire(body)
	if err == nil {
		t.Fatal("applyRequestFromWire returned nil error for undecodable base64, want a 400")
	}
	var ae *apierr.Error
	if !errors.As(err, &ae) {
		t.Fatalf("error %T is not an *apierr.Error", err)
	}
	if ae.Status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (bad content is the caller's fault)", ae.Status)
	}
}
