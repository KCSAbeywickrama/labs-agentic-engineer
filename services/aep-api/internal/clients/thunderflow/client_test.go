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

package thunderflow

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
)

// fakeIssuer replays the five answers the real issuer gave on 2026-09-20 and
// records what it was asked, so the tests pin the REQUEST shapes — the part
// that was wrong for an hour.
type fakeIssuer struct {
	t          *testing.T
	refuse     bool
	mu         sync.Mutex
	executes   []map[string]any
	authorizeQ url.Values
	callback   map[string]any
	tokenForm  url.Values
	challenge  string
}

func (f *fakeIssuer) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth2/authorize", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.authorizeQ = r.URL.Query()
		f.challenge = r.URL.Query().Get("code_challenge")
		f.mu.Unlock()
		if r.URL.Query().Get("redirect_uri") == "" {
			http.Redirect(w, r, "/gate/error?errorCode=invalid_request&errorMessage=Invalid+redirect+URI", http.StatusFound)
			return
		}
		http.Redirect(w, r, "/gate/signin?applicationId=app&authId=AUTH-1&executionId=EXEC-1", http.StatusFound)
	})
	mux.HandleFunc("/flow/execute", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		f.executes = append(f.executes, body)
		n := len(f.executes)
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		view := map[string]any{
			"executionId": "EXEC-1", "flowStatus": "INCOMPLETE", "type": "VIEW", "challengeToken": "CT-1",
			"data": map[string]any{"actions": []map[string]any{{"ref": "action_001"}, {"ref": "action_signup"}}},
		}
		if n == 1 || f.refuse || body["action"] != "action_001" {
			_ = json.NewEncoder(w).Encode(view) // first call, or anything but a real credentials submit: the view
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"executionId": "EXEC-1", "flowStatus": "COMPLETE", "assertion": "ASSERTION-JWT"})
	})
	mux.HandleFunc("/oauth2/auth/callback", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		f.callback = body
		f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"redirect_uri": "http://tryit.local/callback?code=CODE-1&state=x"})
	})
	mux.HandleFunc("/oauth2/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		f.mu.Lock()
		f.tokenForm = r.PostForm
		f.mu.Unlock()
		sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
		if base64.RawURLEncoding.EncodeToString(sum[:]) != f.challenge {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "invalid_grant", "error_description": "PKCE verifier mismatch"})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "AT-1", "expires_in": 3600, "scope": "openid triage:use"})
	})
	return mux
}

func signIn(srv *httptest.Server) SignIn {
	return SignIn{
		Issuer: srv.URL, ClientID: "project-client", RedirectURI: "http://tryit.local/callback",
		Resource: "https://aep.wso2.com/orgs/acme/projects/workouts", Scopes: []string{"openid", "triage:use"},
		Username: "test-engineer", Password: "pw",
	}
}

// The whole sequence, and the shapes the issuer insists on: redirect_uri and
// resource on authorize, `action` (never `actionRef`) and no authId on the
// credentials step, the challenge token echoed, authId only at the callback,
// and a PKCE verifier that matches the challenge on the token exchange.
func TestSignIn_SpeaksTheGatesProtocol(t *testing.T) {
	f := &fakeIssuer{t: t}
	srv := httptest.NewServer(f.handler())
	defer srv.Close()

	tok, err := New(Config{}).SignIn(context.Background(), signIn(srv))
	if err != nil {
		t.Fatalf("SignIn: %v", err)
	}
	if tok.AccessToken != "AT-1" || tok.ExpiresIn != 3600 || tok.Scope != "openid triage:use" {
		t.Errorf("token = %+v", tok)
	}
	if got := f.authorizeQ.Get("resource"); got != "https://aep.wso2.com/orgs/acme/projects/workouts" {
		t.Errorf("authorize resource = %q", got)
	}
	if got := f.authorizeQ.Get("redirect_uri"); got != "http://tryit.local/callback" {
		t.Errorf("authorize redirect_uri = %q", got)
	}
	if len(f.executes) != 2 {
		t.Fatalf("want 2 execute calls (view, credentials); got %d", len(f.executes))
	}
	creds := f.executes[1]
	if creds["action"] != "action_001" {
		t.Errorf("credentials step must select the action with key 'action'; body = %v", creds)
	}
	if _, has := creds["actionRef"]; has {
		t.Errorf("'actionRef' is ignored by the issuer and must not be sent")
	}
	if _, has := creds["authId"]; has {
		t.Errorf("authId does not belong in a /flow/execute body")
	}
	if creds["challengeToken"] != "CT-1" {
		t.Errorf("challenge token not echoed: %v", creds["challengeToken"])
	}
	if in, _ := creds["inputs"].(map[string]any); in["username"] != "test-engineer" || in["password"] != "pw" {
		t.Errorf("inputs keyed by identifier expected; got %v", creds["inputs"])
	}
	if f.callback["assertion"] != "ASSERTION-JWT" || f.callback["authId"] != "AUTH-1" {
		t.Errorf("callback must carry the assertion and the authId: %v", f.callback)
	}
	for k, want := range map[string]string{"grant_type": "authorization_code", "code": "CODE-1", "client_id": "project-client",
		"redirect_uri": "http://tryit.local/callback", "resource": "https://aep.wso2.com/orgs/acme/projects/workouts"} {
		if got := f.tokenForm.Get(k); got != want {
			t.Errorf("token form %s = %q; want %q", k, got, want)
		}
	}
	if f.tokenForm.Get("client_secret") != "" {
		t.Errorf("a public client sends no secret")
	}
}

// The view rendered again after credentials is the issuer refusing them. That
// must be ErrRefused at once — not a second submit, not a loop — and nothing
// after it may be called.
func TestSignIn_ReRenderedViewIsARefusal(t *testing.T) {
	f := &fakeIssuer{t: t, refuse: true}
	srv := httptest.NewServer(f.handler())
	defer srv.Close()

	_, err := New(Config{}).SignIn(context.Background(), signIn(srv))
	if !errors.Is(err, ErrRefused) {
		t.Fatalf("err = %v; want ErrRefused", err)
	}
	if len(f.executes) != 2 {
		t.Errorf("a refusal must not be retried; execute calls = %d", len(f.executes))
	}
	if f.callback != nil || f.tokenForm != nil {
		t.Errorf("nothing after the refusal may run: callback=%v token=%v", f.callback, f.tokenForm)
	}
}

// An issuer that will not start the flow says so on the authorize redirect; the
// client reports that instead of posting to a flow that does not exist.
func TestSignIn_AuthorizeRefusalIsNamed(t *testing.T) {
	f := &fakeIssuer{t: t}
	srv := httptest.NewServer(f.handler())
	defer srv.Close()
	in := signIn(srv)
	in.RedirectURI = "" // the fake, like the issuer, refuses an authorize without one
	_, err := New(Config{}).SignIn(context.Background(), in)
	if err == nil || strings.Contains(err.Error(), "authId") {
		t.Fatalf("want a named validation/authorize error, got %v", err)
	}
	if len(f.executes) != 0 {
		t.Errorf("nothing may be executed after a refused authorize")
	}
}
