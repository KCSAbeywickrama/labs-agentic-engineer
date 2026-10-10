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

package designspec

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"regexp"

	"github.com/wso2/aep/aep-api/internal/platform/jsonschema"
)

// design-review.schema.json is the vendored embed for the Design step's review
// file (packages/contracts/schemas/design-review.schema.json, generated from
// the Zod designReviewSchema in @aep/agent-stream, whose JSDoc documents the
// file and the content-hash rule its checks use).
//
//go:embed design-review.schema.json
var reviewSchemaJSON []byte

var reviewSchema = jsonschema.MustParse(reviewSchemaJSON)

// ReviewPath is where the review file lives, repo-relative.
const ReviewPath = "specs/design/review.json"

// prototypeArtifact matches a prototype artifact's key (its manifest), the
// only artifact whose comments carry an anchor.
var prototypeArtifact = regexp.MustCompile(`^specs/design/components/[^/]+/prototype\.json$`)

// reviewEntries is the part of a schema-valid review the cross-entry rules read.
type reviewEntries struct {
	Artifacts []struct {
		Path     string `json:"path"`
		Comments []struct {
			ID     string          `json:"id"`
			Status string          `json:"status"`
			Reply  *string         `json:"reply"`
			Anchor json.RawMessage `json:"anchor"`
		} `json:"comments"`
	} `json:"artifacts"`
}

// ValidateDesignReview checks raw review.json bytes against the embedded
// schema plus the rules the schema cannot express, the same list as the
// agent's checkDesignReview: one entry per artifact path, unique comment ids,
// an addressed comment carries its reply, and only a prototype's comments
// carry an anchor. Returns nil when valid, or a *ValidationError.
func ValidateDesignReview(raw []byte) error {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return &ValidationError{Code: CodeInvalidJSON, Message: "content is not valid JSON: " + err.Error()}
	}
	if msgs := jsonschema.Validate(v, reviewSchema); len(msgs) > 0 {
		return &ValidationError{Code: CodeSchemaViolation, Message: msgs[0]}
	}
	var doc reviewEntries
	if err := json.Unmarshal(raw, &doc); err != nil {
		return &ValidationError{Code: CodeInvalidJSON, Message: err.Error()}
	}
	if msg := reviewRuleBroken(doc); msg != "" {
		return &ValidationError{Code: CodeSchemaViolation, Message: msg}
	}
	return nil
}

// reviewRuleBroken returns the first cross-entry rule doc breaks, worded as
// the agent's gate words it, or "".
func reviewRuleBroken(doc reviewEntries) string {
	paths := map[string]bool{}
	ids := map[string]bool{}
	for i, artifact := range doc.Artifacts {
		if paths[artifact.Path] {
			return fmt.Sprintf("artifacts[%d].path: %q appears more than once — keep one entry per artifact.", i, artifact.Path)
		}
		paths[artifact.Path] = true
		for j, c := range artifact.Comments {
			at := fmt.Sprintf("artifacts[%d].comments[%d]", i, j)
			if ids[c.ID] {
				return fmt.Sprintf("%s.id: %q is already used — comment ids are unique in the file.", at, c.ID)
			}
			ids[c.ID] = true
			if c.Status == "addressed" && c.Reply == nil {
				return at + `: an addressed comment carries its one-line "reply".`
			}
			if len(c.Anchor) > 0 && !prototypeArtifact.MatchString(artifact.Path) {
				return at + ".anchor: only a prototype's comments (specs/design/components/<component>/prototype.json) carry an anchor."
			}
		}
	}
	return ""
}
