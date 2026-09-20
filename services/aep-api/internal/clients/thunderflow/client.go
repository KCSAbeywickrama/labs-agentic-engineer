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

// Package thunderflow signs a USER in to a ThunderID issuer without a browser,
// as a public OAuth client, and returns the access token the authorize request
// asked for.
//
// It is the sequence the Gate UI performs, read off the Gate's own bundle rather
// than guessed — two details cost an hour to learn and are pinned by the tests:
// the credentials step selects its action with the key `action` (`actionRef` is
// silently ignored and the view is re-rendered, which looks exactly like a wrong
// password), and `authId` is not part of any /flow/execute body — it belongs to
// the final /oauth2/auth/callback that turns the flow's assertion into a code.
//
// This is NOT thundersvc. That client is the platform's ADMIN surface on the
// platform IdP, authenticated as a system client; this one holds no credential
// of its own and speaks to whichever issuer it is pointed at — the environment
// IdP a project's test users live on.
package thunderflow

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// SignIn is one user sign-in: who, at which issuer, as which client, for which
// resource server. RedirectURI must be one the client has registered — the
// issuer refuses the authorize request otherwise — and nothing has to be
// listening there: the code is read off the callback's answer, never fetched.
type SignIn struct {
	Issuer      string
	ClientID    string
	RedirectURI string
	// Resource is the RFC 8707 indicator — the audience the token is minted for.
	// Without it the issuer picks its default audience and the project's gateway
	// refuses the token before it reads a scope.
	Resource string
	// Scopes are requested space-separated. The issuer narrows them to what the
	// user's roles grant on Resource; asking for what the account holds is what
	// keeps the token from coming back with `openid` alone.
	Scopes   []string
	Username string
	Password string
}

// Token is the issuer's answer. ExpiresIn is seconds from issue.
type Token struct {
	AccessToken string
	ExpiresIn   int
	Scope       string
}

// ErrRefused is the issuer declining the credentials: after they were
// submitted it rendered the sign-in view again instead of completing. A wrong
// or rotated password looks exactly like this, so it is a distinct error the
// caller can name rather than retry.
var ErrRefused = errors.New("thunderflow: sign-in refused by the issuer")

// Client performs sign-ins. One implementation; the interface is what a caller
// in another package depends on and what its tests fake.
type Client interface {
	SignIn(ctx context.Context, in SignIn) (Token, error)
}

// Config wires the client. HTTPClient defaults to a 30 s timeout and NEVER
// follows redirects — the authorize response is a 302 whose Location is the
// data, and following it would fetch the Gate's HTML and lose the ids.
type Config struct {
	HTTPClient *http.Client
}

type client struct{ hc *http.Client }

// New builds a Client.
func New(cfg Config) Client {
	hc := cfg.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	// Copy so a caller's shared client keeps its own redirect policy.
	c := *hc
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &client{hc: &c}
}

// credentialsAction is the ref the sign-in view gives its username/password
// action. Read off the view rather than assumed: the sequence fails closed when
// the view offers no such action.
const credentialsAction = "action_001"

func (c *client) SignIn(ctx context.Context, in SignIn) (Token, error) {
	if in.Issuer == "" || in.ClientID == "" || in.RedirectURI == "" || in.Username == "" {
		return Token{}, errors.New("thunderflow: issuer, clientID, redirectURI and username are required")
	}
	issuer := strings.TrimRight(in.Issuer, "/")
	verifier, challenge, err := pkce()
	if err != nil {
		return Token{}, err
	}

	// 1. authorize → 302 to the Gate, carrying the flow's authId + executionId.
	q := url.Values{
		"response_type":         {"code"},
		"client_id":             {in.ClientID},
		"redirect_uri":          {in.RedirectURI},
		"scope":                 {strings.Join(in.Scopes, " ")},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
		"state":                 {randomState()},
	}
	if in.Resource != "" {
		q.Set("resource", in.Resource)
	}
	authID, executionID, err := c.authorize(ctx, issuer+"/oauth2/authorize?"+q.Encode())
	if err != nil {
		return Token{}, err
	}

	// 2. open the view: it names the credentials action and issues the
	//    challenge token the next step must echo.
	view, err := c.execute(ctx, issuer, map[string]any{"executionId": executionID, "inputs": map[string]any{}, "verbose": true})
	if err != nil {
		return Token{}, fmt.Errorf("thunderflow: open sign-in view: %w", err)
	}
	if !view.offersAction(credentialsAction) {
		return Token{}, fmt.Errorf("thunderflow: sign-in view offers no %q action", credentialsAction)
	}

	// 3. credentials. `action`, not `actionRef`; authId absent on purpose.
	body := map[string]any{
		"executionId": view.ExecutionID, "action": credentialsAction,
		"inputs":  map[string]any{"username": in.Username, "password": in.Password},
		"verbose": true,
	}
	if view.ChallengeToken != "" {
		body["challengeToken"] = view.ChallengeToken
	}
	done, err := c.execute(ctx, issuer, body)
	if err != nil {
		return Token{}, fmt.Errorf("thunderflow: submit credentials: %w", err)
	}
	switch {
	case done.FlowStatus == "COMPLETE" && done.Assertion != "":
	case done.FlowStatus == "ERROR":
		return Token{}, fmt.Errorf("thunderflow: %w: %s", ErrRefused, done.reason())
	default:
		// The view came back. That is the issuer's only answer to bad
		// credentials, and retrying it is how a caller loops forever.
		return Token{}, ErrRefused
	}

	// 4. the assertion + authId become the authorization code.
	code, err := c.callback(ctx, issuer, done.Assertion, authID)
	if err != nil {
		return Token{}, err
	}

	// 5. code → token, as the public client, with the verifier and resource.
	form := url.Values{
		"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {in.RedirectURI},
		"client_id": {in.ClientID}, "code_verifier": {verifier},
	}
	if in.Resource != "" {
		form.Set("resource", in.Resource)
	}
	return c.token(ctx, issuer, form)
}

// -- steps --------------------------------------------------------------------

func (c *client) authorize(ctx context.Context, u string) (authID, executionID string, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", "", err
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("thunderflow: authorize: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	loc, _ := url.Parse(resp.Header.Get("Location"))
	if resp.StatusCode != http.StatusFound || loc == nil {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", "", fmt.Errorf("thunderflow: authorize returned %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	qs := loc.Query()
	if e := qs.Get("errorCode"); e != "" || strings.Contains(loc.Path, "/gate/error") {
		return "", "", fmt.Errorf("thunderflow: authorize refused: %s %s", qs.Get("errorCode"), qs.Get("errorMessage"))
	}
	authID, executionID = qs.Get("authId"), qs.Get("executionId")
	if authID == "" || executionID == "" {
		return "", "", errors.New("thunderflow: authorize redirect carries no authId/executionId")
	}
	return authID, executionID, nil
}

// flowResponse is the subset of /flow/execute's answer the sequence reads.
type flowResponse struct {
	ExecutionID    string `json:"executionId"`
	FlowStatus     string `json:"flowStatus"`
	Type           string `json:"type"`
	ChallengeToken string `json:"challengeToken"`
	Assertion      string `json:"assertion"`
	FailureReason  string `json:"failureReason"`
	Data           struct {
		Actions []struct {
			Ref string `json:"ref"`
		} `json:"actions"`
	} `json:"data"`
}

func (f flowResponse) offersAction(ref string) bool {
	for _, a := range f.Data.Actions {
		if a.Ref == ref {
			return true
		}
	}
	return false
}

func (f flowResponse) reason() string {
	if f.FailureReason != "" {
		return f.FailureReason
	}
	return "no reason given"
}

func (c *client) execute(ctx context.Context, issuer string, body map[string]any) (flowResponse, error) {
	var out flowResponse
	if err := c.postJSON(ctx, issuer+"/flow/execute", body, &out); err != nil {
		return out, err
	}
	return out, nil
}

func (c *client) callback(ctx context.Context, issuer, assertion, authID string) (string, error) {
	var out struct {
		RedirectURI string `json:"redirect_uri"`
	}
	if err := c.postJSON(ctx, issuer+"/oauth2/auth/callback", map[string]any{"assertion": assertion, "authId": authID}, &out); err != nil {
		return "", fmt.Errorf("thunderflow: auth callback: %w", err)
	}
	u, err := url.Parse(out.RedirectURI)
	if err != nil || u.Query().Get("code") == "" {
		return "", errors.New("thunderflow: auth callback returned no code")
	}
	return u.Query().Get("code"), nil
}

func (c *client) token(ctx context.Context, issuer string, form url.Values) (Token, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, issuer+"/oauth2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return Token{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.hc.Do(req)
	if err != nil {
		return Token{}, fmt.Errorf("thunderflow: token: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	var out struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
		Scope       string `json:"scope"`
		Error       string `json:"error"`
		Description string `json:"error_description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return Token{}, fmt.Errorf("thunderflow: token decode: %w", err)
	}
	if resp.StatusCode != http.StatusOK || out.AccessToken == "" {
		return Token{}, fmt.Errorf("thunderflow: token refused (%d): %s %s", resp.StatusCode, out.Error, out.Description)
	}
	return Token{AccessToken: out.AccessToken, ExpiresIn: out.ExpiresIn, Scope: out.Scope}, nil
}

func (c *client) postJSON(ctx context.Context, u string, body any, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := c.hc.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("%d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// -- PKCE -----------------------------------------------------------------------

func pkce() (verifier, challenge string, err error) {
	buf := make([]byte, 40)
	if _, err := rand.Read(buf); err != nil {
		return "", "", fmt.Errorf("thunderflow: pkce: %w", err)
	}
	verifier = base64.RawURLEncoding.EncodeToString(buf)
	sum := sha256.Sum256([]byte(verifier))
	return verifier, base64.RawURLEncoding.EncodeToString(sum[:]), nil
}

func randomState() string {
	buf := make([]byte, 12)
	_, _ = rand.Read(buf)
	return base64.RawURLEncoding.EncodeToString(buf)
}
