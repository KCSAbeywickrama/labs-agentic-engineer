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

// Command openapigen writes the code-first OpenAPI documents to build/ (gitignored)
// for offline tooling — client codegen, portal upload, diffing. It is NOT a
// source of truth and has no drift guard: the live spec at GET /openapi.yaml is
// authoritative. Run via `make openapi`. Same code path as the live route.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/wso2/aep/aep-api/api"
)

func main() {
	const dir = "build"
	if err := os.MkdirAll(dir, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "mkdir", dir+":", err)
		os.Exit(1)
	}
	specs := []struct {
		name string
		gen  func() ([]byte, error)
	}{
		{"openapi.yaml", api.GenerateOpenAPIYAML},
		{"internal-openapi.yaml", api.GenerateInternalOpenAPIYAML},
	}
	for _, s := range specs {
		path := filepath.Join(dir, s.name)
		b, err := s.gen()
		if err != nil {
			fmt.Fprintln(os.Stderr, "generate", path+":", err)
			os.Exit(1)
		}
		if err := os.WriteFile(path, b, 0o644); err != nil { //nolint:gosec
			fmt.Fprintln(os.Stderr, "write", path+":", err)
			os.Exit(1)
		}
		fmt.Printf("wrote %s (%d bytes)\n", path, len(b))
	}
}
