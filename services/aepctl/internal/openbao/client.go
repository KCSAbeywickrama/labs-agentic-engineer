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

package openbao

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"time"
)

const LocalPort = "18200"

// PortForward starts kubectl port-forward to pod/<release>-0 in the background.
// Caller must kill the returned process when done.
func PortForward(ctx context.Context, namespace, release, kubeconfig string) (*exec.Cmd, error) {
	args := []string{"port-forward", "-n", namespace, "pod/" + release + "-0", LocalPort + ":8200"}
	if kubeconfig != "" {
		args = append([]string{"--kubeconfig", kubeconfig}, args...)
	}
	cmd := exec.CommandContext(ctx, "kubectl", args...)
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start port-forward to OpenBao: %w", err)
	}
	return cmd, nil
}

// WaitForReachable retries the health endpoint until OpenBao responds or timeout expires.
// Any HTTP response (including sealed/uninitialised status codes) counts as reachable.
func WaitForReachable(ctx context.Context, baseURL string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 3 * time.Second}
	for {
		resp, err := client.Get(baseURL + "/v1/sys/health")
		if err == nil {
			resp.Body.Close()
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("OpenBao at %s not reachable after %s: %w", baseURL, timeout, err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

// Req executes an authenticated HTTP request against the OpenBao API.
// Returns the decoded JSON body, HTTP status code, and any transport-level error.
func Req(ctx context.Context, method, baseURL, token, path string, body interface{}) (map[string]interface{}, int, error) {
	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, 0, fmt.Errorf("marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, baseURL+path, bodyReader)
	if err != nil {
		return nil, 0, err
	}
	if token != "" {
		req.Header.Set("X-Vault-Token", token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	return result, resp.StatusCode, nil
}

// Must calls Req and returns an error if the status code indicates failure.
func Must(ctx context.Context, method, baseURL, token, path string, body interface{}) (map[string]interface{}, error) {
	result, status, err := Req(ctx, method, baseURL, token, path, body)
	if err != nil {
		return nil, err
	}
	if status >= 300 {
		return nil, fmt.Errorf("OpenBao %s %s returned %d: %v", method, path, status, result)
	}
	return result, nil
}
