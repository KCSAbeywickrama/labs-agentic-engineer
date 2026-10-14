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

// Package jev is aep-api's client of Jev, TypeSafe's report classifier: one
// choice question asking what kind of report a user's message is. The
// platform holds one key, and only aep-api holds it: the AE Studio pods ask
// through aep-api (the Issues chat's classify_report tool), never Jev itself.
// The key travels in the Authorization header only; no error, log line or
// answer carries it, nor the report's text.
package jev

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"sort"
	"time"
)

// DefaultURL is Jev's endpoint when the install names none.
const DefaultURL = "https://api.typesafe.ai/v1/systemone"

// The report's caps: what travels is cut to these, so one turn cannot ship an
// unbounded text to a third party on the platform's key.
const (
	MaxMessageRunes   = 4000
	MaxRecentMessages = 6
	MaxRecentRunes    = 1000
)

const (
	defaultTimeout = 5 * time.Second
	// maxAnswerBytes bounds the answer read; Jev's is a few hundred bytes.
	maxAnswerBytes = 64 << 10
)

// Kinds are the report kinds Jev chooses from.
var Kinds = []string{"bug", "feature", "improvement", "question"}

var criteria = map[string]string{
	"bug":         "Something that exists does not work as it should: an error, a crash, a broken button, wrong output.",
	"feature":     "A request for a new capability the product does not have yet.",
	"improvement": "A change to make something that already works better: faster, clearer, easier.",
	"question":    "A question or remark that reports nothing and asks for nothing to change.",
}

const instructions = "What kind of report is `message`? Use `recent_messages` to resolve words like it or that."

// Report is what is classified: the user's message and up to
// MaxRecentMessages earlier ones, oldest first.
type Report struct {
	Message string
	Recent  []string
}

// Alternative is one kind with its probability.
type Alternative struct {
	Kind string  `json:"kind"`
	P    float64 `json:"p"`
}

// Classification is Jev's answer: the kind, its confidence, and the two most
// probable kinds, most probable first.
type Classification struct {
	Kind         string
	Confidence   float64
	Alternatives []Alternative
}

// ErrUnavailable is every failure to classify: Jev unreachable or slow, a
// non-2xx, or an answer that is not one.
var ErrUnavailable = errors.New("jev: unavailable")

// Client asks Jev with the platform's key.
type Client struct {
	url, apiKey string
	http        *http.Client
	timeout     time.Duration
}

// New is a Client of Jev at url ("" = DefaultURL) with apiKey.
func New(url, apiKey string) *Client {
	if url == "" {
		url = DefaultURL
	}
	return &Client{url: url, apiKey: apiKey, http: &http.Client{}, timeout: defaultTimeout}
}

type jevAnswer struct {
	Answers struct {
		Kind *struct {
			Choice        string             `json:"choice"`
			Confidence    float64            `json:"confidence"`
			Probabilities map[string]float64 `json:"probabilities"`
		} `json:"kind"`
	} `json:"answers"`
}

// Classify asks Jev what kind of report r is, cut to the caps. Every failure
// is ErrUnavailable with a value-free reason.
func (c *Client) Classify(ctx context.Context, r Report) (Classification, error) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	body, err := json.Marshal(request(r))
	if err != nil {
		return Classification{}, fmt.Errorf("%w: encode the request", ErrUnavailable)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
	if err != nil {
		return Classification{}, fmt.Errorf("%w: build the request", ErrUnavailable)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	res, err := c.http.Do(req)
	if err != nil {
		// The transport's error names the URL only, but say less: its class.
		if ctx.Err() != nil {
			return Classification{}, fmt.Errorf("%w: timed out", ErrUnavailable)
		}
		return Classification{}, fmt.Errorf("%w: request failed", ErrUnavailable)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return Classification{}, fmt.Errorf("%w: status %d", ErrUnavailable, res.StatusCode)
	}
	var a jevAnswer
	if err := json.NewDecoder(io.LimitReader(res.Body, maxAnswerBytes)).Decode(&a); err != nil {
		return Classification{}, fmt.Errorf("%w: unreadable answer", ErrUnavailable)
	}
	k := a.Answers.Kind
	if k == nil || !slices.Contains(Kinds, k.Choice) {
		return Classification{}, fmt.Errorf("%w: no kind in the answer", ErrUnavailable)
	}
	return Classification{Kind: k.Choice, Confidence: k.Confidence, Alternatives: alternatives(k.Choice, k.Confidence, k.Probabilities)}, nil
}

// request is Jev's request body for r, cut to the caps. It names no project:
// the report's words are all a third party learns.
func request(r Report) map[string]any {
	recent := r.Recent
	if len(recent) > MaxRecentMessages {
		recent = recent[len(recent)-MaxRecentMessages:]
	}
	cut := make([]string, len(recent))
	for i, m := range recent {
		cut[i] = truncate(m, MaxRecentRunes)
	}
	return map[string]any{
		"model": "jev-latest",
		"state": map[string]any{
			"message":           truncate(r.Message, MaxMessageRunes),
			"recent_messages":   cut,
			"where_the_user_is": map[string]any{"page": "issues"},
		},
		"questions": map[string]any{
			"kind": map[string]any{"type": "choice", "instructions": instructions, "criteria": criteria},
		},
	}
}

// alternatives are the two most probable kinds; the choice alone when Jev
// sent no probabilities.
func alternatives(choice string, confidence float64, p map[string]float64) []Alternative {
	var out []Alternative
	for _, k := range Kinds {
		if v, ok := p[k]; ok {
			out = append(out, Alternative{Kind: k, P: v})
		}
	}
	if len(out) == 0 {
		return []Alternative{{Kind: choice, P: confidence}}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].P > out[j].P })
	if len(out) > 2 {
		out = out[:2]
	}
	return out
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}
