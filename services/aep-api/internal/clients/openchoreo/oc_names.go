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

package openchoreo

import (
	"fmt"
	"strings"
	"time"

	"github.com/wso2/aep/aep-api/internal/platform/k8sname"
)

// unixMilliDigits is the width of the timestamp NewBuildRunName appends. Thirteen
// digits covers every instant from 2001 to 2286.
const unixMilliDigits = 13

// buildRunNameWidths cap the readable head. See delivery's equivalents: both
// halves are recoverable in full from the run's own labels, so the cap costs
// readability and nothing else.
const (
	runNameProjectWidth   = 18
	runNameComponentWidth = 18
)

// NewBuildRunName produces the WorkflowRun metadata.name for a new build of
// (projectID, componentName). Stable shape so the BFF can pre-compute the
// name and stage the per-WorkflowRun build Secret (named
// `<runName>-git-secret`) before POSTing the WorkflowRun — see
// docs/design/build-credential-injection.md. The millisecond timestamp
// keeps successive triggers unique.
//
// Composed through k8sname.Bounded against MaxLabelValueLen, for the reason
// given there: the binding budget on a run name is the 63-char label-value
// limit, not the 253-char name limit, and a name over it is accepted by
// OpenChoreo and then never builds. Formatting the parts directly used to leave
// this path with ZERO headroom (a 32-char project and a 16-char component land
// on exactly 63), so any slightly longer name would have broken the console's
// Build button the same silent way.
func NewBuildRunName(projectName, componentName string) string {
	head := k8sname.Bounded(k8sname.MaxLabelValueLen-1-unixMilliDigits,
		k8sname.Capped(projectName, runNameProjectWidth),
		k8sname.Capped(componentName, runNameComponentWidth),
	)
	return fmt.Sprintf("%s-%d", head, time.Now().UnixMilli())
}

// ScopedComponentName is the k8s metadata name OC uses for a component. OC
// components across every project in an org share a single k8s namespace, so
// two projects can't hold the same component name unless we disambiguate.
// We prefix with the project name; the user's original name survives as the
// display-name annotation.
//
// Callers must always pass the friendly component name (never a previously
// scoped name) — call this exactly once, at the OC boundary.
func ScopedComponentName(projectName, componentName string) string {
	if projectName == "" {
		return componentName
	}
	return projectName + "-" + componentName
}

// FriendlyComponentName reverses ScopedComponentName using the owner project
// recorded on the OC component. Safe on legacy rows that were never prefixed.
func FriendlyComponentName(k8sName, projectName string) string {
	if projectName == "" {
		return k8sName
	}
	return strings.TrimPrefix(k8sName, projectName+"-")
}
