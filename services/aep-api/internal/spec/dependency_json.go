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

// dependency_json.go — the codec for an external dependency's own file,
// `specs/design/dependencies/<name>/dependency.json`, and the hydration that
// copies it onto every component edge that references it.
//
// One dependency, one definition. A component's design.json says only
// `{ "kind": "external", "name": "payment-provider" }`; the provider, style,
// contract file, config keys and open candidates live once, here, shared by
// every component that uses the dependency. The read path (AssembleDesign)
// hydrates each reference so downstream readers — wiring derivation, the build
// preflight, the deploy gate, the console — keep the flat `Dependency` they
// always had; the write path (SplitDesign) writes both halves back.
//
// What "resolved" means is on disk: a Provider, a Contract file beside this
// one, and the Config key names. State is never written (ADR-0003 stands) —
// ComputeDependencyStatus derives it from which of these are present.
//
// A design written before the file existed still carries the definition on
// the component (the legacy fields dependencyJSON decodes). liftLegacyDefinitions
// turns those into definitions in memory, so the next SplitDesign writes the
// directory and the component loses the fields — the migration is the ordinary
// save.

package spec

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// DependencyDesignFile is the definition's file name in its directory.
const DependencyDesignFile = "dependency.json"

// SdkManifestFile is the SDK manifest's file name in a dependency directory.
const SdkManifestFile = "sdk.json"

// dependencyDesignKey is the design-relative key of a dependency's file.
func dependencyDesignKey(name string) string {
	return dependencyDirPrefix + name + "/" + DependencyDesignFile
}

// ContractPath is the REPO-relative path of a dependency's committed contract
// — what the coding agent reads. Empty when the dependency has no contract.
func ContractPath(depName, contractFile string) string {
	if contractFile == "" {
		return ""
	}
	return DesignDir + "/" + dependencyDirPrefix + depName + "/" + contractFile
}

type dependencyDefinitionJSON struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Source      string          `json:"source,omitempty"`
	Provider    string          `json:"provider,omitempty"`
	Style       string          `json:"style,omitempty"`
	Contract    string          `json:"contract,omitempty"`
	SDK         string          `json:"sdk,omitempty"`
	Provenance  *provenanceJSON `json:"provenance,omitempty"`
	Candidates  []candidateJSON `json:"candidates,omitempty"`
	Config      []configKeyJSON `json:"config,omitempty"`
	Assumed     *assumptionJSON `json:"assumed,omitempty"`
}

type provenanceJSON struct {
	SourceURL string `json:"sourceUrl,omitempty"`
	SHA256    string `json:"sha256,omitempty"`
	FetchedAt string `json:"fetchedAt,omitempty"`
	Sliced    bool   `json:"sliced,omitempty"`
}

type assumptionJSON struct {
	By   string `json:"by"`
	At   string `json:"at"`
	Note string `json:"note,omitempty"`
}

type sdkManifestJSON struct {
	Packages map[string]string `json:"packages"`
	DocsURL  string            `json:"docsUrl,omitempty"`
	Calls    []string          `json:"calls,omitempty"`
	Assumed  bool              `json:"assumed,omitempty"`
}

// parseDependencyDefinitionJSON decodes one dependency.json. Strict on unknown
// keys (the agent's write-gate is; a file that got past it is a bug worth
// surfacing, not smoothing over) and on the name-equals-directory rule.
func parseDependencyDefinitionJSON(dir, raw string) (DependencyDefinition, error) {
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.DisallowUnknownFields()
	var dj dependencyDefinitionJSON
	if err := dec.Decode(&dj); err != nil {
		return DependencyDefinition{}, fmt.Errorf("decode %s: %w", DependencyDesignFile, err)
	}
	if dec.More() {
		return DependencyDefinition{}, fmt.Errorf("decode %s: unexpected trailing content", DependencyDesignFile)
	}
	if !componentDesignName.MatchString(dir) {
		return DependencyDefinition{}, fmt.Errorf("dependency directory %q is not kebab-case", dir)
	}
	if dj.Name != dir {
		return DependencyDefinition{}, fmt.Errorf("%s name %q must equal the dependency directory %q", DependencyDesignFile, dj.Name, dir)
	}
	def := DependencyDefinition{
		Name:        dj.Name,
		Description: dj.Description,
		Source:      dj.Source,
		Provider:    dj.Provider,
		Style:       dj.Style,
		Contract:    dj.Contract,
		SDK:         dj.SDK,
		Candidates:  toModelCandidates(dj.Candidates),
		Config:      toModelConfigKeys(dj.Config),
	}
	if dj.Provenance != nil {
		def.Provenance = &DependencyProvenance{
			SourceURL: dj.Provenance.SourceURL,
			SHA256:    dj.Provenance.SHA256,
			FetchedAt: dj.Provenance.FetchedAt,
			Sliced:    dj.Provenance.Sliced,
		}
	}
	if dj.Assumed != nil {
		def.Assumed = &DependencyAssumption{By: dj.Assumed.By, At: dj.Assumed.At, Note: dj.Assumed.Note}
	}
	return def, nil
}

func marshalDependencyDefinitionJSON(dir string, def DependencyDefinition) ([]byte, error) {
	if def.Name == "" {
		return nil, fmt.Errorf("dependency with empty name")
	}
	if !componentDesignName.MatchString(def.Name) {
		return nil, fmt.Errorf("dependency name %q is not kebab-case", def.Name)
	}
	if def.Name != dir {
		return nil, fmt.Errorf("dependency name %q must equal the dependency directory %q", def.Name, dir)
	}
	dj := dependencyDefinitionJSON{
		Name:        def.Name,
		Description: def.Description,
		Source:      def.Source,
		Provider:    def.Provider,
		Style:       def.Style,
		Contract:    def.Contract,
		SDK:         def.SDK,
		Candidates:  toJSONCandidates(def.Candidates),
		Config:      toJSONConfigKeys(def.Config),
	}
	if def.Provenance != nil {
		dj.Provenance = &provenanceJSON{
			SourceURL: def.Provenance.SourceURL,
			SHA256:    def.Provenance.SHA256,
			FetchedAt: def.Provenance.FetchedAt,
			Sliced:    def.Provenance.Sliced,
		}
	}
	if def.Assumed != nil {
		dj.Assumed = &assumptionJSON{By: def.Assumed.By, At: def.Assumed.At, Note: def.Assumed.Note}
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	if err := enc.Encode(dj); err != nil {
		return nil, fmt.Errorf("encode %s: %w", DependencyDesignFile, err)
	}
	return buf.Bytes(), nil
}

// parseSdkManifestJSON decodes one sdk.json.
func parseSdkManifestJSON(raw string) (SdkManifest, error) {
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.DisallowUnknownFields()
	var mj sdkManifestJSON
	if err := dec.Decode(&mj); err != nil {
		return SdkManifest{}, fmt.Errorf("decode %s: %w", SdkManifestFile, err)
	}
	return SdkManifest{Packages: mj.Packages, DocsURL: mj.DocsURL, Calls: mj.Calls, Assumed: mj.Assumed}, nil
}

// assembleDependencyDefinitions parses every dependency directory in the
// design file map, sorted by name. A directory without a dependency.json is
// skipped — a contract uploaded before its definition is not a dependency yet.
func assembleDependencyDefinitions(files map[string]string) ([]DependencyDefinition, error) {
	names := DependencyNamesIn(files)
	out := make([]DependencyDefinition, 0, len(names))
	for _, name := range names {
		raw, ok := files[dependencyDesignKey(name)]
		if !ok {
			continue
		}
		def, err := parseDependencyDefinitionJSON(name, raw)
		if err != nil {
			return nil, fmt.Errorf("assemble dependency %q: %w", name, err)
		}
		out = append(out, def)
	}
	return out, nil
}

// liftLegacyDefinitions adds, for every external edge that has no definition
// on disk but still carries one on the component (a design from before the
// dependency file existed), a definition built from what the components say —
// config keys unioned across consumers by key, the first non-empty style /
// candidates / contract URL winning. The result is sorted by name. A reference
// with no definition anywhere is left alone: hydration reads it as
// needs-input, which is the truth.
func liftLegacyDefinitions(defs []DependencyDefinition, comps []DesignComponent) []DependencyDefinition {
	byName := make(map[string]int, len(defs))
	for i, d := range defs {
		byName[d.Name] = i
	}
	for _, c := range comps {
		for _, d := range c.Dependencies {
			if d.Kind != DependencyKindExternal || d.Name == "" {
				continue
			}
			if _, exists := byName[d.Name]; exists {
				continue
			}
			carried := d.Style != "" || d.Package != "" || len(d.Candidates) > 0 || len(d.Config) > 0 || d.Provenance != nil
			if !carried {
				continue
			}
			def := DependencyDefinition{Name: d.Name, Description: d.Description}
			// The legacy shape had no provider name; the style is the only
			// evidence a system was chosen, and the coding agent's research
			// pointer (the old specPath) is provenance, not a contract.
			def.Style = d.Style
			def.Candidates = append([]DependencyCandidate(nil), d.Candidates...)
			def.Config = append([]ConfigKey(nil), d.Config...)
			if d.Provenance != nil {
				p := *d.Provenance
				def.Provenance = &p
			}
			if d.Style != "" && len(d.Candidates) == 0 {
				def.Provider = d.Name
			}
			byName[d.Name] = len(defs)
			defs = append(defs, def)
		}
	}
	// Config keys from later consumers of an already-lifted name.
	for _, c := range comps {
		for _, d := range c.Dependencies {
			if d.Kind != DependencyKindExternal {
				continue
			}
			i, ok := byName[d.Name]
			if !ok || len(d.Config) == 0 {
				continue
			}
			defs[i].Config = unionConfigKeys(defs[i].Config, d.Config)
		}
	}
	sort.Slice(defs, func(i, j int) bool { return defs[i].Name < defs[j].Name })
	return defs
}

// unionConfigKeys merges two key lists by key name; a secret marking wins on
// conflict, the first description/default is kept. Order: a's, then b's new.
func unionConfigKeys(a, b []ConfigKey) []ConfigKey {
	index := make(map[string]int, len(a))
	out := append([]ConfigKey(nil), a...)
	for i, k := range out {
		index[k.Key] = i
	}
	for _, k := range b {
		if i, ok := index[k.Key]; ok {
			if k.Secret {
				out[i].Secret = true
				out[i].DefaultValue = ""
			}
			if out[i].Description == "" {
				out[i].Description = k.Description
			}
			continue
		}
		index[k.Key] = len(out)
		out = append(out, k)
	}
	return out
}

// hydrateExternalDependencies copies each definition onto every component edge
// that references it, and reads the directory for what the definition points
// at: the contract file's presence, and the SDK manifest's package for the
// component's language. An edge with no definition keeps only what the
// component said (kind, name, description, wiring) and reads as needs-input.
func hydrateExternalDependencies(d *DesignFile, files map[string]string) {
	defs := make(map[string]DependencyDefinition, len(d.Dependencies))
	for _, def := range d.Dependencies {
		defs[def.Name] = def
	}
	manifests := make(map[string]SdkManifest)
	for i := range d.Components {
		comp := &d.Components[i]
		for j := range comp.Dependencies {
			dep := &comp.Dependencies[j]
			if dep.Kind != DependencyKindExternal {
				continue
			}
			def, ok := defs[dep.Name]
			if !ok {
				// Nothing on disk and nothing lifted: strip any legacy carry so
				// the edge reads as the reference it is.
				dep.Style, dep.Package, dep.Candidates, dep.Config, dep.Provenance = "", "", nil, nil, nil
				continue
			}
			dep.Source = def.Source
			dep.Provider = def.Provider
			dep.Style = def.Style
			dep.Candidates = append([]DependencyCandidate(nil), def.Candidates...)
			dep.Config = append([]ConfigKey(nil), def.Config...)
			dep.Provenance = nil
			if def.Provenance != nil {
				p := *def.Provenance
				dep.Provenance = &p
			}
			dep.Assumed = nil
			if def.Assumed != nil {
				a := *def.Assumed
				dep.Assumed = &a
			}
			if dep.Description == "" {
				dep.Description = def.Description
			}
			// The contract counts only when the file is actually beside the
			// definition — a name pointing at nothing is no contract. One the
			// agent wrote from research says so in the file itself, and counts
			// only once a user has accepted it.
			dep.Contract, dep.ContractAssumed = "", false
			if def.Contract != "" {
				if raw, present := files[dependencyDirPrefix+dep.Name+"/"+def.Contract]; present {
					dep.Contract = def.Contract
					dep.ContractAssumed = contractMarkedAssumed(raw)
				}
			}
			dep.SDK, dep.Package = "", ""
			if def.Style == DependencyStyleSDK && def.SDK != "" {
				key := dependencyDirPrefix + dep.Name + "/" + def.SDK
				m, cached := manifests[key]
				if !cached {
					if raw, present := files[key]; present {
						if parsed, err := parseSdkManifestJSON(raw); err == nil {
							m = parsed
						}
					}
					manifests[key] = m
				}
				// The manifest's presence is what "has its SDK" means.
				if len(m.Packages) > 0 {
					dep.SDK = def.SDK
					dep.Package = m.Packages[strings.ToLower(strings.TrimSpace(comp.Language))]
					if m.Assumed {
						dep.ContractAssumed = true
					}
				}
			}
		}
	}
}

// contractMarkedAssumed reports whether a contract file declares itself
// agent-written: an OpenAPI document with `x-aep-assumed: true` at the root,
// or a GraphQL schema whose first lines carry `# x-aep-assumed: true`. The
// marker lives in the file so a reader of the file alone knows.
func contractMarkedAssumed(raw string) bool {
	head := raw
	if len(head) > 4096 {
		head = head[:4096]
	}
	for _, line := range strings.Split(head, "\n") {
		t := strings.TrimSpace(line)
		if t == "x-aep-assumed: true" || t == "\"x-aep-assumed\": true" || t == "\"x-aep-assumed\": true," || t == "# x-aep-assumed: true" {
			return true
		}
	}
	return false
}
