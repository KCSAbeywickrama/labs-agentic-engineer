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

// Package taskplan holds the BFF side of the build-plan tool contract: the Go
// wire struct + decoder for the ok `planBuild` result the plan tap consumes as
// the pod's task-op event (this file), and the build issue the plan becomes
// (build_issue.go). The tool INPUT is validated agent-side: the design agent's
// planBuild tool parses it with the Zod schema (buildPlanInputSchema in
// @aep/agent-stream). packages/contracts/schemas/build-plan.schema.json is
// that schema's published JSON Schema rendering, the shape's reference copy;
// nothing on this side reads it. The tap never re-validates the input; it acts
// only on an ok:true result whose fields the agent already normalized.
package taskplan

import (
	"encoding/json"
	"fmt"
)

// BuildPlanItem is one checklist item: "foundation", a carried feature's ID
// ("F2"), or "spec" for a version that names no features; the design
// components it changes; and the planner's note for the coding agent.
type BuildPlanItem struct {
	Item       string   `json:"item"`
	Components []string `json:"components"`
	Note       string   `json:"note"`
}

// BuildPlanOk is a successful planBuild result: the checklist, in order.
type BuildPlanOk struct {
	OK    bool            `json:"ok"` // always true
	Op    string          `json:"op"` // "build"
	Items []BuildPlanItem `json:"items"`
}

// DecodeBuildPlanOk decodes a successful planBuild result. It errors unless
// ok==true, op=="build" and the checklist is not empty.
func DecodeBuildPlanOk(raw json.RawMessage) (*BuildPlanOk, error) {
	var out BuildPlanOk
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decode planBuild result: %w", err)
	}
	if !out.OK || out.Op != "build" {
		return nil, fmt.Errorf("not a successful planBuild result (ok=%v op=%q)", out.OK, out.Op)
	}
	if len(out.Items) == 0 {
		return nil, fmt.Errorf("a planBuild result with no items")
	}
	return &out, nil
}
