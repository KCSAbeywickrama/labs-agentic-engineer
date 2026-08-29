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

// Package thunderapp GETs aep.wso2.com/v1alpha1 ThunderApplication CRs from
// the Kubernetes API. Plain net/http — no controller-runtime, no
// internal/clients/k8s. Not imported by delivery/validation (validation never
// mints from Thunder CR status; deploy-wait alone reads this CR).
package thunderapp

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/httpx"
	"github.com/wso2/aep/aep-api/internal/clients/requests"
)

const apiPathFmt = "/apis/aep.wso2.com/v1alpha1/namespaces/%s/thunderapplications/%s"

// Application is the deploy-wait projection of one ThunderApplication CR.
// Kept in this package so clients do not import projects (arch: clients ⊥ domains).
type Application struct {
	RedirectURIs       string
	Ready              bool
	Generation         int64
	ObservedGeneration int64
}

// Config wires the Kubernetes API endpoint the client GETs against.
type Config struct {
	BaseURL     string
	BearerToken string
	// CAFile is the in-cluster service-account CA (optional). Empty leaves
	// system roots; tests inject HTTPClient with the httptest cert pool.
	CAFile string
	// HTTPClient overrides the default transport (tests). When nil, New
	// builds one from CAFile + httpx correlation wrap + retry.
	HTTPClient *http.Client
}

// Client GETs one ThunderApplication by namespace/name.
type Client struct {
	baseURL string
	bearer  string
	http    *requests.RetryableHTTPClient
}

// New builds a Client. BaseURL is required; callers that cannot resolve a
// kube API base leave the reader nil instead of calling New.
func New(cfg Config) *Client {
	if cfg.BaseURL == "" {
		panic("thunderapp: Config.BaseURL is required")
	}
	inner := cfg.HTTPClient
	if inner == nil {
		inner = &http.Client{Transport: httpx.WrapTransport(tlsTransport(cfg.CAFile))}
	} else if inner.Transport == nil {
		inner.Transport = httpx.WrapTransport(nil)
	}
	return &Client{
		baseURL: strings.TrimRight(cfg.BaseURL, "/"),
		bearer:  cfg.BearerToken,
		// One retry with short backoff: DeploymentState already polls; a hard
		// 5xx should surface for activity retry rather than stall the poll.
		http: requests.NewRetryableHTTPClient(inner, requests.RequestRetryConfig{
			RetryAttemptsMax: 1,
			RetryWaitMin:     10 * time.Millisecond,
			RetryWaitMax:     50 * time.Millisecond,
		}),
	}
}

// Get fetches one ThunderApplication. (nil, nil) means the CR is not in the
// cluster yet (404). Non-2xx other than 404 is an error.
func (c *Client) Get(ctx context.Context, namespace, name string) (*Application, error) {
	if c == nil {
		return nil, fmt.Errorf("thunderapp: nil client")
	}
	path := fmt.Sprintf(apiPathFmt, namespace, name)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("thunderapp: build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if c.bearer != "" {
		req.Header.Set("Authorization", "Bearer "+c.bearer)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("thunderapp: GET %s: %w", path, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("thunderapp: GET %s → %d: %s", path, resp.StatusCode, string(raw))
	}
	var cr thunderCR
	if err := json.Unmarshal(raw, &cr); err != nil {
		return nil, fmt.Errorf("thunderapp: decode %s: %w", path, err)
	}
	return &Application{
		RedirectURIs:       cr.Spec.RedirectURIs,
		Ready:              cr.Status.Ready,
		Generation:         cr.Metadata.Generation,
		ObservedGeneration: cr.Status.ObservedGeneration,
	}, nil
}

type thunderCR struct {
	Metadata struct {
		Generation int64 `json:"generation"`
	} `json:"metadata"`
	Spec struct {
		RedirectURIs string `json:"redirectUris"`
	} `json:"spec"`
	Status struct {
		Ready              bool  `json:"ready"`
		ObservedGeneration int64 `json:"observedGeneration"`
	} `json:"status"`
}

func tlsTransport(caFile string) http.RoundTripper {
	if caFile == "" {
		return nil
	}
	pem, err := os.ReadFile(caFile)
	if err != nil || len(pem) == 0 {
		return nil
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return nil
	}
	return &http.Transport{
		TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
	}
}
