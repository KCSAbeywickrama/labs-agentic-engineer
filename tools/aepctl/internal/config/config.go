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

package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/viper"
)

func Init() {
	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error resolving home dir:", err)
		os.Exit(1)
	}

	cfgDir := filepath.Join(home, ".aep")
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(cfgDir)
	viper.AddConfigPath(".")

	viper.SetEnvPrefix("AEP")
	viper.AutomaticEnv()

	// Platform install defaults — overridable via ~/.aep/config.yaml.
	// platform.workspaces.access_mode: PVC access mode for the shared git workspaces volume.
	// Use ReadWriteOnce for local k3d (local-path does not support ReadWriteMany).
	// Use ReadWriteMany in production with NFS/EFS/CephFS.
	// Empty string means use the chart default (ReadWriteMany).
	viper.SetDefault("platform.workspaces.access_mode", "")

	// OpenChoreo platform API defaults — overridable via ~/.aep/config.yaml.
	viper.SetDefault("oc.api_url", "http://openchoreo-api.openchoreo-control-plane.svc.cluster.local:8080")

	// Thunder defaults — all overridable via ~/.aep/config.yaml or AEP_THUNDER_* env vars.
	viper.SetDefault("thunder.namespace", "thunder")
	viper.SetDefault("thunder.url", "http://thunder-service.thunder.svc.cluster.local:8090")
	viper.SetDefault("thunder.config_map", "thunder-config-map")
	viper.SetDefault("thunder.deployment", "thunder-deployment")
	viper.SetDefault("thunder.admin_client_id", "openchoreo-system-app")
	viper.SetDefault("thunder.admin_client_secret", "openchoreo-system-app-secret")
	viper.SetDefault("thunder.public_url", "http://thunder.openchoreo.localhost:8080")

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			fmt.Fprintln(os.Stderr, "error reading config:", err)
		}
	}
}
