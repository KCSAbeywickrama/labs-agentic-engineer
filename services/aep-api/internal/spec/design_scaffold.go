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

package spec

// design_scaffold.go — the scaffold engine (spec-agent redesign #371): the
// cell is the primary design source, so the moment a save lands
// specs/design/design.cell, the platform derives a design.json SKELETON for
// every deployable component the cell declares that has none yet — in the same
// commit. The agent then only ENRICHES (language, dependencies, description,
// skillsPinned); it never authors the mechanical fields. Skeletons satisfy the
// design write-gate outright (strict schema, non-empty strings), so a
// scaffolded-but-unenriched component is valid on disk and the build-tag gate
// (spec_save.go) is what demands enrichment for in-phase components.

import (
	"encoding/json"
	"sort"
	"strings"
)

// DesignCellPath is the project-level cell file the scaffold keys off.
const DesignCellPath = "specs/design/design.cell"

// deployableCellTypes maps a cell node type to the design.json component type
// it scaffolds. Nodes typed otherwise (database, cache, identity-server, …)
// are dependencies of components, never component directories.
var deployableCellTypes = map[string]string{
	"service":         "service",
	"web-application": "web-application",
	"web-app":         "web-application",
	"worker":          "worker",
	"scheduled-task":  "scheduled-task",
}

// scaffoldDefaults per component type: language follows the org stack default
// (Ballerina services, TypeScript web apps — the architecture skill's rule);
// exposure defaults to the safe side per type. All of it is enrichable.
type scaffoldDefaults struct {
	language string
	exposure string
}

var scaffoldByType = map[string]scaffoldDefaults{
	"service":         {language: "Ballerina", exposure: "intranet"},
	"web-application": {language: "TypeScript", exposure: "internet"},
	"worker":          {language: "Ballerina", exposure: "intranet"},
	"scheduled-task":  {language: "Ballerina", exposure: "intranet"},
}

func componentDesignPath(id string) string {
	return "specs/design/components/" + id + "/design.json"
}

// scaffoldFromCell derives the missing design.json skeletons for a design.cell
// source. `exists` answers whether a repo path is already present (committed
// tree or the same batch). A cell that fails fact extraction scaffolds nothing
// — the TS grammar validator owns surfacing the syntax error.
func scaffoldFromCell(cellSource string, exists func(path string) bool) map[string]string {
	facts, err := parseCellFacts(cellSource)
	if err != nil {
		return nil
	}
	out := map[string]string{}
	for _, c := range facts.Components {
		componentType, deployable := deployableCellTypes[strings.ToLower(strings.TrimSpace(c.Type))]
		if !deployable || c.ID == "" {
			continue
		}
		path := componentDesignPath(c.ID)
		if exists(path) {
			continue
		}
		out[path] = renderScaffold(c.ID, componentType)
	}
	return out
}

// renderScaffold emits a skeleton that passes the strict design write-gate.
// Key order is stable (marshal of an ordered struct) so scaffolds are
// byte-deterministic.
func renderScaffold(id, componentType string) string {
	d := scaffoldByType[componentType]
	skeleton := struct {
		Name         string   `json:"name"`
		Type         string   `json:"type"`
		Version      string   `json:"version"`
		Language     string   `json:"language"`
		Buildpack    string   `json:"buildpack"`
		AppPath      string   `json:"appPath"`
		Entrypoint   string   `json:"entrypoint"`
		Exposure     string   `json:"exposure"`
		Dependencies []any    `json:"dependencies"`
		Description  string   `json:"description"`
	}{
		Name:         id,
		Type:         componentType,
		Version:      "0.1.0",
		Language:     d.language,
		Buildpack:    "docker",
		AppPath:      id,
		Entrypoint:   "deployment/" + componentType,
		Exposure:     d.exposure,
		Dependencies: []any{},
		Description:  "Scaffolded from design.cell — enrich with this component's responsibility, dependencies, and pinned skills.",
	}
	b, _ := json.MarshalIndent(skeleton, "", "  ")
	return string(b) + "\n"
}

// sortedPaths returns the scaffold map's paths in stable order (deterministic
// commit contents + response metas).
func sortedPaths(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for p := range m {
		out = append(out, p)
	}
	sort.Strings(out)
	return out
}
