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

	"github.com/wso2/aep/aep-api/internal/platform/ocname"
)

var (
	ErrPipelineEmpty = errors.New("deployment pipeline promotes through no source environment")
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
