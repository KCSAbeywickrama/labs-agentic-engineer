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
	"errors"
	"fmt"
	"slices"

	"github.com/wso2/aep/aep-api/internal/platform/ocname"
)

const (
	PlatformPipelineNamespace = "default"
	PlatformPipelineName      = "default"
)

var (
	ErrPipelineEmpty           = errors.New("deployment pipeline promotes through no source environment")
	ErrPipelineSourceAmbiguous = errors.New("deployment pipeline has more than one source environment")
	// ErrPipelineCyclic is a nonempty promotion graph with no never-a-target
	// source (every source is also a target). Unlike ErrPipelineEmpty this
	// will not become valid by waiting for setup.
	ErrPipelineCyclic = errors.New("deployment pipeline has no root environment (every source is also a target)")
	// ErrPipelineRefMissing is a Project that names no deployment pipeline.
	ErrPipelineRefMissing = errors.New("project names no deployment pipeline")
	// ErrWriteTargetTooLong is a root environment whose name does not fit the
	// render-name budgets derived from ocname.MaxEnvNameLen.
	ErrWriteTargetTooLong = fmt.Errorf("write target is longer than %d characters", ocname.MaxEnvNameLen)
)

// PipelineSourceEnvironment returns the unique environment that appears as a
// sourceEnvironmentRef and never as a target. That is the pipeline's lowest
// environment — the write-target. Lexicographic order is not used.
func PipelineSourceEnvironment(p *deploymentPipeline) (string, error) {
	pipeID := PlatformPipelineNamespace + "/" + PlatformPipelineName
	if p == nil {
		return "", fmt.Errorf("%s: %w — run deployments/scripts/setup-aep.sh", pipeID, ErrPipelineEmpty)
	}
	sources := map[string]struct{}{}
	targets := map[string]struct{}{}
	for _, path := range p.Spec.PromotionPaths {
		if n := path.SourceEnvironmentRef.Name; n != "" {
			sources[n] = struct{}{}
		}
		for _, t := range path.TargetEnvironmentRefs {
			if t.Name != "" {
				targets[t.Name] = struct{}{}
			}
		}
	}
	var lowest []string
	for s := range sources {
		if _, isTarget := targets[s]; !isTarget {
			lowest = append(lowest, s)
		}
	}
	switch len(lowest) {
	case 1:
		return lowest[0], nil
	case 0:
		if len(sources) > 0 {
			return "", fmt.Errorf("%s: %w", pipeID, ErrPipelineCyclic)
		}
		return "", fmt.Errorf("%s: %w — run deployments/scripts/setup-aep.sh", pipeID, ErrPipelineEmpty)
	default:
		slices.Sort(lowest)
		return "", fmt.Errorf("%s: %w %v", pipeID, ErrPipelineSourceAmbiguous, lowest)
	}
}

// PipelineRoot returns the pipeline's root environment by OpenChoreo's own
// rule (component controller findRootEnvironment): the first promotion path,
// in list order, whose source is never a target. It is the environment
// OpenChoreo auto-deploys a project's components to, so AEP writes there too.
func PipelineRoot(name string, p *deploymentPipeline) (string, error) {
	if p == nil || len(p.Spec.PromotionPaths) == 0 {
		return "", fmt.Errorf("deployment pipeline %q: %w", name, ErrPipelineEmpty)
	}
	targets := map[string]bool{}
	for _, path := range p.Spec.PromotionPaths {
		for _, t := range path.TargetEnvironmentRefs {
			targets[t.Name] = true
		}
	}
	for _, path := range p.Spec.PromotionPaths {
		if src := path.SourceEnvironmentRef.Name; src != "" && !targets[src] {
			return src, nil
		}
	}
	return "", fmt.Errorf("deployment pipeline %q: %w", name, ErrPipelineCyclic)
}

// ChooseOrgDefaultPipeline picks the org's own pipeline when no project is in
// scope: the one named "default" (the name OpenChoreo's REST create path
// defaults a project to), else the sole pipeline. ok is false otherwise.
func ChooseOrgDefaultPipeline(names []string) (string, bool) {
	for _, n := range names {
		if n == "default" {
			return n, true
		}
	}
	if len(names) == 1 {
		return names[0], true
	}
	return "", false
}
