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

package app

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/wso2/aep/aep-api/internal/config"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol/issues"
)

// No Jev key, no classifier (classify_report answers unknown); with one, the
// classifier asks Jev at the configured URL and answers the issues package's
// shape.
func TestReportClassifier(t *testing.T) {
	if reportClassifier(config.JevConfig{URL: "http://unused"}) != nil {
		t.Fatal("no key must mean no classifier")
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer k" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = io.WriteString(w, `{"answers":{"kind":{"choice":"feature","confidence":0.85}}}`)
	}))
	defer srv.Close()
	got, err := reportClassifier(config.JevConfig{APIKey: "k", URL: srv.URL}).ClassifyReport(context.Background(), "acme", issues.Report{Message: "add CSV export"})
	want := issues.ReportClass{Kind: "feature", Confidence: 0.85, Alternatives: []issues.KindChance{{Kind: "feature", P: 0.85}}}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v err %v", got, err)
	}
}
