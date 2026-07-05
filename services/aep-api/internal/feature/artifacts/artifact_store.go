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

package artifacts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/wso2/aep/aep-api/models"
)

// ArtifactStore wraps the GitHub-direct ArtifactService to add value beyond raw
// file reads: external-API catalog resolution and the typed `DesignFile` shape
// (YAML split/assemble). It is a read + assemble surface — mutations happen via
// the Files API and are committed straight to `main`.
type ArtifactStore struct {
	artifactSvc  ArtifactService
	externalAPIs *ExternalAPICatalog
}

func NewArtifactStore(artifactSvc ArtifactService) *ArtifactStore {
	return &ArtifactStore{artifactSvc: artifactSvc, externalAPIs: DefaultExternalAPICatalog()}
}

// SetExternalAPICatalog overrides the catalog the store uses to resolve
// architect-declared dependent-API names into concrete URLs. Optional —
// without it, NewArtifactStore wires the shipped default catalog.
func (s *ArtifactStore) SetExternalAPICatalog(c *ExternalAPICatalog) {
	if s == nil {
		return
	}
	s.externalAPIs = c
}

// ---- Requirements (multi-file Markdown directory) -----------------------

// ListRequirements returns the requirements file map at HEAD, under
// `specs/requirements/`. A first-time project with no requirements yet returns
// an empty map (not an error).
func (s *ArtifactStore) ListRequirements(ctx context.Context, orgID, projectID string) (map[string]string, error) {
	files, err := s.artifactSvc.ListRequirementFiles(ctx, orgID, projectID)
	if err != nil {
		return nil, err
	}
	if files == nil {
		files = map[string]string{}
	}
	return files, nil
}

// ---- Design (multi-file directory) --------------------------------------

// DesignFile is the BFF's in-memory representation of the multi-file design
// artifact. It assembles from the repo layout under `specs/design/`:
//
//	design.md                              # overview prose + sourceSpec frontmatter
//	components/<name>/design.md            # frontmatter (type, language, dependsOn,
//	                                       # buildpack, appPath, entrypoint) + body
//	                                       # (componentAgentInstructions)
//	components/<name>/openapi.yaml         # OpenAPI 3.0.3 (service components only)
type DesignFile struct {
	Overview      string                   `json:"overview"`
	Components    []models.DesignComponent `json:"components"`
	SourceSpec    string                   `json:"sourceSpec,omitempty"`
	SkillsApplied []string                 `json:"skillsApplied,omitempty"`
}

// DesignRootFile is the canonical root design document.
const DesignRootFile = "design.md"

// componentDirPrefix is the path prefix under specs/design/ for per-component
// directories.
const componentDirPrefix = "components/"

// ListDesignFiles returns the design file map at HEAD, under `specs/design/`.
// Keys are paths relative to that directory, using forward slashes (e.g.
// `design.md`, `components/user-api/design.md`).
func (s *ArtifactStore) ListDesignFiles(ctx context.Context, orgID, projectID string) (map[string]string, error) {
	files, err := s.artifactSvc.ListDesignFiles(ctx, orgID, projectID)
	if err != nil {
		return nil, err
	}
	if files == nil {
		files = map[string]string{}
	}
	return files, nil
}

// ReadDesign lists the design files at HEAD and assembles them into the flat
// `DesignFile` shape the rest of the BFF expects (task generation, OC
// provisioning, issue bodies, etc.). Returns (nil, nil) when no design root
// exists yet.
func (s *ArtifactStore) ReadDesign(ctx context.Context, orgID, projectID string) (*DesignFile, error) {
	files, err := s.artifactSvc.ListDesignFiles(ctx, orgID, projectID)
	if err != nil {
		return nil, err
	}
	return s.AssembleDesignFrom(files)
}

// AssembleDesignFrom assembles the flat DesignFile from an already-listed
// design file map — the single-read path for callers that also need the raw
// map (no second HEAD walk). Returns (nil, nil) when no design root exists.
func (s *ArtifactStore) AssembleDesignFrom(files map[string]string) (*DesignFile, error) {
	if len(files) == 0 || strings.TrimSpace(files[DesignRootFile]) == "" {
		return nil, nil
	}
	design, err := AssembleDesign(files)
	if err != nil {
		return nil, err
	}
	// Resolve architect-declared dependent-API names against the external API
	// catalog so the in-memory design always has concrete URLs even when the
	// on-disk frontmatter declared by intent only.
	s.resolveExternalAPIs(design)
	return design, nil
}

// resolveExternalAPIs fills in URLs for catalog-known dependent-API entries
// whose URL was left blank by the architect. Idempotent.
func (s *ArtifactStore) resolveExternalAPIs(d *DesignFile) {
	if s == nil || s.externalAPIs == nil || d == nil {
		return
	}
	for i := range d.Components {
		for j := range d.Components[i].DependentApis {
			dep := &d.Components[i].DependentApis[j]
			if dep.URL != "" {
				continue
			}
			entry := s.externalAPIs.Lookup(dep.Name)
			if entry.URL == "" {
				continue
			}
			dep.URL = entry.URL
			if dep.Authentication == "" {
				dep.Authentication = entry.Authentication
			}
		}
	}
}

// ---- Helpers ------------------------------------------------------------

// IsNotFound is sugar for callers that want to distinguish "no artifact yet"
// from a real error.
func IsNotFound(err error) bool { return errors.Is(err, ErrArtifactNotFound) }

// DesignFilesEqual compares two design file maps after trimming whitespace from
// each value. Used by the has-unsaved-changes check.
func DesignFilesEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, va := range a {
		vb, ok := b[k]
		if !ok {
			return false
		}
		if strings.TrimSpace(va) != strings.TrimSpace(vb) {
			return false
		}
	}
	return true
}

// rootFrontmatter is the YAML frontmatter we accept on the root `design.md`.
type rootFrontmatter struct {
	SourceSpec    string   `yaml:"sourceSpec,omitempty"`
	SkillsApplied []string `yaml:"skillsApplied,omitempty"`
}

// componentFrontmatter is the YAML frontmatter we accept on each
// `components/<name>/design.md`. Field names mirror the user-facing keys
// (snake-free) so frontmatter the architect emits is human-editable.
type componentFrontmatter struct {
	Type           string                `yaml:"type"`
	Language       string                `yaml:"language,omitempty"`
	DependsOn      []string              `yaml:"dependsOn,omitempty"`
	Buildpack      string                `yaml:"buildpack,omitempty"`
	AppPath        string                `yaml:"appPath,omitempty"`
	Entrypoint     string                `yaml:"entrypoint,omitempty"`
	ExposesAPI     *exposesAPIConfig     `yaml:"exposesAPI,omitempty"`
	CallerIdentity *callerIdentityConfig `yaml:"callerIdentity,omitempty"`
	DependentApis  []dependentApiConfig  `yaml:"dependentApis,omitempty"`
}

// exposesAPIConfig is the on-disk shape for a service component's API exposure
// policy. `Auth: "end-user-required"` ⇒ gateway validates a user JWT and injects
// UserContext upstream.
type exposesAPIConfig struct {
	Managed     bool   `yaml:"managed,omitempty"`
	Auth        string `yaml:"auth,omitempty"`
	UserContext string `yaml:"userContext,omitempty"`
}

// callerIdentityConfig is the on-disk shape for a web-app's caller-identity
// intent. `Mode: "end-user"` ⇒ the SPA performs OIDC + PKCE against the IDP.
type callerIdentityConfig struct {
	Mode string `yaml:"mode,omitempty"`
}

// dependentApiConfig is the on-disk shape for an external upstream API a
// component consumes at runtime. See models.DependentAPI for the wire shape.
type dependentApiConfig struct {
	Name           string `yaml:"name"`
	URL            string `yaml:"url"`
	Description    string `yaml:"description,omitempty"`
	Authentication string `yaml:"authentication,omitempty"`
}

// SplitFrontmatter separates the leading YAML frontmatter block (delimited by
// `---` lines) from the body. If the file has no frontmatter, returns
// ("", content, nil).
func SplitFrontmatter(content string) (fm string, body string, err error) {
	trimmed := strings.TrimLeft(content, " \t\r\n")
	// Strip an optional UTF-8 BOM (U+FEFF) before frontmatter detection.
	trimmed = strings.TrimPrefix(trimmed, "\ufeff")
	if !strings.HasPrefix(trimmed, "---") {
		return "", content, nil
	}
	rest := trimmed[3:]
	rest = strings.TrimLeft(rest, " \t")
	if !strings.HasPrefix(rest, "\n") && !strings.HasPrefix(rest, "\r\n") {
		return "", content, nil
	}
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return "", content, fmt.Errorf("frontmatter: unterminated --- block")
	}
	fm = strings.TrimSpace(rest[:end])
	after := rest[end+len("\n---"):]
	after = strings.TrimPrefix(after, "\r")
	after = strings.TrimPrefix(after, "\n")
	return fm, after, nil
}

// AssembleDesign reconstructs a flat DesignFile from the multi-file map (keys
// relative to specs/design/, forward slashes). Returns an error if the root
// `design.md` is missing (callers handle that as "no design yet").
func AssembleDesign(files map[string]string) (*DesignFile, error) {
	root, ok := files[DesignRootFile]
	if !ok {
		return nil, fmt.Errorf("design.md missing")
	}

	fm, body, err := SplitFrontmatter(root)
	if err != nil {
		return nil, fmt.Errorf("parse design.md frontmatter: %w", err)
	}
	var rfm rootFrontmatter
	if fm != "" {
		if err := yaml.Unmarshal([]byte(fm), &rfm); err != nil {
			return nil, fmt.Errorf("decode design.md frontmatter: %w", err)
		}
	}
	out := &DesignFile{
		Overview:      strings.TrimSpace(body),
		SourceSpec:    rfm.SourceSpec,
		SkillsApplied: append([]string(nil), rfm.SkillsApplied...),
	}

	componentNames := ComponentNamesIn(files)
	out.Components = make([]models.DesignComponent, 0, len(componentNames))
	for _, name := range componentNames {
		// design.json is the component model since PR #70 (the agent's write
		// gate and the save gate both validate it); design.md frontmatter is
		// the legacy shape, kept as a fallback for pre-#70 projects.
		if raw, ok := files[componentDirPrefix+name+"/design.json"]; ok {
			comp, err := assembleComponentFromJSON(name, raw, componentNames, files)
			if err != nil {
				return nil, fmt.Errorf("assemble component %q: %w", name, err)
			}
			out.Components = append(out.Components, comp)
			continue
		}
		raw, ok := files[componentDirPrefix+name+"/design.md"]
		if !ok {
			continue
		}
		comp, err := assembleComponent(name, raw, files)
		if err != nil {
			return nil, fmt.Errorf("assemble component %q: %w", name, err)
		}
		out.Components = append(out.Components, comp)
	}
	return out, nil
}

// componentDesignJSON is the on-disk shape of `components/<name>/design.json`
// (the published component-design schema — packages/contracts/schemas/
// component-design.schema.json; same definition the agent's write gate and the
// save-time hard gate validate).
type componentDesignJSON struct {
	Name        string                    `json:"name"`
	Type        string                    `json:"type"`
	Version     string                    `json:"version"`
	Language    string                    `json:"language"`
	Buildpack   string                    `json:"buildpack"`
	AppPath     string                    `json:"appPath"`
	Entrypoint  string                    `json:"entrypoint"`
	Exposure    string                    `json:"exposure"`
	Connections []componentConnectionJSON `json:"connections"`
	Description string                    `json:"description"`
}

// componentConnectionJSON is one design.json connection. OnPlatform defaults
// to true when omitted (matching @aep/design-projection's `!== false`).
type componentConnectionJSON struct {
	To         string `json:"to"`
	Type       string `json:"type"`
	OnPlatform *bool  `json:"onPlatform,omitempty"`
}

// assembleComponentFromJSON builds a DesignComponent from design.json.
// DependsOn keeps its legacy meaning — sibling components built by this
// project — so it takes only on-platform connections whose target is another
// component directory; off-platform connections surface as DependentApis
// (design.json carries no URL — the name/type is all we know at design time).
func assembleComponentFromJSON(name, raw string, componentNames []string, files map[string]string) (models.DesignComponent, error) {
	var cd componentDesignJSON
	if err := json.Unmarshal([]byte(raw), &cd); err != nil {
		return models.DesignComponent{}, fmt.Errorf("parse design.json: %w", err)
	}
	siblings := make(map[string]bool, len(componentNames))
	for _, n := range componentNames {
		siblings[n] = true
	}
	dependsOn := []string{}
	var depApis []models.DependentAPI
	for _, conn := range cd.Connections {
		if conn.To == "" {
			continue
		}
		onPlatform := conn.OnPlatform == nil || *conn.OnPlatform
		switch {
		case onPlatform && siblings[conn.To] && conn.To != name:
			dependsOn = append(dependsOn, conn.To)
		case !onPlatform:
			depApis = append(depApis, models.DependentAPI{
				Name:        conn.To,
				Description: conn.Type + " connection (off-platform)",
			})
		}
	}
	openapi := files[componentDirPrefix+name+"/openapi.yaml"]
	if openapi == "" {
		openapi = files[componentDirPrefix+name+"/openapi.yml"]
	}
	return models.DesignComponent{
		Name:                       name,
		ComponentType:              cd.Type,
		Language:                   cd.Language,
		DependsOn:                  dependsOn,
		Entrypoint:                 cd.Entrypoint,
		Buildpack:                  cd.Buildpack,
		AppPath:                    cd.AppPath,
		OpenAPISpec:                openapi,
		ComponentAgentInstructions: strings.TrimSpace(cd.Description),
		DependentApis:              depApis,
	}, nil
}

func assembleComponent(name, designMd string, files map[string]string) (models.DesignComponent, error) {
	fm, body, err := SplitFrontmatter(designMd)
	if err != nil {
		return models.DesignComponent{}, fmt.Errorf("frontmatter: %w", err)
	}
	var cfm componentFrontmatter
	if fm != "" {
		if err := yaml.Unmarshal([]byte(fm), &cfm); err != nil {
			return models.DesignComponent{}, fmt.Errorf("decode frontmatter: %w", err)
		}
	}
	openapi := files[componentDirPrefix+name+"/openapi.yaml"]
	if openapi == "" {
		openapi = files[componentDirPrefix+name+"/openapi.yml"]
	}
	dependsOn := append([]string(nil), cfm.DependsOn...)
	if dependsOn == nil {
		dependsOn = []string{}
	}
	var exposes *models.ExposesAPI
	if cfm.ExposesAPI != nil && (cfm.ExposesAPI.Auth != "" || cfm.ExposesAPI.Managed || cfm.ExposesAPI.UserContext != "") {
		exposes = &models.ExposesAPI{
			Managed:     cfm.ExposesAPI.Managed,
			Auth:        cfm.ExposesAPI.Auth,
			UserContext: cfm.ExposesAPI.UserContext,
		}
	}
	var caller *models.CallerIdentity
	if cfm.CallerIdentity != nil && cfm.CallerIdentity.Mode != "" {
		caller = &models.CallerIdentity{Mode: cfm.CallerIdentity.Mode}
	}
	var depApis []models.DependentAPI
	if len(cfm.DependentApis) > 0 {
		depApis = make([]models.DependentAPI, 0, len(cfm.DependentApis))
		for _, d := range cfm.DependentApis {
			if d.Name == "" {
				continue
			}
			depApis = append(depApis, models.DependentAPI{
				Name:           d.Name,
				URL:            d.URL,
				Description:    d.Description,
				Authentication: d.Authentication,
			})
		}
	}
	return models.DesignComponent{
		Name:                       name,
		ComponentType:              cfm.Type,
		Language:                   cfm.Language,
		DependsOn:                  dependsOn,
		Entrypoint:                 cfm.Entrypoint,
		Buildpack:                  cfm.Buildpack,
		AppPath:                    cfm.AppPath,
		OpenAPISpec:                openapi,
		ComponentAgentInstructions: strings.TrimSpace(body),
		ExposesAPI:                 exposes,
		CallerIdentity:             caller,
		DependentApis:              depApis,
	}, nil
}

// ComponentNamesIn walks the file map and returns the unique component
// directory names found under `components/`, sorted alphabetically.
func ComponentNamesIn(files map[string]string) []string {
	seen := make(map[string]struct{})
	for p := range files {
		if !strings.HasPrefix(p, componentDirPrefix) {
			continue
		}
		rest := p[len(componentDirPrefix):]
		slash := strings.IndexByte(rest, '/')
		if slash <= 0 {
			continue
		}
		seen[rest[:slash]] = struct{}{}
	}
	names := make([]string, 0, len(seen))
	for n := range seen {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}
