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
	"encoding/json"
	"fmt"
)

// AEPClientSecrets holds the OAuth client secrets for all AEP-managed Thunder clients.
type AEPClientSecrets struct {
	OcWorkloadPublisher string
	OcObserverReader    string
	AepApiClient        string
	BffGitService       string
	BffRemoteWorker     string
	LocalDevSeeder      string
	AepSystemClient     string
	OcRcaAgent          string
}

// RegisterAEPClients registers (or updates) all AEP OAuth clients in Thunder.
// It upserts confidential service-to-service clients, the console PKCE client,
// and the CLI PKCE client, then assigns the Administrator role to aep-system-client
// on a best-effort basis.
func RegisterAEPClients(ctx context.Context, c *ThunderClient, secrets AEPClientSecrets, consoleURL string, progress func(string)) error {
	ouID, err := c.GetDefaultOU(ctx, "default")
	if err != nil {
		return err
	}

	authFlowID, err := c.GetAuthFlowID(ctx, "default-basic-flow")
	if err != nil {
		return err
	}

	apps, err := c.ListApps(ctx)
	if err != nil {
		return err
	}

	confidential := func(name, desc, clientID, secret string) error {
		progress("  registering " + clientID + "...")
		return c.UpsertApp(ctx, apps, clientID, map[string]interface{}{
			"name":        name,
			"description": desc,
			"ouId":        ouID,
			"inboundAuthConfig": []interface{}{
				map[string]interface{}{
					"type": "oauth2",
					"config": map[string]interface{}{
						"clientId":                clientID,
						"clientSecret":            secret,
						"grantTypes":              []string{"client_credentials"},
						"tokenEndpointAuthMethod": "client_secret_post",
						"pkceRequired":            false,
						"publicClient":            false,
						"token": map[string]interface{}{
							"accessToken": map[string]interface{}{"validityPeriod": 3600},
						},
					},
				},
			},
		})
	}

	clients := []struct{ name, desc, id, secret string }{
		{"Workload Publisher", "OC Workload Publisher Client", "openchoreo-workload-publisher-client", secrets.OcWorkloadPublisher},
		{"OpenChoreo Observer Resource Reader", "BFF token for OC Observer service", "openchoreo-observer-resource-reader-client", secrets.OcObserverReader},
		{"AEP API Service", "AEP API service-to-service client", "aep-api-client", secrets.AepApiClient},
		{"AEP BFF to git-service", "BFF outbound JWT, audience: git-service", "aep-bff-to-git-service", secrets.BffGitService},
		{"AEP BFF to remote-worker", "BFF outbound JWT, audience: remote-worker", "aep-bff-to-remote-worker", secrets.BffRemoteWorker},
		{"AEP Local Dev Seeder", "Local-dev convenience client", "aep-local-dev-seeder", secrets.LocalDevSeeder},
		{"AEP System Client", "System-level Thunder admin client", "aep-system-client", secrets.AepSystemClient},
		{"OpenChoreo RCA Agent", "SRE/RCA agent service-account identity", "openchoreo-rca-agent", secrets.OcRcaAgent},
	}
	for _, cl := range clients {
		if err := confidential(cl.name, cl.desc, cl.id, cl.secret); err != nil {
			return err
		}
	}

	userAttrs := []interface{}{"given_name", "family_name", "username", "groups", "ouId", "ouName", "ouHandle"}

	progress("  registering aep-console-client...")
	if err := c.UpsertApp(ctx, apps, "aep-console-client", map[string]interface{}{
		"name":        "AEP Console",
		"description": "AEP Platform Console",
		"ouId":        ouID,
		"authFlowId":  authFlowID,
		"inboundAuthConfig": []interface{}{
			map[string]interface{}{
				"type": "oauth2",
				"config": map[string]interface{}{
					"clientId":                "aep-console-client",
					"redirectUris":            []string{consoleURL, consoleURL + "/", consoleURL + "/callback"},
					"grantTypes":              []string{"authorization_code", "refresh_token"},
					"responseTypes":           []string{"code"},
					"tokenEndpointAuthMethod": "none",
					"pkceRequired":            true,
					"publicClient":            true,
					"token": map[string]interface{}{
						"accessToken": map[string]interface{}{
							"validityPeriod": 86400,
							"userAttributes": userAttrs,
						},
						"idToken": map[string]interface{}{
							"validityPeriod": 86400,
							"userAttributes": userAttrs,
						},
					},
				},
			},
		},
	}); err != nil {
		return err
	}

	progress("  registering aep-cli-client...")
	if err := c.UpsertApp(ctx, apps, "aep-cli-client", map[string]interface{}{
		"name":        "AEP CLI",
		"description": "AEP CLI tool — PKCE login",
		"ouId":        ouID,
		"authFlowId":  authFlowID,
		"inboundAuthConfig": []interface{}{
			map[string]interface{}{
				"type": "oauth2",
				"config": map[string]interface{}{
					"clientId":                "aep-cli-client",
					"redirectUris":            []string{"http://localhost", "http://127.0.0.1"},
					"grantTypes":              []string{"authorization_code", "refresh_token"},
					"responseTypes":           []string{"code"},
					"tokenEndpointAuthMethod": "none",
					"pkceRequired":            true,
					"publicClient":            true,
					"token": map[string]interface{}{
						"accessToken": map[string]interface{}{"validityPeriod": 86400},
					},
				},
			},
		},
	}); err != nil {
		return err
	}

	// Re-list apps after all upserts so EnsureSystemRole sees newly created apps.
	freshApps, err := c.ListApps(ctx)
	if err != nil {
		return err
	}
	// Best-effort: grant aep-system-client the Thunder system permission via
	// role creation with inline assignment (the only working path on Thunder 0.34).
	_ = c.EnsureSystemRole(ctx, ouID, "aep-system-client", freshApps)

	return nil
}

// EnsureSystemRole creates the "aep-system" role with the Thunder system permission
// assigned to systemClientID, if it does not already exist.
// Uses inline assignment at role-creation time (POST /roles with assignments field)
// because POST /roles/{id}/assignments/add is broken on Thunder 0.34 (ROL-5000).
func (c *ThunderClient) EnsureSystemRole(ctx context.Context, ouID, systemClientID string, apps map[string]string) error {
	// Check if the role already exists.
	rolesBody, err := c.get(ctx, "/roles")
	if err != nil {
		return fmt.Errorf("list roles: %w", err)
	}
	var rolesRaw interface{}
	if err := json.Unmarshal(rolesBody, &rolesRaw); err != nil {
		return fmt.Errorf("parse roles: %w", err)
	}
	for _, item := range toSlice(rolesRaw) {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		if m["name"] == "aep-system" {
			return nil // already exists
		}
	}

	// Find the "system" resource server.
	rsBody, err := c.get(ctx, "/resource-servers")
	if err != nil {
		return fmt.Errorf("list resource-servers: %w", err)
	}
	var rsRaw interface{}
	if err := json.Unmarshal(rsBody, &rsRaw); err != nil {
		return fmt.Errorf("parse resource-servers: %w", err)
	}
	sysRSID := ""
	for _, item := range toSlice(rsRaw) {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		if m["identifier"] == "system" {
			sysRSID, _ = m["id"].(string)
			break
		}
	}
	if sysRSID == "" {
		return fmt.Errorf("could not find resource-server with identifier=system")
	}

	appID, ok := apps[systemClientID]
	if !ok {
		return fmt.Errorf("app %q not found in applications list", systemClientID)
	}

	payload, err := json.Marshal(map[string]interface{}{
		"name":        "aep-system",
		"description": "Grants aep-system-client the Thunder 'system' permission (thunder-app operator).",
		"ouId":        ouID,
		"permissions": []interface{}{
			map[string]interface{}{
				"resourceServerId": sysRSID,
				"permissions":      []string{"system"},
			},
		},
		"assignments": []interface{}{
			map[string]interface{}{
				"id":   appID,
				"type": "app",
			},
		},
	})
	if err != nil {
		return fmt.Errorf("marshal role payload: %w", err)
	}

	if _, err := c.request(ctx, "POST", "/roles", payload); err != nil {
		return fmt.Errorf("create aep-system role: %w", err)
	}
	return nil
}
