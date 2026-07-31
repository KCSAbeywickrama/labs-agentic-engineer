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

package eventcore

// WIRING CONFORMANCE.
//
// A component whose design declares a database, and whose shipped workload.yaml
// declares no resource at all, BUILDS. The image compiles, the pod starts, an
// in-process store works, and nothing fails until someone notices the data does
// not survive a restart. That is exactly how a run once shipped SQLite on a
// container filesystem for a component whose design named postgres-cnpg.
//
// So the platform checks it, deterministically, with no LLM involved: the design
// says which OC resources a component consumes (each dependency's stamped
// `wiring.ref`), the shipped workload.yaml says which it declared, and the
// difference is a defect. Nothing about that comparison needs a model, a cluster
// read or a heuristic.
//
// WHERE it runs is the merged-PR fan-out, which fits the policy this package
// already follows (see decideAutoMerge): there is no verification before the
// merge, because the merge is what triggers verification — and a defect it finds
// mints a fix issue into the same milestone, which the next cycle works like any
// other. Blocking the merge on this would gate the merge on the thing it exists
// to cause.
//
// It NEVER fails the fan-out. A build that would have run still runs: a missing
// resource declaration is a defect to fix, not a reason to withhold the build
// output that tells the agent whether its code even compiles.

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// workloadPath is where a component's workload descriptor lives, relative to its
// App Path. The coding agent authors it there; OpenChoreo reads it from there.
const workloadPath = "workload.yaml"

// checkWiringConformance compares one component's design-declared resource refs
// against the workload.yaml it shipped, and mints a fix issue naming whatever is
// missing.
//
// Every failure path is a logged no-op. The check is a safety net; a net that can
// fail a merge fan-out is worse than the hole it covers.
func (e *Events) checkWiringConformance(ctx context.Context, run *delivery.MilestoneRun, component string) {
	if e.p.Design == nil || e.p.Workloads == nil || run == nil {
		return
	}
	declared, err := e.p.Design.DeclaredResources(ctx, run.OrgID, run.ProjectID)
	if err != nil {
		slog.WarnContext(ctx, "eventcore: read declared resources for conformance failed",
			"project", run.ProjectID, "component", component, "error", err)
		return
	}
	want, ok := declared[component]
	if !ok || len(want.Refs) == 0 {
		return // nothing declared ⇒ nothing to conform to
	}

	path := workloadPath
	if want.AppPath != "" {
		path = want.AppPath + "/" + workloadPath
	}
	content, found, err := e.p.Workloads.ReadFile(ctx, run.OrgID, run.ProjectID, path)
	if err != nil {
		slog.WarnContext(ctx, "eventcore: read workload.yaml for conformance failed",
			"project", run.ProjectID, "component", component, "path", path, "error", err)
		return
	}
	if !found {
		// A component with no workload.yaml at all is a separate, louder failure
		// the build itself reports; do not double-report it as a wiring defect.
		slog.WarnContext(ctx, "eventcore: no workload.yaml to check for conformance",
			"project", run.ProjectID, "component", component, "path", path)
		return
	}

	missing := missingResourceRefs(want.Refs, content)
	if len(missing) == 0 {
		return
	}
	slog.WarnContext(ctx, "eventcore: shipped workload.yaml is missing declared resources",
		"project", run.ProjectID, "component", component, "missing", missing)
	if _, err := e.mintUnwiredResourceIssue(ctx, run, component, path, missing); err != nil {
		slog.WarnContext(ctx, "eventcore: mint unwired-resource issue failed",
			"project", run.ProjectID, "component", component, "error", err)
	}
}

// missingResourceRefs returns the declared refs absent from the workload
// descriptor's `dependencies.resources[]`, sorted for a stable issue body.
//
// An unparseable descriptor yields every ref as missing rather than none: the
// agent authored a file OpenChoreo cannot read, so no resource is wired,
// whatever the bytes intended.
func missingResourceRefs(declaredRefs []string, workloadYAML string) []string {
	var doc struct {
		Dependencies struct {
			Resources []struct {
				Ref string `yaml:"ref"`
			} `yaml:"resources"`
		} `yaml:"dependencies"`
	}
	shipped := map[string]bool{}
	if err := yaml.Unmarshal([]byte(workloadYAML), &doc); err == nil {
		for _, r := range doc.Dependencies.Resources {
			shipped[strings.TrimSpace(r.Ref)] = true
		}
	}
	var missing []string
	for _, ref := range declaredRefs {
		if !shipped[ref] {
			missing = append(missing, ref)
		}
	}
	sort.Strings(missing)
	return missing
}

// mintUnwiredResourceIssue files the fix issue for a component that shipped
// without declaring resources its design consumes.
//
// The body names the refs and points at where the correct block lives — the
// dependency's own `wiring` in design.json — because the failure mode this
// catches is an agent that could not find that block and invented a substitute.
// It carries the agent-work label so the next cycle picks it up like any other
// work, and dedupes on (component, refs) so a redelivered webhook or a second
// merge touching the same component files nothing new.
func (e *Events) mintUnwiredResourceIssue(ctx context.Context, run *delivery.MilestoneRun,
	component, path string, missing []string) (int, error) {
	list := "`" + strings.Join(missing, "`, `") + "`"
	body := fmt.Sprintf(
		"Component **%s** declares platform/external resources in its design that its shipped `%s` does not consume, so OpenChoreo injects nothing for them and the component cannot be using them.\n\n"+
			"Missing from `dependencies.resources`: %s\n\n"+
			"Each one's exact entry is already resolved for you: read the `wiring` object on that dependency in `specs/design/components/%s/design.json` and copy its `ref` and `envBindings` into `%s` verbatim. "+
			"Then make the code read those env vars — if it currently persists to a local file, an in-process store, or any other substitute technology, replace that with the declared resource.\n\n"+
			"Do not invent a ref or an env-var name, and do not remove the dependency from the design to make this pass.",
		component, path, list, component, path)

	return e.mint(ctx, run.OrgID, run.ProjectID, sourcecontrol.CreateIssueRequest{
		Title:     fmt.Sprintf("Wire the declared resources for %s", component),
		Body:      body,
		Labels:    []string{delivery.LabelAgentWork},
		Milestone: &run.MilestoneNumber,
		DedupeKey: fmt.Sprintf("aep unwired %s %s", component, strings.Join(missing, ",")),
	})
}
