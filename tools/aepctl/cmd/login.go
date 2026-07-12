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

package cmd

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

const cliClientID = "aep-cli-client"

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate with Thunder OIDC and store a JWT",
	Long: `Opens your browser for a Thunder OIDC PKCE login flow.
On success the access token is saved to ~/.aep/config.yaml and used
automatically by all subsequent aep commands.

Requires that the Thunder URL has been set:
  aep connect --server <url> --thunder-url <thunder-url>`,
	RunE: runLogin,
}

func init() {
	rootCmd.AddCommand(loginCmd)
}

func runLogin(cmd *cobra.Command, args []string) error {
	thunderURL := viper.GetString("thunder_url")
	if thunderURL == "" {
		return fmt.Errorf("thunder URL not configured — run `aep connect --server <url> --thunder-url <url>` first")
	}
	thunderURL = strings.TrimRight(thunderURL, "/")

	// Discover OIDC endpoints.
	authURL, tokenURL, err := discoverOIDC(thunderURL)
	if err != nil {
		return fmt.Errorf("OIDC discovery: %w", err)
	}

	// PKCE.
	verifier, challenge, err := generatePKCE()
	if err != nil {
		return fmt.Errorf("generate PKCE: %w", err)
	}
	state, err := randomState()
	if err != nil {
		return fmt.Errorf("generate state: %w", err)
	}

	// Start a one-shot local callback server on a random port.
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("start callback server: %w", err)
	}
	port := lis.Addr().(*net.TCPAddr).Port
	redirectURI := fmt.Sprintf("http://127.0.0.1:%d/callback", port)

	codeCh := make(chan string, 1)
	errCh := make(chan error, 1)

	mux := http.NewServeMux()
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if got := q.Get("state"); got != state {
			errCh <- fmt.Errorf("state mismatch: got %q", got)
			http.Error(w, "state mismatch", http.StatusBadRequest)
			return
		}
		code := q.Get("code")
		if code == "" {
			errCh <- fmt.Errorf("no code in callback: %s", r.URL.RawQuery)
			http.Error(w, "no code", http.StatusBadRequest)
			return
		}
		_, _ = fmt.Fprint(w, "<html><body><h2>Login successful — you may close this tab.</h2></body></html>")
		codeCh <- code
	})

	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 30 * time.Second}
	go func() { _ = srv.Serve(lis) }()
	defer func() { _ = srv.Close() }()

	// Build and open the authorization URL.
	params := url.Values{
		"response_type":         {"code"},
		"client_id":             {cliClientID},
		"redirect_uri":          {redirectURI},
		"scope":                 {"openid profile email"},
		"state":                 {state},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
	}
	loginURL := authURL + "?" + params.Encode()

	_, _ = fmt.Fprintf(os.Stdout, "Opening browser for login...\n%s\n", loginURL)
	openBrowser(loginURL)

	// Wait for the callback.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	var code string
	select {
	case code = <-codeCh:
	case e := <-errCh:
		return e
	case <-ctx.Done():
		return fmt.Errorf("login timed out after 5 minutes")
	}

	// Exchange the code for tokens.
	token, err := exchangeCode(tokenURL, cliClientID, code, verifier, redirectURI)
	if err != nil {
		return fmt.Errorf("token exchange: %w", err)
	}

	// Persist token to config.
	viper.Set("token", token)
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("resolve home dir: %w", err)
	}
	cfgPath := filepath.Join(home, ".aep", "config.yaml")
	if err := viper.WriteConfigAs(cfgPath); err != nil {
		return fmt.Errorf("save token: %w", err)
	}

	_, _ = fmt.Fprintln(os.Stdout, "Login successful. Token saved to ~/.aep/config.yaml")
	return nil
}

func discoverOIDC(thunderURL string) (authURL, tokenURL string, err error) {
	resp, err := http.Get(thunderURL + "/.well-known/openid-configuration")
	if err != nil {
		return "", "", fmt.Errorf("fetch OIDC discovery: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	var doc struct {
		AuthorizationEndpoint string `json:"authorization_endpoint"`
		TokenEndpoint         string `json:"token_endpoint"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return "", "", fmt.Errorf("decode discovery doc: %w", err)
	}
	if doc.AuthorizationEndpoint == "" || doc.TokenEndpoint == "" {
		return "", "", fmt.Errorf("discovery doc missing required endpoints")
	}
	return doc.AuthorizationEndpoint, doc.TokenEndpoint, nil
}

func exchangeCode(tokenURL, clientID, code, verifier, redirectURI string) (string, error) {
	resp, err := http.PostForm(tokenURL, url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {clientID},
		"code":          {code},
		"code_verifier": {verifier},
		"redirect_uri":  {redirectURI},
	})
	if err != nil {
		return "", fmt.Errorf("POST token endpoint: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	var tok struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
		ErrorDesc   string `json:"error_description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return "", fmt.Errorf("decode token response: %w", err)
	}
	if tok.Error != "" {
		return "", fmt.Errorf("%s: %s", tok.Error, tok.ErrorDesc)
	}
	if tok.AccessToken == "" {
		return "", fmt.Errorf("token response missing access_token")
	}
	return tok.AccessToken, nil
}

func generatePKCE() (verifier, challenge string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return
	}
	verifier = base64.RawURLEncoding.EncodeToString(b)
	h := sha256.Sum256([]byte(verifier))
	challenge = base64.RawURLEncoding.EncodeToString(h[:])
	return
}

func randomState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func openBrowser(u string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", u)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
	default:
		cmd = exec.Command("xdg-open", u)
	}
	_ = cmd.Start()
}
