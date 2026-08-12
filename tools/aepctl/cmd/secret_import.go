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
	"os/exec"
	"strings"

	"github.com/spf13/cobra"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	k8s "github.com/wso2/aep/aepctl/internal/kubernetes"
)

const (
	openbaoNamespace     = "openbao"
	openbaoPodLabelMatch = "app.kubernetes.io/name=openbao,component=server"
)

var secretImportCmd = &cobra.Command{
	Use:   "import",
	Short: "Import secrets into OpenBao",
	RunE:  runSecretImport,
}

func init() {
	secretCmd.AddCommand(secretImportCmd)
}

func runSecretImport(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	client, err := k8s.NewClient(kubeconfig)
	if err != nil {
		return fmt.Errorf("connect to cluster: %w", err)
	}

	pods, err := client.CoreV1().Pods(openbaoNamespace).List(ctx, metav1.ListOptions{
		LabelSelector: openbaoPodLabelMatch,
	})
	if err != nil {
		return fmt.Errorf("list openbao pods: %w", err)
	}
	if len(pods.Items) == 0 {
		return fmt.Errorf("no pod matching %q found in namespace %q", openbaoPodLabelMatch, openbaoNamespace)
	}
	pod := pods.Items[0].Name

	secrets, err := getBaoSecretsList(ctx, pod)
	if err != nil {
		return err
	}

	if !strings.Contains(secrets, "kv") {
		return fmt.Errorf("failed to store key value secrets: no kv secrets engine found in OpenBao. Enable manually with 'bao secrets enable -path=secret kv-v2'")
	}

	fmt.Println(secrets)

	result, err := seedBaoSecret(ctx, pod, "secret/aepctl-test", "aepctl-secret-import-test", "ok")
	if err != nil {
		return err
	}

	fmt.Println(result)
	return nil
}

// getBaoSecretsList runs `bao secrets list` inside the given OpenBao pod and
// returns its combined output.
func getBaoSecretsList(ctx context.Context, pod string) (string, error) {
	kubectlArgs := []string{
		"exec",
		"-n", openbaoNamespace,
		pod,
		"--",
		"bao",
		"secrets",
		"list",
	}

	if kubeconfig != "" {
		kubectlArgs = append([]string{"--kubeconfig", kubeconfig}, kubectlArgs...)
	}

	execCmd := exec.CommandContext(ctx, "kubectl", kubectlArgs...)

	output, err := execCmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to execute bao secrets list: %w: %s", err, output)
	}

	return string(output), nil
}

// seedBaoSecret writes a single key/value pair to the given path in OpenBao's
// kv secrets engine (bao kv put <path> <key>=<value>) inside the given pod.
func seedBaoSecret(ctx context.Context, pod, path, key, value string) (string, error) {
	kubectlArgs := []string{
		"exec",
		"-n", openbaoNamespace,
		pod,
		"--",
		"bao",
		"kv",
		"put",
		path,
		fmt.Sprintf("%s=%s", key, value),
	}

	if kubeconfig != "" {
		kubectlArgs = append([]string{"--kubeconfig", kubeconfig}, kubectlArgs...)
	}

	execCmd := exec.CommandContext(ctx, "kubectl", kubectlArgs...)

	output, err := execCmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to seed secret at %s: %w: %s", path, err, output)
	}

	return string(output), nil
}
