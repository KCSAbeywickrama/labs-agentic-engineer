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

package design

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
	"github.com/wso2/aep/aep-api/models"
)

// ErrSpecNotApproved is the design-domain sentinel surfaced (as 409 by the
// controller) when a design is saved before the requirements spec has been
// approved (tagged). Owned by the design feature — it is the only consumer.
var ErrSpecNotApproved = errors.New("spec must be saved (tagged) before generating a design")

// AssembleDesignFromFiles wraps the artifact-store assembler and rejects an
// empty file map. Used to assemble a tagged design file map read out of band.
func AssembleDesignFromFiles(files map[string]string) (*artifacts.DesignFile, error) {
	if len(files) == 0 {
		return nil, fmt.Errorf("decode design: empty file map")
	}
	return artifacts.AssembleDesign(files)
}

// DesignBundle is the file-map view returned to the architecture page. It
// pairs the raw per-file contents (used by the Explorer) with the assembled
// flat Design (used by the cell diagram + downstream code).
type DesignBundle struct {
	Files  map[string]string `json:"files"`
	Design *models.Design    `json:"design"`
}

// DesignService is the read + version surface for the multi-file design
// artifact stored under `specs/design/`. Per the GitHub-direct rework
// (docs/design/agents-generation-migration.md §12.2) the per-file PUT/DELETE,
// component delete, and the architect generate stream are gone — edits are
// frontend drafts committed via the Files API, and generation is the unified
// genai turn endpoint. What remains: read the bundle at HEAD / at a tag, save
// (hard gate → tag at HEAD, then task reconciliation), discard (revert to last
// tag), and version reads.
type DesignService interface {
	GetDesignBundle(ctx context.Context, orgID, projectID string) (*DesignBundle, error)
	GetDesignBundleAtTag(ctx context.Context, orgID, projectID, tag string) (*DesignBundle, error)
	SaveAndProceed(ctx context.Context, orgID, projectID string) (*models.Design, error)
	DiscardChanges(ctx context.Context, orgID, projectID string) (*models.Design, error)
	ListDesignVersions(ctx context.Context, orgID, projectID string) ([]models.ArtifactVersion, error)
}

type designService struct {
	store       *artifacts.ArtifactStore
	artifactSvc artifacts.ArtifactService
	taskSvc     taskReconciler // for SaveAndProceed reconciliation; may be nil in tests
}

// taskReconciler is design_service's narrow consumer port for the task
// feature's reconciliation hook. The full task.TaskService satisfies it.
// Defining it here keeps design_service from importing the task package
// (the reconcile edge is one-way: main wires task.TaskService into this
// setter).
type taskReconciler interface {
	ReconcilePendingForDesignChange(ctx context.Context, orgID, projectID string) error
}

func NewDesignService(
	store *artifacts.ArtifactStore,
	artifactSvc artifacts.ArtifactService,
) *designService {
	return &designService{
		store:       store,
		artifactSvc: artifactSvc,
	}
}

func (s *designService) SetTaskService(taskSvc taskReconciler) {
	s.taskSvc = taskSvc
}

func (s *designService) GetDesign(ctx context.Context, orgID, projectID string) (*models.Design, error) {
	files, err := s.store.ListDesignFiles(ctx, orgID, projectID)
	if err != nil {
		if artifacts.IsNotFound(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read design: %w", err)
	}
	return s.designFromFiles(ctx, orgID, projectID, files)
}

// designFromFiles assembles the models.Design view from an already-listed HEAD
// design file map — the bundle is read from GitHub exactly once per request
// (assembly and the has-unsaved-changes compare reuse the same map). Returns
// (nil, nil) when no design exists yet.
func (s *designService) designFromFiles(ctx context.Context, orgID, projectID string, files map[string]string) (*models.Design, error) {
	designFile, err := s.store.AssembleDesignFrom(files)
	if err != nil {
		return nil, fmt.Errorf("read design: %w", err)
	}
	if designFile == nil {
		return nil, nil
	}

	tag := ""
	revision := 0
	parentReq := ""
	status := "draft"
	var versions []models.ArtifactVersion

	if s.artifactSvc != nil {
		v, err := s.artifactSvc.ListDesignVersions(ctx, orgID, projectID)
		if err != nil {
			slog.WarnContext(ctx, "failed to list design versions", "error", err)
		} else {
			versions = mapDesignVersions(v)
			if len(v) > 0 {
				tag = v[0].Tag
				revision = v[0].DesignRevision
				parentReq = fmt.Sprintf("v%d", v[0].RequirementsVersion)
				status = "approved"
			}
		}
	}

	// has-unsaved-changes: HEAD design files vs latest-tag files (compared as a
	// flat map of trimmed contents). With no tag yet, any content is by
	// definition unsaved (a draft awaiting its first publish).
	unsaved := false
	if tag == "" {
		unsaved = true
	} else if s.artifactSvc != nil {
		tagged, err := s.artifactSvc.GetDesignAtTag(ctx, orgID, projectID, tag)
		if err == nil && !artifacts.DesignFilesEqual(files, tagged) {
			unsaved = true
		}
	}

	// SourceSpec resolution. The file's SourceSpec reflects the current working
	// copy (set at stream time); the latest tag's parent requirements version
	// reflects the last approved snapshot.
	sourceSpec := designFile.SourceSpec
	if sourceSpec == "" {
		sourceSpec = parentReq
	}

	return &models.Design{
		ProjectID:         projectID,
		OrgID:             orgID,
		Overview:          designFile.Overview,
		Components:        designFile.Components,
		Status:            status,
		Version:           revision,
		Versions:          versions,
		HasUnsavedChanges: unsaved,
		SourceSpec:        sourceSpec,
	}, nil
}

func (s *designService) GetDesignAtTag(ctx context.Context, orgID, projectID, tag string) (*models.Design, error) {
	if s.artifactSvc == nil {
		return nil, fmt.Errorf("git client not configured")
	}
	files, err := s.artifactSvc.GetDesignAtTag(ctx, orgID, projectID, tag)
	if err != nil {
		if errors.Is(err, artifacts.ErrArtifactNotFound) {
			return nil, artifacts.ErrDesignNotFound
		}
		return nil, fmt.Errorf("get design at %s: %w", tag, err)
	}
	designFile, err := AssembleDesignFromFiles(files)
	if err != nil {
		return nil, fmt.Errorf("parse design at %s: %w", tag, err)
	}

	parent := ""
	if parentN, _, ok := decodeDesignTag(tag); ok {
		parent = fmt.Sprintf("v%d", parentN)
	}

	return &models.Design{
		ProjectID:  projectID,
		OrgID:      orgID,
		Overview:   designFile.Overview,
		Components: designFile.Components,
		Status:     "approved",
		SourceSpec: parent,
	}, nil
}

// GetDesignBundle returns the HEAD file map alongside the assembled Design (so
// the Explorer can render the tree and the cell diagram can render in one
// round-trip).
func (s *designService) GetDesignBundle(ctx context.Context, orgID, projectID string) (*DesignBundle, error) {
	files, err := s.store.ListDesignFiles(ctx, orgID, projectID)
	if err != nil {
		return nil, err
	}
	if files == nil {
		files = map[string]string{}
	}
	d, err := s.designFromFiles(ctx, orgID, projectID, files)
	if err != nil {
		// If there's no design yet, return an empty bundle (not an error) so
		// the page can render a "no design" state.
		if errors.Is(err, artifacts.ErrDesignNotFound) {
			return &DesignBundle{Files: files, Design: nil}, nil
		}
		return nil, err
	}
	return &DesignBundle{Files: files, Design: d}, nil
}

// GetDesignBundleAtTag returns the file map + assembled Design at a specific
// version tag. Used by the version selector when browsing history.
func (s *designService) GetDesignBundleAtTag(ctx context.Context, orgID, projectID, tag string) (*DesignBundle, error) {
	if s.artifactSvc == nil {
		return nil, fmt.Errorf("git client not configured")
	}
	files, err := s.artifactSvc.GetDesignAtTag(ctx, orgID, projectID, tag)
	if err != nil {
		if errors.Is(err, artifacts.ErrArtifactNotFound) {
			return nil, artifacts.ErrDesignNotFound
		}
		return nil, fmt.Errorf("get design at %s: %w", tag, err)
	}
	d, err := s.GetDesignAtTag(ctx, orgID, projectID, tag)
	if err != nil {
		return nil, err
	}
	return &DesignBundle{Files: files, Design: d}, nil
}

// SaveAndProceed runs the hard save gate and cuts the next `v<N>-<M>` tag at
// HEAD where N is the latest requirements version. Surfaces ErrSpecNotApproved
// (409) when no requirements tag exists yet, and design reconciliation runs
// afterwards so pending tasks for removed components auto-close.
func (s *designService) SaveAndProceed(ctx context.Context, orgID, projectID string) (*models.Design, error) {
	if s.artifactSvc == nil {
		return nil, fmt.Errorf("git client not configured")
	}

	designFile, err := s.store.ReadDesign(ctx, orgID, projectID)
	if err != nil {
		if artifacts.IsNotFound(err) {
			slog.WarnContext(ctx, "design save: design not found at HEAD (pre-gate read) — 404",
				"project", projectID, "error", err)
			return nil, artifacts.ErrDesignNotFound
		}
		return nil, fmt.Errorf("read design: %w", err)
	}
	if designFile == nil {
		// Right after a files-apply that wrote the design, an empty read here is
		// a stale HEAD caught in the act — see the adjacent "bundle read at head"
		// DEBUG line for the commit it resolved.
		slog.WarnContext(ctx, "design save: no design at HEAD (empty or missing design.md) — 404",
			"project", projectID)
		return nil, artifacts.ErrDesignNotFound
	}

	res, err := s.artifactSvc.SaveDesign(ctx, orgID, projectID, artifacts.SaveRequest{
		Message: "Update design",
	})
	if err != nil {
		// Translate the "no requirements baseline" case into the design
		// feature's not-approved sentinel so callers + UIs render the same
		// message they already do for spec-not-approved.
		if errors.Is(err, artifacts.ErrNoRequirementsBaseline) {
			return nil, ErrSpecNotApproved
		}
		return nil, fmt.Errorf("save design: %w", err)
	}

	versions, err := s.artifactSvc.ListDesignVersions(ctx, orgID, projectID)
	if err != nil {
		slog.WarnContext(ctx, "list versions after save failed", "error", err)
	}

	slog.InfoContext(ctx, "design save completed",
		"project", projectID, "tag", res.Tag, "status", res.Status)

	if s.taskSvc != nil {
		if rerr := s.taskSvc.ReconcilePendingForDesignChange(ctx, orgID, projectID); rerr != nil {
			slog.WarnContext(ctx, "task reconciliation after design save failed", "error", rerr)
		}
	}

	return &models.Design{
		ProjectID:  projectID,
		OrgID:      orgID,
		Overview:   designFile.Overview,
		Components: designFile.Components,
		Status:     "approved",
		Version:    res.DesignRevision,
		Versions:   mapDesignVersions(versions),
		SourceSpec: fmt.Sprintf("v%d", res.RequirementsVersion),
	}, nil
}

func (s *designService) DiscardChanges(ctx context.Context, orgID, projectID string) (*models.Design, error) {
	if s.artifactSvc == nil {
		return nil, fmt.Errorf("git client not configured")
	}
	if _, err := s.artifactSvc.DiscardDesign(ctx, orgID, projectID); err != nil {
		return nil, fmt.Errorf("discard design: %w", err)
	}
	return s.GetDesign(ctx, orgID, projectID)
}

func (s *designService) ListDesignVersions(ctx context.Context, orgID, projectID string) ([]models.ArtifactVersion, error) {
	if s.artifactSvc == nil {
		return nil, nil
	}
	v, err := s.artifactSvc.ListDesignVersions(ctx, orgID, projectID)
	if err != nil {
		return nil, fmt.Errorf("list design versions: %w", err)
	}
	return mapDesignVersions(v), nil
}

// decodeDesignTag parses a `v<N>-<M>` design tag and returns (parent, revision, ok).
// Lives in this file so callers don't have to import the artifact tag helpers.
var designTagPattern = regexp.MustCompile(`^v(\d+)-(\d+)$`)

func decodeDesignTag(tag string) (int, int, bool) {
	m := designTagPattern.FindStringSubmatch(tag)
	if m == nil {
		return 0, 0, false
	}
	var n, r int
	if _, err := fmt.Sscanf(m[1], "%d", &n); err != nil || n < 1 {
		return 0, 0, false
	}
	if _, err := fmt.Sscanf(m[2], "%d", &r); err != nil || r < 1 {
		return 0, 0, false
	}
	return n, r, true
}
