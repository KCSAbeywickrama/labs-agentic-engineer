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

// Command openapigen writes the code-first OpenAPI documents. Same code path
// as the live GET /openapi.yaml routes. Run via `make openapi` (wired into the
// root `make gen`); paths are relative to services/aep-api.
//
//   - The PUBLIC spec (/api/v1) goes to packages/contracts/api/v1/openapi.yaml
//     and is COMMITTED — it is the published contract consumers codegen from.
//     `make openapi-check` fails if the committed copy drifts from the code.
//   - The INTERNAL (S2S) spec goes to build/ (gitignored) — offline tooling
//     only, not a published contract.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/wso2/aep/aep-api/internal/api"
)

func main() {
	specs := []struct {
		path string
		gen  func() ([]byte, error)
	}{
		{filepath.Join("..", "..", "packages", "contracts", "api", "v1", "openapi.yaml"), api.GenerateOpenAPIYAML},
		{filepath.Join("build", "internal-openapi.yaml"), api.GenerateInternalOpenAPIYAML},
	}
	for _, s := range specs {
		if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
			fmt.Fprintln(os.Stderr, "mkdir", filepath.Dir(s.path)+":", err)
			os.Exit(1)
		}
		b, err := s.gen()
		if err != nil {
			fmt.Fprintln(os.Stderr, "generate", s.path+":", err)
			os.Exit(1)
		}
		if err := os.WriteFile(s.path, b, 0o644); err != nil { //nolint:gosec
			fmt.Fprintln(os.Stderr, "write", s.path+":", err)
			os.Exit(1)
		}
		fmt.Printf("wrote %s (%d bytes)\n", s.path, len(b))
	}
}
