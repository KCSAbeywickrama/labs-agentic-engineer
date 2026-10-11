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

// Command build-plan runs POST /build's feature selection and hard gate, and
// renders the build issue its plan becomes, over a spec folder on disk — for a
// project that is never built (the playground). Every half is aep-api's own
// code: spec.GatedSelection (the selection and the spec gate SaveSpec runs
// before it cuts a tag), spec.PlanSelection, then BuildScope.Issue, which the
// plan service mints from.
//
//	build-plan scope --requirements-dir <dir> --design-dir <dir> [--acceptance-dir <dir>] --version <tag> [selection flags]
//	build-plan issue --requirements-dir <dir> --version <tag> [selection flags] < {"items": [...]}
//
// Selection flags, each a comma-separated ID list: --features and
// --product-wide (the pick; no --features picks every feature that can be
// designed, as POST /build does), --built-features and --built-product-wide
// (what earlier versions carried, as their tags' annotations would say).
//
// scope gates the build as POST /build does — the requirements' own rules,
// the design layout gate, the build gate (coverage, enrichment, artifacts,
// prototypes, roles) and the acceptance tags, over the design and acceptance
// folders (a missing folder holds nothing, as a tag without it would) — and
// prints {"plan": ..., "scope": ...}: what the build carries, and the plan
// turn's scope in the Turn socket contract's shape. issue reads the planner's
// checklist on stdin and prints {"title", "body"}; it runs after scope passed,
// as the plan service mints after the tag is cut, so it gates nothing. A
// refused selection or a failed gate prints each finding on stderr as
// `<path>: <message>` and exits 1; a usage or input error exits 2.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/wso2/aep/aep-api/internal/platform/reqspec"
	"github.com/wso2/aep/aep-api/internal/platform/taskplan"
	"github.com/wso2/aep/aep-api/internal/spec"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

// wireScope is the plan turn's scope as the Turn socket contract spells it.
type wireScope struct {
	Tag         string        `json:"tag"`
	Features    []wireFeature `json:"features,omitempty"`
	ProductWide []wireItem    `json:"productWide,omitempty"`
	HeldBack    []string      `json:"heldBack,omitempty"`
}

type wireFeature struct {
	ID    string   `json:"id"`
	Name  string   `json:"name,omitempty"`
	Needs []string `json:"needs,omitempty"`
}

type wireItem struct {
	ID        string   `json:"id"`
	Text      string   `json:"text,omitempty"`
	AppliesTo []string `json:"appliesTo,omitempty"`
}

type wirePlan struct {
	Features    []string `json:"features"`
	PulledIn    []string `json:"pulledIn"`
	ProductWide []string `json:"productWide"`
	HeldBack    []string `json:"heldBack"`
}

func run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) == 0 || (args[0] != "scope" && args[0] != "issue") {
		_, _ = fmt.Fprintln(stderr, "usage: build-plan scope|issue --requirements-dir <dir> [--design-dir <dir> [--acceptance-dir <dir>]] --version <tag> [--features ..] [--product-wide ..] [--built-features ..] [--built-product-wide ..]")
		return 2
	}
	verb := args[0]
	flags := flag.NewFlagSet("build-plan "+verb, flag.ContinueOnError)
	flags.SetOutput(stderr)
	reqDir := flags.String("requirements-dir", "", "the project's specs/requirements directory (required)")
	version := flags.String("version", "", "the version being built, as its tag would be named (required)")
	features := flags.String("features", "", "the picked features; empty picks every feature that can be designed")
	productWide := flags.String("product-wide", "", "the picked product-wide items")
	builtFeatures := flags.String("built-features", "", "the features earlier versions carried")
	builtProductWide := flags.String("built-product-wide", "", "the product-wide items earlier versions carried")
	var designDir, acceptanceDir *string
	if verb == "scope" {
		designDir = flags.String("design-dir", "", "the project's specs/design directory (required)")
		acceptanceDir = flags.String("acceptance-dir", "", "the project's specs/validation/acceptance directory; absent holds no acceptance files")
	}
	if err := flags.Parse(args[1:]); err != nil {
		return 2
	}
	if *reqDir == "" || *version == "" || flags.NArg() != 0 || (designDir != nil && *designDir == "") {
		flags.Usage()
		return 2
	}
	if err := spec.ValidateVersionName(*version); err != nil {
		_, _ = fmt.Fprintf(stderr, "build-plan: --version %q: %v\n", *version, err)
		return 2
	}
	reqFiles, err := readDir(*reqDir, false)
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "build-plan: %v\n", err)
		return 2
	}

	var pick *reqspec.Pick
	if *features != "" || *productWide != "" {
		pick = &reqspec.Pick{Features: ids(*features), ProductWide: ids(*productWide)}
	}
	built := reqspec.Built{Features: set(ids(*builtFeatures)), ProductWide: set(ids(*builtProductWide))}
	var plan reqspec.BuildPlan
	var scope spec.BuildScope
	if verb == "scope" {
		var designFiles, acceptanceFiles map[string]string
		if designFiles, err = readDir(*designDir, true); err == nil {
			acceptanceFiles, err = readDir(*acceptanceDir, true)
		}
		if err != nil {
			_, _ = fmt.Fprintf(stderr, "build-plan: %v\n", err)
			return 2
		}
		plan, scope, err = spec.GatedSelection(*version, reqFiles, designFiles, acceptanceFiles, built, pick)
	} else {
		plan, scope, err = spec.PlanSelection(*version, reqFiles, built, pick)
	}
	if err != nil {
		var refused *spec.SpecValidationError
		if errors.As(err, &refused) {
			for _, row := range refused.Files {
				_, _ = fmt.Fprintf(stderr, "%s: %s\n", row.Path, row.Message)
			}
			return 1
		}
		_, _ = fmt.Fprintf(stderr, "build-plan: %v\n", err)
		return 2
	}

	var out any
	switch verb {
	case "scope":
		out = map[string]any{
			"plan":  wirePlan{Features: nonNil(plan.Features), PulledIn: nonNil(plan.PulledIn), ProductWide: nonNil(plan.ProductWide), HeldBack: nonNil(plan.HeldBack)},
			"scope": wireScopeOf(scope),
		}
	case "issue":
		var in struct {
			Items []taskplan.BuildPlanItem `json:"items"`
		}
		if err := json.NewDecoder(stdin).Decode(&in); err != nil || len(in.Items) == 0 {
			_, _ = fmt.Fprintln(stderr, `build-plan: stdin must be {"items": [...]} with at least one item`)
			return 2
		}
		issue := scope.Issue(in.Items)
		out = map[string]string{"title": issue.Title(), "body": issue.Body()}
	}
	enc := json.NewEncoder(stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(out); err != nil {
		_, _ = fmt.Fprintf(stderr, "build-plan: %v\n", err)
		return 2
	}
	return 0
}

// readDir maps every file under dir to its content, keyed by its path
// relative to dir; spec keeps what the tag's bundle would hold of them. An
// empty dir, or a missing one when optional, holds nothing.
func readDir(dir string, optional bool) (map[string]string, error) {
	files := map[string]string{}
	if dir == "" {
		return files, nil
	}
	if _, err := os.Stat(dir); optional && errors.Is(err, fs.ErrNotExist) {
		return files, nil
	}
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.Type().IsRegular() {
			return nil
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		files[filepath.ToSlash(rel)] = string(b)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", dir, err)
	}
	return files, nil
}

func wireScopeOf(s spec.BuildScope) wireScope {
	out := wireScope{Tag: s.Tag, HeldBack: s.HeldBack}
	for _, f := range s.Features {
		out.Features = append(out.Features, wireFeature{ID: f.ID, Name: f.Name, Needs: f.Needs})
	}
	for _, it := range s.ProductWide {
		out.ProductWide = append(out.ProductWide, wireItem{ID: it.ID, Text: strings.TrimSpace(it.Text), AppliesTo: it.AppliesTo})
	}
	return out
}

func ids(list string) []string {
	var out []string
	for _, id := range strings.Split(list, ",") {
		if id = strings.TrimSpace(id); id != "" {
			out = append(out, id)
		}
	}
	return out
}

func set(list []string) map[string]bool {
	out := map[string]bool{}
	for _, id := range list {
		out[id] = true
	}
	return out
}

func nonNil(list []string) []string {
	if list == nil {
		return []string{}
	}
	return list
}
