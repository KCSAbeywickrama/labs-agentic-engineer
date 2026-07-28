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

package main

import (
	"fmt"
	"log/slog"
	"os"

	"github.com/wso2/aep/aep-api/app"
	"github.com/wso2/aep/aep-api/internal/clients/oauth"
	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/config"
)

// main is the OSS process entry point: load+validate config, wire direct-OC
// Options (M2M AuthProvider when configured, DirectOCStrategy, no impersonation),
// then hand process lifecycle to app.Run. All service-graph wiring lives in
// internal/app.Assemble so it is reachable from a test with faked deps.
func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load config: %v\n", err)
		os.Exit(1)
	}

	var authProvider openchoreo.AuthProvider
	if cfg.ServiceAuth.TokenURL != "" && cfg.ServiceAuth.ClientID != "" {
		authProvider = oauth.NewTokenProvider(
			cfg.ServiceAuth.TokenURL,
			cfg.ServiceAuth.ClientID,
			cfg.ServiceAuth.ClientSecret,
			cfg.ServiceAuth.HostHeader,
		)
	}

	if err := app.Run(cfg, app.Options{
		AuthProvider:           authProvider,
		RequestAuthStrategy:    app.DirectOCStrategy{}, // all-M2M
		ImpersonateOrgResolver: nil,                    // no X-Impersonate-Org
	}); err != nil {
		slog.Error("aep-api exited", "error", err)
		os.Exit(1)
	}
}
