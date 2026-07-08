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
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/wso2/aep/aepctl/internal/adminpb"
)

var openbaoUnsealCmd = &cobra.Command{
	Use:   "unseal",
	Short: "Unseal the AEP OpenBao instance after a pod restart",
	Long: `Prompts for 3 of the 5 unseal keys printed during aep init
and sends them to the AEP server which unseals OpenBao in-cluster.

Run this whenever the OpenBao pod restarts — OpenBao starts sealed after
every restart and cannot serve secrets until unsealed.`,
	RunE: runOpenbaoUnseal,
}

func init() {
	openbaoCmd.AddCommand(openbaoUnsealCmd)
}

func runOpenbaoUnseal(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	fmt.Fprintln(os.Stdout, "Enter 3 unseal keys (input is hidden):")
	keys := make([]string, 0, 3)
	for i := 1; i <= 3; i++ {
		key, err := readMaskedInput(fmt.Sprintf("Unseal key (%d/3)", i))
		if err != nil {
			return fmt.Errorf("read unseal key: %w", err)
		}
		if key == "" {
			return fmt.Errorf("unseal key %d must not be empty", i)
		}
		keys = append(keys, key)
	}

	client, ctx, close, err := dialServer(ctx)
	if err != nil {
		return err
	}
	defer close()

	resp, err := client.OpenbaoUnseal(ctx, &adminpb.UnsealRequest{Keys: keys})
	if err != nil {
		return fmt.Errorf("call OpenbaoUnseal: %w", err)
	}

	if resp.Success {
		fmt.Fprintf(os.Stdout, "✓ %s\n", resp.Message)
	} else {
		fmt.Fprintf(os.Stderr, "✗ %s\n", resp.Message)
		os.Exit(1)
	}
	return nil
}
