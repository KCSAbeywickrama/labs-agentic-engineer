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
	"errors"
	"io"
	"strings"
	"testing"
)

// errAfterReader yields its payload, then fails with a non-EOF error —
// an upstream agents-service connection dying mid-stream.
type errAfterReader struct {
	r   io.Reader
	err error
}

func (e *errAfterReader) Read(p []byte) (int, error) {
	n, err := e.r.Read(p)
	if err == io.EOF {
		return n, e.err
	}
	return n, err
}

func TestPassThroughVerbatimOnCleanEOF(t *testing.T) {
	const body = "data: {\"type\":\"text-delta\",\"text\":\"hi\"}\n\ndata: [DONE]\n\n"
	var out strings.Builder
	passThrough(&out, strings.NewReader(body), func() {})
	if out.String() != body {
		t.Errorf("clean stream must pass through verbatim:\n got %q\nwant %q", out.String(), body)
	}
}

// A mid-stream upstream read failure must stay distinguishable in transit
// (for diagnosis) WITHOUT synthesizing frames the client would act on: no
// error frame (that would turn a salvageable truncation into a hard failure
// discarding the partial fold) and no [DONE] (the missing sentinel is exactly
// how the client detects truncation). An SSE comment is invisible to parsers.
func TestPassThroughMarksUpstreamFailureWithComment(t *testing.T) {
	// The last frame is cut mid-JSON — the failure can land anywhere.
	const partial = "data: {\"type\":\"text-delta\",\"text\":\"hi\"}\n\ndata: {\"type\":\"tool-inp"
	var out strings.Builder
	passThrough(&out, &errAfterReader{r: strings.NewReader(partial), err: errors.New("connection reset")}, func() {})

	got := out.String()
	if !strings.HasPrefix(got, partial) {
		t.Fatalf("copied bytes must be preserved:\n got %q", got)
	}
	tail := strings.TrimPrefix(got, partial)
	// The blank line terminates the possibly-partial in-flight frame (clients
	// skip the unparseable remnant); the comment records why the stream ended.
	if want := "\n\n: upstream-error\n\n"; tail != want {
		t.Errorf("upstream failure marker:\n got tail %q\nwant %q", tail, want)
	}
	if strings.Contains(got, "[DONE]") {
		t.Errorf("a failed stream must NOT carry the [DONE] sentinel:\n got %q", got)
	}
}
