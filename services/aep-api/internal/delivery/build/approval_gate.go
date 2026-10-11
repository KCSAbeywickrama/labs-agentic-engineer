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

package build

import (
	"context"
	"fmt"
	"strings"

	"github.com/wso2/aep/aep-api/internal/spec"
)

// UnapprovedResourcesError refuses a build that would deploy platform resources
// nobody provisioned or approved. The run provisions a platform resource only
// from the request's approval for it (provisioning.ProvisionForBuild), while
// its deploy gate waits on EVERY platform resource the design declares, so such
// a build would code, then wait out the deploy budget and fail on resources
// nothing was ever going to create. Refused before anything is committed or
// claimed; the edge answers 409 platform_resources_not_approved naming each.
type UnapprovedResourcesError struct {
	// Resources are the dependency names, in design order, each once.
	Resources []string
}

func (e *UnapprovedResourcesError) Error() string {
	return fmt.Sprintf("this build needs platform resources that are neither provisioned nor approved: %s — "+
		"approve them in the build request (the build preflight lists each one)", strings.Join(e.Resources, ", "))
}

// SetProvisionStatus wires the approval gate's readiness read: the SAME
// "already handled" reading the preflight lists platform resources by (a
// resource provisioned or in flight is handled), so the gate refuses exactly
// what the preflight asked the client to approve. Set at the composition root
// after the provisioning service it reads exists, as SetPlanPath is. Nil
// leaves the gate open.
func (s *Service) SetProvisionStatus(r ProvisionStatusReader) {
	s.status = r
}

// approvalGate returns the refusal for a build whose design declares a platform
// resource that is not provisioned or in flight and that the request does not
// approve; nil when every one is handled or approved.
//
// What it lets through is deliberate. An approval is by dependency name, as
// provisioning keys a resource (one binding however many components consume
// it), so one approved input covers every consumer. A resource that is Ready
// or provisioning needs none: a rebuild of a version whose resources exist
// carries no approval and passes, and the readiness read is skipped for an
// approved resource. A nil design reader or readiness reader fails open, like
// the dependency gate.
func (s *Service) approvalGate(ctx context.Context, orgID, projectID string, inputs []BuildInputItem) error {
	if s.design == nil || s.status == nil {
		return nil
	}
	approved := map[string]bool{}
	for _, in := range inputs {
		if in.Kind == "platform-resource" && in.Approved {
			approved[strings.ToLower(in.Dependency)] = true
		}
	}
	comps, err := s.design.ReadDesignComponents(ctx, orgID, projectID)
	if err != nil {
		return &EdgeError{Status: 500, Message: "check platform resource approvals: " + err.Error(), Err: err}
	}
	seen := map[string]bool{}
	var missing []string
	for _, c := range comps {
		for _, d := range c.Dependencies {
			name := strings.ToLower(d.Name)
			if d.Kind != spec.DependencyKindPlatformResource || seen[name] {
				continue
			}
			seen[name] = true
			if approved[name] {
				continue
			}
			handled, rerr := s.status.Ready(ctx, orgID, projectID, d.Name)
			if rerr != nil {
				return &EdgeError{Status: 502, Message: "read platform resource " + d.Name + ": " + rerr.Error(), Err: rerr}
			}
			if !handled {
				missing = append(missing, d.Name)
			}
		}
	}
	if len(missing) > 0 {
		return &UnapprovedResourcesError{Resources: missing}
	}
	return nil
}
