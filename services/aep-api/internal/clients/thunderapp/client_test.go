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

package thunderapp_test

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wso2/aep/aep-api/internal/clients/thunderapp"
)

// TestGet_200DecodesSpecStatusGeneration pins the ThunderApplication CR GET
// shape the deploy-wait consumes: redirectUris (string), ready, generations.
func TestGet_200DecodesSpecStatusGeneration(t *testing.T) {
	t.Parallel()
	const (
		ns   = "acme"
		name = "proj-user-auth"
		tok  = "sa-token"
	)
	var gotAuth, gotPath string
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		_ = json.NewEncoder(w).Encode(map[string]any{
			"metadata": map[string]any{"generation": 2},
			"spec":     map[string]any{"redirectUris": "http://web.local/callback"},
			"status":   map[string]any{"ready": true, "observedGeneration": 2},
		})
	}))
	t.Cleanup(srv.Close)

	c := thunderapp.New(thunderapp.Config{
		BaseURL:     srv.URL,
		BearerToken: tok,
		HTTPClient:  tlsClientFor(t, srv),
	})
	view, err := c.Get(context.Background(), ns, name)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if view == nil {
		t.Fatal("Get: want view, got nil")
	}
	if gotPath != "/apis/aep.wso2.com/v1alpha1/namespaces/acme/thunderapplications/proj-user-auth" {
		t.Errorf("path = %q", gotPath)
	}
	if gotAuth != "Bearer "+tok {
		t.Errorf("Authorization = %q", gotAuth)
	}
	if view.RedirectURIs != "http://web.local/callback" {
		t.Errorf("RedirectURIs = %q", view.RedirectURIs)
	}
	if !view.Ready {
		t.Error("Ready = false, want true")
	}
	if view.Generation != 2 || view.ObservedGeneration != 2 {
		t.Errorf("generations = %d/%d, want 2/2", view.Generation, view.ObservedGeneration)
	}
}

func TestGet_404ReturnsNilNil(t *testing.T) {
	t.Parallel()
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, `{"kind":"Status","status":"Failure","code":404}`)
	}))
	t.Cleanup(srv.Close)

	c := thunderapp.New(thunderapp.Config{
		BaseURL:     srv.URL,
		BearerToken: "t",
		HTTPClient:  tlsClientFor(t, srv),
	})
	view, err := c.Get(context.Background(), "ns", "missing")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if view != nil {
		t.Fatalf("want (nil, nil) on 404; got %+v", view)
	}
}

func TestGet_5xxReturnsError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = io.WriteString(w, "boom")
	}))
	t.Cleanup(srv.Close)

	c := thunderapp.New(thunderapp.Config{
		BaseURL:     srv.URL,
		BearerToken: "t",
		HTTPClient:  tlsClientFor(t, srv),
	})
	view, err := c.Get(context.Background(), "ns", "name")
	if err == nil {
		t.Fatal("want error on 5xx")
	}
	if view != nil {
		t.Fatalf("want nil view on 5xx; got %+v", view)
	}
	if !strings.Contains(err.Error(), "500") && !strings.Contains(err.Error(), "boom") {
		t.Errorf("error = %v, want status/body hint", err)
	}
}

func tlsClientFor(t *testing.T, srv *httptest.Server) *http.Client {
	t.Helper()
	cert, err := x509.ParseCertificate(srv.TLS.Certificates[0].Certificate[0])
	if err != nil {
		t.Fatalf("parse test cert: %v", err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	return &http.Client{Transport: &http.Transport{
		TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
	}}
}
