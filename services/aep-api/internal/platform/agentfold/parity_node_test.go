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

package agentfold

// Live-node parity check: when node and the workspace's npm yaml install are
// available, regenerate the whole yamlemit table by actually RUNNING npm
// yaml's stringify and compare the Go emitter against that fresh output (so a
// bumped yaml dependency or a stale committed fixture cannot hide drift).
// Skipped cleanly on machines without node or without the JS workspace.

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestParity_LiveNodeYamlStringify(t *testing.T) {
	if testing.Short() {
		t.Skip("live node parity skipped in -short")
	}
	nodeBin, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}
	yamlPkg := filepath.Join("..", "..", "..", "..", "..", "packages", "agent-stream", "node_modules", "yaml")
	if _, err := os.Stat(yamlPkg); err != nil {
		t.Skip("workspace npm yaml install not present (pnpm install to enable)")
	}
	gen, err := filepath.Abs(filepath.Join("testdata", "gen", "gen-yamlemit.mjs"))
	if err != nil {
		t.Fatal(err)
	}

	out := filepath.Join(t.TempDir(), "yamlemit_live.json")
	cmd := exec.Command(nodeBin, gen)
	cmd.Env = append(os.Environ(), "OUT="+out)
	if raw, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("generator failed: %v\n%s", err, raw)
	}
	runEmitCases(t, loadEmitCases(t, out))
}
