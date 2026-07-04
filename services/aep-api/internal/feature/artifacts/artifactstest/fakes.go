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

// Package artifactstest holds the exported hand fakes for the artifacts
// feature's cross-feature seam (bff-component-testing.md §6): sibling features
// that consume artifacts (project, requirements, design, task, …) fake it
// here, one pattern, instead of re-rolling ad-hoc fakes per test file.
//
// FakeArtifactService is a moq-style function-field fake: set only the methods
// the test needs; an unset method panics with its name (same convention as the
// generated clients/openchoreo/mocks). Wrap it with the REAL
// artifacts.NewArtifactStore to test store-consuming code paths — the store is
// a decorator over this interface, so the decorator logic stays real.
package artifactstest

import (
	"context"

	"github.com/wso2/aep/aep-api/internal/feature/artifacts"
)

// FakeArtifactService implements artifacts.ArtifactService via settable
// function fields.
type FakeArtifactService struct {
	GetFileFunc                          func(ctx context.Context, orgID, projectID, relPath string) (*artifacts.FileResult, error)
	PutFileFunc                          func(ctx context.Context, orgID, projectID, relPath, content, ifMatch string) (*artifacts.PutResult, error)
	ListRequirementFilesFunc             func(ctx context.Context, orgID, projectID string) (map[string]string, error)
	DeleteRequirementFileFunc            func(ctx context.Context, orgID, projectID, name string) error
	ListDesignFilesFunc                  func(ctx context.Context, orgID, projectID string) (map[string]string, error)
	DeleteDesignFileFunc                 func(ctx context.Context, orgID, projectID, sub string) error
	DeleteDesignDirectoryFunc            func(ctx context.Context, orgID, projectID, sub string) error
	CommitDesignFileFunc                 func(ctx context.Context, orgID, projectID, subPath, content, message string) (string, error)
	SaveRequirementsFunc                 func(ctx context.Context, orgID, projectID string, req artifacts.SaveRequest) (*artifacts.RequirementsSaveResult, error)
	SaveDesignFunc                       func(ctx context.Context, orgID, projectID string, req artifacts.SaveRequest) (*artifacts.DesignSaveResult, error)
	DiscardRequirementsFunc              func(ctx context.Context, orgID, projectID string) (map[string]string, error)
	DiscardDesignFunc                    func(ctx context.Context, orgID, projectID string) (map[string]string, error)
	CaptureRequirementsSnapshotFunc      func(ctx context.Context, orgID, projectID, snapshotID string) (map[string]string, error)
	RestoreRequirementsSnapshotFunc      func(ctx context.Context, orgID, projectID, snapshotID string) (map[string]string, error)
	DeleteRequirementsSnapshotFunc       func(ctx context.Context, orgID, projectID, snapshotID string) error
	ReadFileFromRequirementsSnapshotFunc func(ctx context.Context, orgID, projectID, snapshotID, filename string) (string, bool, error)
	ListRequirementsVersionsFunc         func(ctx context.Context, orgID, projectID string) ([]artifacts.RequirementsVersionInfo, error)
	ListDesignVersionsFunc               func(ctx context.Context, orgID, projectID string) ([]artifacts.DesignVersionInfo, error)
	GetRequirementsAtTagFunc             func(ctx context.Context, orgID, projectID, tag string) (map[string]string, error)
	GetDesignAtTagFunc                   func(ctx context.Context, orgID, projectID, tag string) (map[string]string, error)
}

var _ artifacts.ArtifactService = (*FakeArtifactService)(nil)

func (f *FakeArtifactService) GetFile(ctx context.Context, orgID, projectID, relPath string) (*artifacts.FileResult, error) {
	if f.GetFileFunc == nil {
		panic("artifactstest: GetFile called but GetFileFunc is not set")
	}
	return f.GetFileFunc(ctx, orgID, projectID, relPath)
}

func (f *FakeArtifactService) PutFile(ctx context.Context, orgID, projectID, relPath, content, ifMatch string) (*artifacts.PutResult, error) {
	if f.PutFileFunc == nil {
		panic("artifactstest: PutFile called but PutFileFunc is not set")
	}
	return f.PutFileFunc(ctx, orgID, projectID, relPath, content, ifMatch)
}

func (f *FakeArtifactService) ListRequirementFiles(ctx context.Context, orgID, projectID string) (map[string]string, error) {
	if f.ListRequirementFilesFunc == nil {
		panic("artifactstest: ListRequirementFiles called but ListRequirementFilesFunc is not set")
	}
	return f.ListRequirementFilesFunc(ctx, orgID, projectID)
}

func (f *FakeArtifactService) DeleteRequirementFile(ctx context.Context, orgID, projectID, name string) error {
	if f.DeleteRequirementFileFunc == nil {
		panic("artifactstest: DeleteRequirementFile called but DeleteRequirementFileFunc is not set")
	}
	return f.DeleteRequirementFileFunc(ctx, orgID, projectID, name)
}

func (f *FakeArtifactService) ListDesignFiles(ctx context.Context, orgID, projectID string) (map[string]string, error) {
	if f.ListDesignFilesFunc == nil {
		panic("artifactstest: ListDesignFiles called but ListDesignFilesFunc is not set")
	}
	return f.ListDesignFilesFunc(ctx, orgID, projectID)
}

func (f *FakeArtifactService) DeleteDesignFile(ctx context.Context, orgID, projectID, sub string) error {
	if f.DeleteDesignFileFunc == nil {
		panic("artifactstest: DeleteDesignFile called but DeleteDesignFileFunc is not set")
	}
	return f.DeleteDesignFileFunc(ctx, orgID, projectID, sub)
}

func (f *FakeArtifactService) DeleteDesignDirectory(ctx context.Context, orgID, projectID, sub string) error {
	if f.DeleteDesignDirectoryFunc == nil {
		panic("artifactstest: DeleteDesignDirectory called but DeleteDesignDirectoryFunc is not set")
	}
	return f.DeleteDesignDirectoryFunc(ctx, orgID, projectID, sub)
}

func (f *FakeArtifactService) CommitDesignFile(ctx context.Context, orgID, projectID, subPath, content, message string) (string, error) {
	if f.CommitDesignFileFunc == nil {
		panic("artifactstest: CommitDesignFile called but CommitDesignFileFunc is not set")
	}
	return f.CommitDesignFileFunc(ctx, orgID, projectID, subPath, content, message)
}

func (f *FakeArtifactService) SaveRequirements(ctx context.Context, orgID, projectID string, req artifacts.SaveRequest) (*artifacts.RequirementsSaveResult, error) {
	if f.SaveRequirementsFunc == nil {
		panic("artifactstest: SaveRequirements called but SaveRequirementsFunc is not set")
	}
	return f.SaveRequirementsFunc(ctx, orgID, projectID, req)
}

func (f *FakeArtifactService) SaveDesign(ctx context.Context, orgID, projectID string, req artifacts.SaveRequest) (*artifacts.DesignSaveResult, error) {
	if f.SaveDesignFunc == nil {
		panic("artifactstest: SaveDesign called but SaveDesignFunc is not set")
	}
	return f.SaveDesignFunc(ctx, orgID, projectID, req)
}

func (f *FakeArtifactService) DiscardRequirements(ctx context.Context, orgID, projectID string) (map[string]string, error) {
	if f.DiscardRequirementsFunc == nil {
		panic("artifactstest: DiscardRequirements called but DiscardRequirementsFunc is not set")
	}
	return f.DiscardRequirementsFunc(ctx, orgID, projectID)
}

func (f *FakeArtifactService) DiscardDesign(ctx context.Context, orgID, projectID string) (map[string]string, error) {
	if f.DiscardDesignFunc == nil {
		panic("artifactstest: DiscardDesign called but DiscardDesignFunc is not set")
	}
	return f.DiscardDesignFunc(ctx, orgID, projectID)
}

func (f *FakeArtifactService) CaptureRequirementsSnapshot(ctx context.Context, orgID, projectID, snapshotID string) (map[string]string, error) {
	if f.CaptureRequirementsSnapshotFunc == nil {
		panic("artifactstest: CaptureRequirementsSnapshot called but CaptureRequirementsSnapshotFunc is not set")
	}
	return f.CaptureRequirementsSnapshotFunc(ctx, orgID, projectID, snapshotID)
}

func (f *FakeArtifactService) RestoreRequirementsSnapshot(ctx context.Context, orgID, projectID, snapshotID string) (map[string]string, error) {
	if f.RestoreRequirementsSnapshotFunc == nil {
		panic("artifactstest: RestoreRequirementsSnapshot called but RestoreRequirementsSnapshotFunc is not set")
	}
	return f.RestoreRequirementsSnapshotFunc(ctx, orgID, projectID, snapshotID)
}

func (f *FakeArtifactService) DeleteRequirementsSnapshot(ctx context.Context, orgID, projectID, snapshotID string) error {
	if f.DeleteRequirementsSnapshotFunc == nil {
		panic("artifactstest: DeleteRequirementsSnapshot called but DeleteRequirementsSnapshotFunc is not set")
	}
	return f.DeleteRequirementsSnapshotFunc(ctx, orgID, projectID, snapshotID)
}

func (f *FakeArtifactService) ReadFileFromRequirementsSnapshot(ctx context.Context, orgID, projectID, snapshotID, filename string) (string, bool, error) {
	if f.ReadFileFromRequirementsSnapshotFunc == nil {
		panic("artifactstest: ReadFileFromRequirementsSnapshot called but ReadFileFromRequirementsSnapshotFunc is not set")
	}
	return f.ReadFileFromRequirementsSnapshotFunc(ctx, orgID, projectID, snapshotID, filename)
}

func (f *FakeArtifactService) ListRequirementsVersions(ctx context.Context, orgID, projectID string) ([]artifacts.RequirementsVersionInfo, error) {
	if f.ListRequirementsVersionsFunc == nil {
		panic("artifactstest: ListRequirementsVersions called but ListRequirementsVersionsFunc is not set")
	}
	return f.ListRequirementsVersionsFunc(ctx, orgID, projectID)
}

func (f *FakeArtifactService) ListDesignVersions(ctx context.Context, orgID, projectID string) ([]artifacts.DesignVersionInfo, error) {
	if f.ListDesignVersionsFunc == nil {
		panic("artifactstest: ListDesignVersions called but ListDesignVersionsFunc is not set")
	}
	return f.ListDesignVersionsFunc(ctx, orgID, projectID)
}

func (f *FakeArtifactService) GetRequirementsAtTag(ctx context.Context, orgID, projectID, tag string) (map[string]string, error) {
	if f.GetRequirementsAtTagFunc == nil {
		panic("artifactstest: GetRequirementsAtTag called but GetRequirementsAtTagFunc is not set")
	}
	return f.GetRequirementsAtTagFunc(ctx, orgID, projectID, tag)
}

func (f *FakeArtifactService) GetDesignAtTag(ctx context.Context, orgID, projectID, tag string) (map[string]string, error) {
	if f.GetDesignAtTagFunc == nil {
		panic("artifactstest: GetDesignAtTag called but GetDesignAtTagFunc is not set")
	}
	return f.GetDesignAtTagFunc(ctx, orgID, projectID, tag)
}
