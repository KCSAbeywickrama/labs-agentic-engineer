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

	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	k8s "github.com/wso2/aep/aepctl/internal/kubernetes"
)

var setupAEPNamespace string
var setupConsoleURL string

var thunderSetupCmd = &cobra.Command{
	Use:   "setup",
	Short: "Register AEP OAuth clients in Thunder",
	Long: `Registers all AEP OAuth clients in Thunder and patches its CORS config.

Thunder connection details are read from ~/.aep/config.yaml.
Any value can be overridden with a flag (flag > config file > default).`,
	RunE: runThunderSetup,
}

func init() {
	thunderCmd.AddCommand(thunderSetupCmd)
	thunderSetupCmd.Flags().StringVar(&setupAEPNamespace, "namespace", "wso2-aep", "Namespace where AEP is installed")
	thunderSetupCmd.Flags().StringVar(&setupConsoleURL, "console-url", "http://console.openchoreo.localhost:8080", "Public URL of the AEP console")
	registerThunderFlags(thunderSetupCmd)
}

func runThunderSetup(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	client, err := k8s.NewClient("")
	if err != nil {
		return err
	}

	return doThunderSetup(ctx, client, setupAEPNamespace,
		viper.GetString("thunder.namespace"),
		viper.GetString("thunder.url"),
		viper.GetString("thunder.config_map"),
		viper.GetString("thunder.deployment"),
		viper.GetString("thunder.admin_client_id"),
		setupConsoleURL,
	)
}
