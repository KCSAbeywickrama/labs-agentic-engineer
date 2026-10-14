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

package jev

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

const testKey = "jev-secret-key"

// jevServer answers every request with status and body, recording the last
// request's Authorization header and decoded body.
func jevServer(t *testing.T, status int, body string, delay time.Duration) (*httptest.Server, *http.Header, *map[string]any) {
	t.Helper()
	var hdr http.Header
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hdr = r.Header.Clone()
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &got)
		if delay > 0 {
			select {
			case <-time.After(delay):
			case <-r.Context().Done():
				return
			}
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv, &hdr, &got
}

const answer = `{"answers":{"kind":{"choice":"bug","confidence":0.91,"probabilities":{"bug":0.91,"feature":0.02,"improvement":0.06,"question":0.01}}}}`

// The key goes in the Authorization header only; the report goes as Jev's
// choice question; the answer is the kind, its confidence and the two most
// probable kinds.
func TestClassify_AsksJevWithTheKey(t *testing.T) {
	srv, hdr, body := jevServer(t, http.StatusOK, answer, 0)
	c := New(srv.URL, testKey)
	got, err := c.Classify(context.Background(), Report{Message: "the save button does nothing", Recent: []string{"I opened expenses"}})
	if err != nil {
		t.Fatal(err)
	}
	want := Classification{Kind: "bug", Confidence: 0.91, Alternatives: []Alternative{{"bug", 0.91}, {"improvement", 0.06}}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	if hdr.Get("Authorization") != "Bearer "+testKey {
		t.Errorf("authorization = %q", hdr.Get("Authorization"))
	}
	state, _ := (*body)["state"].(map[string]any)
	if (*body)["model"] != "jev-latest" || state["message"] != "the save button does nothing" ||
		!reflect.DeepEqual(state["recent_messages"], []any{"I opened expenses"}) {
		t.Errorf("request body %v", *body)
	}
	if _, ok := (*body)["questions"].(map[string]any)["kind"]; !ok {
		t.Errorf("no kind question: %v", *body)
	}
}

// A report past the caps is cut before it leaves: the message, each earlier
// message, and how many earlier messages travel.
func TestClassify_CapsTheReport(t *testing.T) {
	srv, _, body := jevServer(t, http.StatusOK, answer, 0)
	recent := make([]string, MaxRecentMessages+3)
	for i := range recent {
		recent[i] = strings.Repeat("r", MaxRecentRunes+10)
	}
	if _, err := New(srv.URL, testKey).Classify(context.Background(), Report{Message: strings.Repeat("m", MaxMessageRunes+10), Recent: recent}); err != nil {
		t.Fatal(err)
	}
	state := (*body)["state"].(map[string]any)
	sent := state["recent_messages"].([]any)
	if n := len([]rune(state["message"].(string))); n != MaxMessageRunes {
		t.Errorf("message runes = %d", n)
	}
	if len(sent) != MaxRecentMessages || len([]rune(sent[0].(string))) != MaxRecentRunes {
		t.Errorf("recent = %d messages, first %d runes", len(sent), len([]rune(sent[0].(string))))
	}
}

// Every failure is an error that names no key and no report: a non-2xx, a
// body that is not Jev's answer, a choice outside the kinds, a timeout.
func TestClassify_FailuresAreValueFreeErrors(t *testing.T) {
	for name, tc := range map[string]struct {
		status int
		body   string
		delay  time.Duration
	}{
		"401":            {http.StatusUnauthorized, `{"error":"bad key ` + testKey + `"}`, 0},
		"not json":       {http.StatusOK, `<html>`, 0},
		"no answer":      {http.StatusOK, `{"answers":{}}`, 0},
		"unknown choice": {http.StatusOK, `{"answers":{"kind":{"choice":"rant","confidence":1}}}`, 0},
		"timeout":        {http.StatusOK, answer, 2 * time.Second},
	} {
		srv, _, _ := jevServer(t, tc.status, tc.body, tc.delay)
		c := New(srv.URL, testKey)
		c.timeout = 200 * time.Millisecond
		_, err := c.Classify(context.Background(), Report{Message: "secret report text"})
		if err == nil {
			t.Errorf("%s: no error", name)
			continue
		}
		if strings.Contains(err.Error(), testKey) || strings.Contains(err.Error(), "secret report text") {
			t.Errorf("%s: error carries a value: %v", name, err)
		}
	}
}
