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

import (
	"context"
	"fmt"
	"slices"

	"github.com/wso2/aep/aep-api/internal/platform/reqspec"
)

// GET /projects/{p}/versions (B5): what each version built. A build keeps no
// copy of what it built; the tag does — its annotation names the features
// and product-wide items it carried (build_selection.go), and its tree holds
// each feature's file as it was. The console compares those lines with the
// live ones to say what changed since a feature was last built.

// Version is what one version built.
type Version struct {
	// Name is the tag the build cut.
	Name string
	// Features are the features it carried, picked and pulled in, in ID order.
	Features []VersionFeature
	// ProductWide are the product-wide items it carried, in ID order.
	ProductWide []string
	// HeldBack are carried features' stories it did not build.
	HeldBack []string
}

// VersionFeature is a feature as a version built it.
type VersionFeature struct {
	ID   string
	Name string
	// Lines are its file's lines at the version's tag (reqspec.FeatureLines).
	Lines []reqspec.Line
}

// ListVersions lists what each version built, oldest first. A version cut
// before builds were selections names nothing it built, so it is not listed
// (new model only). One origin fetch (the tag list), then a local read of
// the requirements at each listed tag.
func (s *artifactService) ListVersions(ctx context.Context, orgID, projectID string) ([]Version, error) {
	_, ref, err := s.readyRef(ctx, orgID, projectID)
	if err != nil {
		return nil, err
	}
	tags, err := s.listVersionTags(ctx, ref)
	if err != nil {
		return nil, fmt.Errorf("list tags: %w", err)
	}
	versions := versionTags(tags)
	slices.Reverse(versions)
	out := []Version{}
	for _, t := range versions {
		plan, ok := parseScope(t.Body)
		if !ok {
			continue
		}
		files, err := s.readBundleAtTag(ctx, ref, t.Name, requirementsPrefix, requirementsBundleFilter)
		if err != nil {
			return nil, fmt.Errorf("read requirements at %s: %w", t.Name, err)
		}
		v := Version{Name: t.Name, ProductWide: plan.ProductWide, HeldBack: plan.HeldBack}
		for _, f := range reqspec.Parse(files).Features {
			if slices.Contains(plan.Features, f.ID) {
				v.Features = append(v.Features, VersionFeature{ID: f.ID, Name: f.Name, Lines: reqspec.FeatureLines(files, f.ID)})
			}
		}
		out = append(out, v)
	}
	return out, nil
}
