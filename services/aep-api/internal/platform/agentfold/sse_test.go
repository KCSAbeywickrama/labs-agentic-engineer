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

package agentfold

import (
	"errors"
	"io"
	"strings"
	"testing"
)

// drip yields one byte per Read to exercise cross-chunk frame buffering
// (including splits inside multibyte characters and the "\n\n" boundary).
type drip struct{ rest []byte }

func (d *drip) Read(p []byte) (int, error) {
	if len(d.rest) == 0 {
		return 0, io.EOF
	}
	p[0] = d.rest[0]
	d.rest = d.rest[1:]
	return 1, nil
}

const sampleStream = ": keep-alive\n\n" +
	"data: {\"type\":\"text-delta\",\"text\":\"héllo 🎉\"}\n\n" +
	"data: {\"type\":\"tool-call\",\"toolCallId\":\"t1\",\"toolName\":\"addFile\",\"input\":{\"path\":\"a.md\",\"content\":\"x\"}}\n\n" +
	"data: not-json-truncation-remnant\n\n" +
	"data: {\"type\":\"manifest\",\"files\":{\"a.md\":\"ff\"},\"deleted\":[]}\n\n" +
	"data: [DONE]\n\n"

func collectParts(t *testing.T, r io.Reader) ([]StreamPart, StreamEnd) {
	t.Helper()
	var parts []StreamPart
	end, err := ForEachPart(r, func(p StreamPart) error {
		parts = append(parts, p)
		return nil
	})
	if err != nil {
		t.Fatalf("ForEachPart: %v", err)
	}
	return parts, end
}

func TestForEachPart_FramingDoneAndChunking(t *testing.T) {
	for name, r := range map[string]io.Reader{
		"whole":    strings.NewReader(sampleStream),
		"per-byte": &drip{rest: []byte(sampleStream)},
	} {
		parts, end := collectParts(t, r)
		if end != StreamDone {
			t.Fatalf("%s: end = %q", name, end)
		}
		if len(parts) != 3 {
			t.Fatalf("%s: parts = %d (%+v)", name, len(parts), parts)
		}
		if parts[0].Text != "héllo 🎉" {
			t.Errorf("%s: multibyte text mangled: %q", name, parts[0].Text)
		}
		if parts[1].ToolName != "addFile" || parts[1].ToolCallID != "t1" {
			t.Errorf("%s: tool-call fields: %+v", name, parts[1])
		}
		m, ok := ManifestOf(parts[2])
		if !ok || m.Files["a.md"] != "ff" {
			t.Errorf("%s: manifest part: %+v", name, parts[2])
		}
	}
}

func TestForEachPart_EOFWithoutDone(t *testing.T) {
	cut := sampleStream[:strings.Index(sampleStream, "[DONE]")-len("data: ")]
	parts, end := collectParts(t, strings.NewReader(cut))
	if end != StreamEOF {
		t.Fatalf("end = %q, want eof (severed stream)", end)
	}
	if len(parts) != 3 {
		t.Fatalf("parts before the cut = %d", len(parts))
	}
	// A partial trailing frame (no closing blank line) is dropped, not parsed.
	partial := "data: {\"type\":\"finish\"}\n\ndata: {\"type\":\"trunc"
	parts, end = collectParts(t, strings.NewReader(partial))
	if end != StreamEOF || len(parts) != 1 || parts[0].Type != "finish" {
		t.Fatalf("partial frame handling: end=%q parts=%+v", end, parts)
	}
}

func TestForEachPart_CallbackErrorAborts(t *testing.T) {
	boom := errors.New("abort")
	_, err := ForEachPart(strings.NewReader(sampleStream), func(StreamPart) error { return boom })
	if !errors.Is(err, boom) {
		t.Fatalf("want callback error, got %v", err)
	}
}
