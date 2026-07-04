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
	"errors"
	"fmt"
	"log/slog"
	"path"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/wso2/aep/aep-api/models"
)

// ArtifactStore wraps the in-process artifact service to add value beyond
// pure file I/O: the typed `DesignFile` shape (YAML split/assemble) and
// read-time org-service dependency resolution.
type ArtifactStore struct {
	artifactSvc ArtifactService
	// orgServices resolves `org-service` dependencies against the live org
	// endpoint catalog at design-read time (see resolveOrgServices). Nil
	// until the composition root wires a concrete provider via
	// SetOrgServiceResolver (a later task) — until then, org-service
	// dependencies keep whatever Status/Reason they already carry (always
	// empty: Status/Reason are read-time computed and never persisted to
	// design.json).
	orgServices OrgServiceResolver
}

func NewArtifactStore(artifactSvc ArtifactService) *ArtifactStore {
	return &ArtifactStore{artifactSvc: artifactSvc}
}

// OrgServiceResolver answers whether an `org-service` dependency name is
// published namespace-visible in the org — the dynamic org endpoint catalog.
// Declared here (consumer side) so the artifacts package stays free of an
// OC-client dependency; the concrete provider is wired in by the
// composition root via SetOrgServiceResolver in a later task.
type OrgServiceResolver interface {
	IsNamespaceVisible(ctx context.Context, orgHandle, name string) (bool, error)
	// ExistsAnyVisibility reports whether a component named `name` publishes
	// ANY endpoint in the org catalog regardless of visibility — used to
	// refine an org-service dependency into `blocked`/`access-required`
	// (exists, project-only) vs `unresolved`/`not-found` (no such
	// component).
	ExistsAnyVisibility(ctx context.Context, orgHandle, name string) (bool, error)
}

// SetOrgServiceResolver wires the dynamic org endpoint catalog used to mark
// `org-service` dependencies resolved/unresolved at design-read time. A nil
// store is a documented no-op (mirrors the other Set* setters).
func (s *ArtifactStore) SetOrgServiceResolver(r OrgServiceResolver) {
	if s == nil {
		return
	}
	s.orgServices = r
}

// ---- Requirements (multi-file Markdown directory) -----------------------

// RequirementsMainFile is the canonical primary requirements document. It
// cannot be deleted/renamed via the API — controllers should reject
// destructive operations on it.
const RequirementsMainFile = "requirements.md"

// ListRequirements returns the working-tree file map under
// `specs/requirements/`. A first-time project with no requirements yet
// returns an empty map (not an error).
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

// ReadRequirementFile reads a single requirement file by basename.
func (s *ArtifactStore) ReadRequirementFile(ctx context.Context, orgID, projectID, name string) (string, error) {
	res, err := s.artifactSvc.GetFile(ctx, orgID, projectID, path.Join(RequirementsDir, name))
	if err != nil {
		return "", err
	}
	return res.Content, nil
}

// WriteRequirementFile creates or overwrites a single requirement file.
// The optional ifMatch sha (returned by the previous PUT) gives the
// streaming caller optimistic concurrency control.
func (s *ArtifactStore) WriteRequirementFile(ctx context.Context, orgID, projectID, name, content string) (sha string, err error) {
	res, err := s.artifactSvc.PutFile(ctx, orgID, projectID, path.Join(RequirementsDir, name), content, "")
	if err != nil {
		return "", fmt.Errorf("write requirement file %q: %w", name, err)
	}
	return res.SHA, nil
}

// DeleteRequirementFile removes a requirement file from the working tree.
// The change is persisted on the next SaveRequirements call.
func (s *ArtifactStore) DeleteRequirementFile(ctx context.Context, orgID, projectID, name string) error {
	if name == RequirementsMainFile {
		return fmt.Errorf("cannot delete %s", RequirementsMainFile)
	}
	if err := s.artifactSvc.DeleteRequirementFile(ctx, orgID, projectID, name); err != nil {
		return fmt.Errorf("delete requirement file %q: %w", name, err)
	}
	return nil
}

// ---- Design (multi-file directory) --------------------------------------

// DesignFile is the BFF's in-memory representation of the multi-file design
// artifact. It assembles from / splits to the working-tree layout under
// `specs/design/`:
//
//	design.md                              # overview prose + sourceSpec frontmatter
//	components/<name>/design.json          # authored ComponentDesign (type, version,
//	                                       # language, buildpack, appPath, entrypoint,
//	                                       # exposure, description, dependencies[],
//	                                       # exposesAPI, callerIdentity)
//	components/<name>/openapi.yaml         # OpenAPI 3.0.3 (service components only)
type DesignFile struct {
	Overview      string                   `json:"overview"`
	Components    []models.DesignComponent `json:"components"`
	SourceSpec    string                   `json:"sourceSpec,omitempty"`
	SkillsApplied []string                 `json:"skillsApplied,omitempty"`
}

// DesignRootFile is the canonical root design document. It cannot be deleted
// via the API.
const DesignRootFile = "design.md"

// ComponentDesignFile is the authored per-component design document basename,
// stored at `components/<name>/design.json`. It replaces the former
// per-component design.md.
const ComponentDesignFile = "design.json"

// componentDirPrefix is the path prefix under specs/design/ for per-component
// directories.
const componentDirPrefix = "components/"

// ListDesignFiles returns the working-tree file map under `specs/design/`.
// Keys are paths relative to that directory, using forward slashes (e.g.
// `design.md`, `components/user-api/design.json`).
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

// ReadDesignFile reads a single design file by sub-path.
func (s *ArtifactStore) ReadDesignFile(ctx context.Context, orgID, projectID, subPath string) (string, error) {
	res, err := s.artifactSvc.GetFile(ctx, orgID, projectID, path.Join(DesignDir, subPath))
	if err != nil {
		return "", err
	}
	return res.Content, nil
}

// WriteDesignFile creates or overwrites a single design file. The path is
// relative to `specs/design/` (forward slashes; nested components allowed).
func (s *ArtifactStore) WriteDesignFile(ctx context.Context, orgID, projectID, subPath, content string) (sha string, err error) {
	res, err := s.artifactSvc.PutFile(ctx, orgID, projectID, path.Join(DesignDir, subPath), content, "")
	if err != nil {
		return "", fmt.Errorf("write design file %q: %w", subPath, err)
	}
	return res.SHA, nil
}

// DeleteDesignFile removes a single design file. Refuses to delete the root
// `design.md`.
func (s *ArtifactStore) DeleteDesignFile(ctx context.Context, orgID, projectID, subPath string) error {
	if subPath == DesignRootFile {
		return fmt.Errorf("cannot delete %s", DesignRootFile)
	}
	if err := s.artifactSvc.DeleteDesignFile(ctx, orgID, projectID, subPath); err != nil {
		return fmt.Errorf("delete design file %q: %w", subPath, err)
	}
	return nil
}

// DeleteDesignDirectory removes a directory under `specs/design/` and all
// its contents (e.g. `components/user-api` to remove a component's whole
// subtree).
func (s *ArtifactStore) DeleteDesignDirectory(ctx context.Context, orgID, projectID, subPath string) error {
	if err := s.artifactSvc.DeleteDesignDirectory(ctx, orgID, projectID, subPath); err != nil {
		return fmt.Errorf("delete design directory %q: %w", subPath, err)
	}
	return nil
}

// ReadDesign lists the working-tree design files and assembles them into the
// flat `DesignFile` shape that the rest of the BFF expects (task generation,
// OC provisioning, issue bodies, etc.). Returns
// (nil, ErrArtifactNotFound) when no design root exists yet.
func (s *ArtifactStore) ReadDesign(ctx context.Context, orgID, projectID string) (*DesignFile, error) {
	files, err := s.artifactSvc.ListDesignFiles(ctx, orgID, projectID)
	if err != nil {
		return nil, err
	}
	if len(files) == 0 || strings.TrimSpace(files[DesignRootFile]) == "" {
		return nil, nil
	}
	design, err := AssembleDesign(files)
	if err != nil {
		return nil, err
	}
	// Mark org-service dependencies resolved/unresolved against the live org
	// endpoint catalog so the architecture view renders status without user
	// action. The concrete address is injected at wiring time by a later
	// task (cascade).
	s.resolveOrgServices(ctx, orgID, design)
	return design, nil
}

// resolveOrgServices marks each `org-service` dependency with a 4-state
// status at read time: `resolved` (namespace-visible), `blocked` +
// `access-required` (exists but project-only — consumer must request
// access), or `unresolved` + `not-found` (absent from the catalog). orgID is
// the OC namespace (locally, the org handle).
//
// A no-op until the composition root wires a resolver via
// SetOrgServiceResolver — this codebase deleted the static ExternalAPICatalog
// fallback the ported source used when no dynamic resolver was wired (task
// A1), so until wired, org-service dependencies simply keep the Status/Reason
// AssembleDesign left them with (always empty, since Status/Reason are never
// persisted to design.json).
//
// Best-effort: a resolver error never fails the design read.
//   - An IsNamespaceVisible error leaves the dependency's Status/Reason
//     completely untouched — matches the ported source's "leave whatever
//     status is stored" behavior byte-for-byte.
//   - An ExistsAnyVisibility error leaves Status = unresolved (already set
//     before the refinement call, to be overwritten only on success) with an
//     empty Reason — also ported byte-for-byte from the source, which is
//     asymmetric with the IsNamespaceVisible case above by construction.
func (s *ArtifactStore) resolveOrgServices(ctx context.Context, orgID string, d *DesignFile) {
	if s == nil || d == nil || s.orgServices == nil {
		return
	}
	for i := range d.Components {
		for j := range d.Components[i].Dependencies {
			dep := &d.Components[i].Dependencies[j]
			if dep.Kind != models.DependencyKindOrgService {
				continue
			}
			visible, err := s.orgServices.IsNamespaceVisible(ctx, orgID, dep.Name)
			if err != nil {
				slog.WarnContext(ctx, "org-service resolver: namespace-visible check failed",
					"org", orgID, "dependency", dep.Name, "error", err)
				continue
			}
			if visible {
				dep.Status = models.DependencyStatusResolved
				dep.Reason = ""
				continue
			}
			// Not namespace-visible: refine into `blocked` (project-only —
			// requestable via access request) vs `unresolved` (absent — not
			// in the catalog at all).
			dep.Status = models.DependencyStatusUnresolved
			dep.Reason = ""
			exists, err := s.orgServices.ExistsAnyVisibility(ctx, orgID, dep.Name)
			if err != nil {
				slog.WarnContext(ctx, "org-service resolver: exists-any-visibility check failed",
					"org", orgID, "dependency", dep.Name, "error", err)
				continue
			}
			if exists {
				// Provider exists but publishes only project-only — consumer
				// must request access.
				dep.Status = models.DependencyStatusBlocked
				dep.Reason = models.DependencyReasonAccessRequired
			} else {
				dep.Reason = models.DependencyReasonNotFound
			}
		}
	}
}

// WriteDesign splits the in-memory design into multiple files, then writes
// every file via the git-service. Files no longer referenced by the new
// design (e.g. components removed by a regeneration) are NOT auto-deleted —
// the caller is expected to call DeleteDesignDirectory for removed
// components separately.
func (s *ArtifactStore) WriteDesign(ctx context.Context, orgID, projectID string, design *DesignFile) error {
	files, err := SplitDesign(design)
	if err != nil {
		return fmt.Errorf("split design: %w", err)
	}
	for subPath, content := range files {
		if _, err := s.WriteDesignFile(ctx, orgID, projectID, subPath, content); err != nil {
			return fmt.Errorf("write %s: %w", subPath, err)
		}
	}
	return nil
}

// SetComponentOrgPublished durably persists `exposesAPI.orgPublished:true` on
// the provider component and COMMITS that one `design.json` to remote main
// (no new design version tag). This is the grant-cascade durability write: when
// a provider's org-publish task deploys, the flag must survive a future
// re-implementation so namespace visibility isn't silently dropped.
//
// `componentName` may be the design's logical component name OR the OC
// component name `<project>-<logical>` — both forms match. Idempotent: a no-op
// (no commit) when the component already has the flag set, when no design
// exists, or when no matching component is found. Unlike a plain
// WriteDesignFile (working-tree only), this reaches a real GitHub commit so
// the change is never lost.
func (s *ArtifactStore) SetComponentOrgPublished(ctx context.Context, orgID, projectID, componentName string) error {
	design, err := s.ReadDesign(ctx, orgID, projectID)
	if err != nil {
		return fmt.Errorf("read design: %w", err)
	}
	if design == nil {
		return nil // no design yet — nothing to persist.
	}
	for i := range design.Components {
		comp := design.Components[i]
		if !designComponentMatches(comp.Name, projectID, componentName) {
			continue
		}
		if comp.ExposesAPI == nil {
			comp.ExposesAPI = &models.ExposesAPI{}
		}
		if comp.ExposesAPI.OrgPublished {
			return nil // idempotent — already durable, no commit.
		}
		comp.ExposesAPI.OrgPublished = true

		// Render ONLY this component's design.json through the canonical codec
		// so the file round-trips identically, then commit that single file to
		// remote main without tagging.
		files, ferr := SplitDesign(&DesignFile{Components: []models.DesignComponent{comp}})
		if ferr != nil {
			return fmt.Errorf("render component %q design: %w", comp.Name, ferr)
		}
		subPath := componentDirPrefix + comp.Name + "/" + ComponentDesignFile
		content, ok := files[subPath]
		if !ok {
			return fmt.Errorf("render component %q design: %q missing from split", comp.Name, subPath)
		}
		msg := fmt.Sprintf("chore(dependencies): mark %s org-published (namespace visibility)", comp.Name)
		if _, cerr := s.artifactSvc.CommitDesignFile(ctx, orgID, projectID, subPath, content, msg); cerr != nil {
			return fmt.Errorf("commit %s: %w", subPath, cerr)
		}
		return nil
	}
	return nil // no matching component — nothing to persist.
}

// SetDependencySpecPath records specPath on the named dependency within the
// named component by writing that component's design.json to the working-tree
// draft (no commit, no version tag). This is the spec-collection draft write:
// after StoreConsumedSpec writes the spec blob to the draft, this records the
// specPath on the dependency so the needsSpec gate is cleared on next read.
// Both changes are committed atomically when SaveDesign is called.
//
// Idempotent: a no-op (no write) when the component/dependency is not found
// or when specPath already matches. Returns nil in all no-op cases.
func (s *ArtifactStore) SetDependencySpecPath(ctx context.Context, orgID, projectID, component, depName, specPath string) error {
	design, err := s.ReadDesign(ctx, orgID, projectID)
	if err != nil {
		return fmt.Errorf("read design: %w", err)
	}
	if design == nil {
		return nil // no design yet — nothing to persist.
	}
	for i := range design.Components {
		comp := design.Components[i]
		if comp.Name != component {
			continue
		}
		// Found the component — now find the dependency.
		found := false
		for j := range comp.Dependencies {
			if comp.Dependencies[j].Name != depName {
				continue
			}
			if comp.Dependencies[j].SpecPath == specPath && comp.Dependencies[j].SpecUrl == "" {
				return nil // idempotent — already recorded + transient hint cleared.
			}
			comp.Dependencies[j].SpecPath = specPath
			// Clear the transient architect hint now that specPath is recorded; also
			// clear the computed status so the next read re-derives it from specPath
			// (needsSpec+specPath set → resolved, not unresolved).
			comp.Dependencies[j].SpecUrl = ""
			comp.Dependencies[j].Status = ""
			comp.Dependencies[j].Reason = ""
			found = true
			break
		}
		if !found {
			return nil // dep not found — nothing to persist.
		}
		// Render ONLY this component's design.json through the canonical codec,
		// then write it to the working-tree draft via WriteDesignFile (not
		// CommitDesignFile). The draft save (SaveDesign) will commit both the
		// spec blob and this design.json atomically with the v<N>-<M> tag.
		files, ferr := SplitDesign(&DesignFile{Components: []models.DesignComponent{comp}})
		if ferr != nil {
			return fmt.Errorf("render component %q design: %w", comp.Name, ferr)
		}
		subPath := componentDirPrefix + comp.Name + "/" + ComponentDesignFile
		content, ok := files[subPath]
		if !ok {
			return fmt.Errorf("render component %q design: %q missing from split", comp.Name, subPath)
		}
		if _, werr := s.WriteDesignFile(ctx, orgID, projectID, subPath, content); werr != nil {
			return fmt.Errorf("write %s: %w", subPath, werr)
		}
		return nil
	}
	return nil // component not found — nothing to persist.
}

// designComponentMatches reports whether a design component named `logical` is
// the provider identified by `target`, which may be the bare logical name or
// the OC component name `<project>-<logical>`. Mirrors the componentMatches
// helper used elsewhere in the deploy cascade so the durability write lands in
// either form.
func designComponentMatches(logical, project, target string) bool {
	if strings.EqualFold(logical, target) {
		return true
	}
	return strings.EqualFold(project+"-"+logical, target)
}

// ---- Helpers ------------------------------------------------------------

// IsNotFound is sugar for callers that want to distinguish "no artifact yet"
// from a real error.
func IsNotFound(err error) bool { return errors.Is(err, ErrArtifactNotFound) }

// DesignFilesEqual compares two design file maps after trimming whitespace
// from each value. Used by the has-unsaved-changes check.
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

// SplitFrontmatter separates the leading YAML frontmatter block (delimited
// by `---` lines) from the body. If the file has no frontmatter, returns
// ("", content, nil).
func SplitFrontmatter(content string) (fm string, body string, err error) {
	trimmed := strings.TrimLeft(content, " \t\r\n")
	// Strip an optional UTF-8 BOM (U+FEFF) before frontmatter detection.
	trimmed = strings.TrimPrefix(trimmed, "\ufeff")
	if !strings.HasPrefix(trimmed, "---") {
		return "", content, nil
	}
	// Find the closing fence — must be a `---` on its own line after the open.
	rest := trimmed[3:]
	// Skip optional newline directly after opening fence.
	rest = strings.TrimLeft(rest, " \t")
	if !strings.HasPrefix(rest, "\n") && !strings.HasPrefix(rest, "\r\n") {
		// Open fence was not followed by a newline — treat as no frontmatter.
		return "", content, nil
	}
	// Locate the end fence.
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return "", content, fmt.Errorf("frontmatter: unterminated --- block")
	}
	fm = strings.TrimSpace(rest[:end])
	after := rest[end+len("\n---"):]
	// Drop optional newline + spaces after the closing fence.
	after = strings.TrimPrefix(after, "\r")
	after = strings.TrimPrefix(after, "\n")
	return fm, after, nil
}

// joinFrontmatter writes the YAML frontmatter block + body. If the
// frontmatter is empty, returns the body unchanged.
func joinFrontmatter(fm string, body string) string {
	fm = strings.TrimSpace(fm)
	body = strings.TrimLeft(body, "\r\n")
	if fm == "" {
		return body
	}
	return "---\n" + fm + "\n---\n\n" + body
}

// AssembleDesign reconstructs a flat DesignFile from the multi-file working
// tree map. Path separator is `/`. Returns an error if the root `design.md`
// is missing (callers handle that as "no design yet").
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

	// Iterate component dirs in deterministic order.
	componentNames := ComponentNamesIn(files)
	out.Components = make([]models.DesignComponent, 0, len(componentNames))
	for _, name := range componentNames {
		designPath := componentDirPrefix + name + "/" + ComponentDesignFile
		raw, ok := files[designPath]
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

// assembleComponent parses a component's authored design.json and pairs it with
// the sibling openapi.yaml (a separate file, not a design.json key).
func assembleComponent(name, designJSON string, files map[string]string) (models.DesignComponent, error) {
	comp, err := parseComponentDesignJSON(name, designJSON)
	if err != nil {
		return models.DesignComponent{}, err
	}
	openapi := files[componentDirPrefix+name+"/openapi.yaml"]
	if openapi == "" {
		// Fallback: support .yml as well.
		openapi = files[componentDirPrefix+name+"/openapi.yml"]
	}
	comp.OpenAPISpec = openapi
	return comp, nil
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

// SplitDesign takes a flat in-memory design and produces the file map for
// the working tree. The caller is responsible for deleting any
// pre-existing files NOT present in the returned map (e.g. components
// removed across a regeneration).
func SplitDesign(d *DesignFile) (map[string]string, error) {
	if d == nil {
		return nil, fmt.Errorf("nil design")
	}
	out := make(map[string]string, 1+2*len(d.Components))

	// Root design.md — body + optional frontmatter. SourceSpec is encoded
	// in the design tag name (`v<N>-<M>`); we only write it to the file
	// frontmatter when there is some other field that requires the block
	// (currently: skillsApplied per docs/design/skills-system.md). The
	// console's markdown preview strips frontmatter via SplitFrontmatter,
	// so the visible Overview prose is unchanged.
	if len(d.SkillsApplied) > 0 {
		// Sorted copy for stable diffs.
		sortedSkills := append([]string(nil), d.SkillsApplied...)
		sort.Strings(sortedSkills)
		rfm := rootFrontmatter{SkillsApplied: sortedSkills}
		rfmBytes, err := marshalFrontmatter(rfm)
		if err != nil {
			return nil, fmt.Errorf("encode root frontmatter: %w", err)
		}
		out[DesignRootFile] = joinFrontmatter(string(rfmBytes), strings.TrimSpace(d.Overview)+"\n")
	} else {
		out[DesignRootFile] = strings.TrimSpace(d.Overview) + "\n"
	}

	for _, comp := range d.Components {
		if comp.Name == "" {
			return nil, fmt.Errorf("component with empty name")
		}
		base := componentDirPrefix + comp.Name
		designJSON, err := marshalComponentDesignJSON(comp.Name, comp)
		if err != nil {
			return nil, fmt.Errorf("encode component %q design.json: %w", comp.Name, err)
		}
		out[base+"/"+ComponentDesignFile] = string(designJSON)
		if openapi := strings.TrimSpace(comp.OpenAPISpec); openapi != "" {
			out[base+"/openapi.yaml"] = openapi + "\n"
		}
	}
	return out, nil
}

// ComponentDirPath returns the directory path for a given component name
// (relative to specs/design/), used by DeleteDesignDirectory.
func ComponentDirPath(componentName string) string {
	return path.Join(componentDirPrefix, componentName)
}

// marshalFrontmatter encodes v as YAML, but returns an empty string when
// the encoded form is "{}\n" (yaml.Marshal of an all-zero struct).
func marshalFrontmatter(v interface{}) ([]byte, error) {
	out, err := yaml.Marshal(v)
	if err != nil {
		return nil, err
	}
	trimmed := strings.TrimSpace(string(out))
	if trimmed == "{}" {
		return []byte{}, nil
	}
	return []byte(trimmed), nil
}
