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

package thunder

import (
	"context"
	"fmt"
	"net/http"
	"os/exec"
	"time"
)

const (
	// LocalPort is the local port used by kubectl port-forward to reach Thunder.
	LocalPort = "18090"
	// remotePort is Thunder's admin service port inside the cluster.
	remotePort = "8090"
)

// PortForward starts kubectl port-forward to svc/thunder-service in the given
// namespace in the background. Caller must kill the returned process when done.
func PortForward(ctx context.Context, namespace, kubeconfig string) (*exec.Cmd, error) {
	args := []string{
		"port-forward",
		"-n", namespace,
		"svc/thunder-service",
		LocalPort + ":" + remotePort,
	}
	if kubeconfig != "" {
		args = append([]string{"--kubeconfig", kubeconfig}, args...)
	}
	cmd := exec.CommandContext(ctx, "kubectl", args...)
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start port-forward to Thunder: %w", err)
	}
	return cmd, nil
}

// WaitForReachable retries GET /oauth2/jwks until Thunder responds (any HTTP
// status) or timeout expires. A 4xx is still a successful response from the
// network perspective — it means Thunder is up.
func WaitForReachable(ctx context.Context, baseURL string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 3 * time.Second}
	for {
		resp, err := client.Get(baseURL + "/oauth2/jwks")
		if err == nil {
			_ = resp.Body.Close()
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("Thunder at %s not reachable after %s: %w", baseURL, timeout, err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}
