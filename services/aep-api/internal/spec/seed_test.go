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
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/aestudiotools/aestudiotest"
	"github.com/wso2/aep/aep-api/internal/platform/specbundle"
)

// UNIT tier for the seed over the in-memory pod: the bundle's files and the
// descriptor's [recreate] table land in one commit, a bad bundle lands
// nothing, and a project that ran a turn is refused.

const seedManifest = `{
  "format": "aespecs/1",
  "producer": { "name": "code-to-spec", "version": "1.0" },
  "product": "Allocations",
  "source": { "repository": "https://github.com/acme/allocations.git", "commit": "d14b825" },
  "createdAt": "2026-10-21T08:00:00Z"
}`

const seedDefinition = `{
  "name": "sales-entity-service",
  "resource": {
    "name": "sales-entity-service",
    "description": "Customers, opportunities and line items.",
    "provider": "the organization's sales entity service, backed by Salesforce",
    "config": [ { "key": "SALES_ENTITY_SERVICE_URL", "description": "Address of the service", "secret": false } ],
    "contract": { "type": "graphql", "path": "schema.graphql", "origin": "derived" }
  }
}`

// seedTree is a bundle the readers accept: one feature, one dependency.
func seedTree() map[string]string {
	return map[string]string{
		specbundle.ManifestPath:                                          seedManifest,
		"specs/requirements/prd.md":                                      "# Allocations\n\n## Features\n\n- [F1 Engagements](features/F1-engagements.md)\n",
		"specs/requirements/features/F1-engagements.md":                  "# F1 Engagements\n\n## User Stories\n\n- F1.1 As a requester, I raise an engagement. *assumed*\n",
		"specs/requirements/sources/backend.md":                          "# backend\n\n- service.bal:1: the API → F1.1\n",
		"specs/design/domain-model.md":                                   "# Data\n\n```mermaid\nerDiagram\n  ENGAGEMENT {\n    string id\n  }\n```\n",
		"specs/design/dependencies/sales-entity-service/dependency.json": seedDefinition,
		"specs/design/dependencies/sales-entity-service/schema.graphql":  "type Query { customers: [String!]! }\n",
		"specs/design/dependencies/sales-entity-service/assumptions.md":  "# What the design assumes about sales-entity-service\n\n- Derived from the client code at d14b825. *assumed*\n",
	}
}

func bundleOf(t *testing.T, tree map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, content := range tree {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// seedLedger answers Newest from a fixed row (nil: the project never ran a turn).
type seedLedger struct{ newest *AgentTurn }

func (l seedLedger) Newest(context.Context, string, string) (*AgentTurn, error) { return l.newest, nil }

// newSeedRig: a project repository holding the create's descriptor and ignore
// file, the pod over it, and a seed service with a fixed clock.
func newSeedRig(t *testing.T, ledger seedLedger) (*aestudiotest.Fake, *SeedService) {
	t.Helper()
	pod := aestudiotest.New()
	raw, err := MarshalDescriptor(NewDescriptor("greeter", "an idea typed at create", "2026-10-21T07:00:00Z"))
	if err != nil {
		t.Fatal(err)
	}
	pod.SeedRepo(descriptorRef, map[string]string{DescriptorPath: string(raw), SpecIgnorePath: SpecIgnoreContent})
	s := NewSeedService(pod, memRepos(t, "default", "p", "https://github.com/acme/greeter"), ledger)
	s.now = func() time.Time { return time.Date(2026, 10, 21, 8, 5, 0, 0, time.UTC) }
	return pod, s
}

func tipFile(t *testing.T, pod *aestudiotest.Fake, path string) string {
	t.Helper()
	raw, _, err := pod.ReadFile(context.Background(), descriptorRef, "", path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(raw)
}

func TestSeed_CommitsTheBundleAndTheProvenanceInOneCommit(t *testing.T) {
	pod, s := newSeedRig(t, seedLedger{})

	if err := s.Seed(context.Background(), "default", "p", bundleOf(t, seedTree())); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	commits := commitCalls(pod)
	if len(commits) != 1 || commits[0].Author != nil {
		t.Fatalf("commits = %+v, want one with no identity", commits)
	}
	for path, content := range seedTree() {
		if path == specbundle.ManifestPath {
			continue
		}
		if got := tipFile(t, pod, path); got != content {
			t.Errorf("%s at tip = %q, want the bundle's", path, got)
		}
	}
	d, err := UnmarshalDescriptor([]byte(tipFile(t, pod, DescriptorPath)))
	if err != nil {
		t.Fatal(err)
	}
	want := RecreateProvenance{
		Producer: "code-to-spec", ProducerVersion: "1.0",
		SourceRepository: "https://github.com/acme/allocations.git", SourceCommit: "d14b825",
		BundleFormat: "aespecs/1", SeededAt: "2026-10-21T08:05:00Z",
	}
	if d.Recreate == nil || *d.Recreate != want {
		t.Errorf("descriptor recreate = %+v, want %+v", d.Recreate, want)
	}
	if d.Idea != "an idea typed at create" || d.Name != "greeter" {
		t.Errorf("the descriptor's own fields were not kept: %+v", d)
	}
	if got := tipFile(t, pod, SpecIgnorePath); got != SpecIgnoreContent {
		t.Errorf("the ignore file moved: %q", got)
	}
}

func TestSeed_TheSameBundleAgainCommitsNothing(t *testing.T) {
	pod, s := newSeedRig(t, seedLedger{})
	if err := s.Seed(context.Background(), "default", "p", bundleOf(t, seedTree())); err != nil {
		t.Fatal(err)
	}
	s.now = func() time.Time { return time.Date(2026, 10, 22, 9, 0, 0, 0, time.UTC) }
	if err := s.Seed(context.Background(), "default", "p", bundleOf(t, seedTree())); err != nil {
		t.Fatalf("second Seed: %v", err)
	}
	if n := len(commitCalls(pod)); n != 1 {
		t.Fatalf("commits = %d, want the first one only", n)
	}
}

func TestSeed_AChangedBundleOverwritesTheEarlierSeed(t *testing.T) {
	pod, s := newSeedRig(t, seedLedger{})
	if err := s.Seed(context.Background(), "default", "p", bundleOf(t, seedTree())); err != nil {
		t.Fatal(err)
	}
	tree := seedTree()
	tree["specs/requirements/prd.md"] += "\nA second pass.\n"
	tree[specbundle.ManifestPath] = strings.Replace(seedManifest, "d14b825", "e25c936", 1)
	if err := s.Seed(context.Background(), "default", "p", bundleOf(t, tree)); err != nil {
		t.Fatalf("second Seed: %v", err)
	}
	if n := len(commitCalls(pod)); n != 2 {
		t.Fatalf("commits = %d, want two", n)
	}
	if got := tipFile(t, pod, "specs/requirements/prd.md"); !strings.Contains(got, "A second pass.") {
		t.Errorf("prd.md was not overwritten: %q", got)
	}
	d, _ := UnmarshalDescriptor([]byte(tipFile(t, pod, DescriptorPath)))
	if d.Recreate == nil || d.Recreate.SourceCommit != "e25c936" {
		t.Errorf("provenance = %+v, want the second bundle's commit", d.Recreate)
	}
}

func TestSeed_RefusedOnceTheProjectRanATurn(t *testing.T) {
	pod, s := newSeedRig(t, seedLedger{newest: &AgentTurn{ID: "t1"}})
	err := s.Seed(context.Background(), "default", "p", bundleOf(t, seedTree()))
	if !errors.Is(err, ErrProjectAlreadyStarted) {
		t.Fatalf("err = %v, want ErrProjectAlreadyStarted", err)
	}
	if n := len(commitCalls(pod)); n != 0 {
		t.Fatalf("commits = %d, want none", n)
	}
}

func TestSeed_ABadBundleCommitsNothing(t *testing.T) {
	cases := map[string]struct {
		mutate func(map[string]string)
		want   string
	}{
		"unknown definition key": {
			mutate: func(tr map[string]string) {
				tr["specs/design/dependencies/sales-entity-service/dependency.json"] = strings.Replace(seedDefinition, `"name": "sales-entity-service",`, `"name": "sales-entity-service", "status": "resolved",`, 1)
			},
			want: "sales-entity-service",
		},
		"missing contract file": {
			mutate: func(tr map[string]string) {
				delete(tr, "specs/design/dependencies/sales-entity-service/schema.graphql")
			},
			want: "schema.graphql is not in the bundle",
		},
		"a registry stub": {
			mutate: func(tr map[string]string) {
				tr["specs/design/dependencies/sales-entity-service/dependency.json"] = `{"name":"sales-entity-service","resource":{"ref":"sales-entity-service","name":"sales-entity-service"}}`
			},
			want: "carries no ref",
		},
		"blank prd": {
			mutate: func(tr map[string]string) { tr["specs/requirements/prd.md"] = "\n" },
			want:   "prd.md is missing or blank",
		},
		"no domain model": {
			mutate: func(tr map[string]string) { delete(tr, "specs/design/domain-model.md") },
			want:   "domain-model.md is missing or blank",
		},
		"duplicate story id": {
			mutate: func(tr map[string]string) {
				tr["specs/requirements/features/F1-engagements.md"] += "- F1.1 As a requester, I raise it twice.\n"
			},
			want: "F1-engagements.md",
		},
		"invalid openapi contract": {
			mutate: func(tr map[string]string) {
				tr["specs/design/dependencies/email-service/dependency.json"] = `{"name":"email-service","resource":{"name":"email-service","provider":"x","contract":{"type":"openapi","path":"openapi.yaml","origin":"derived"}}}`
				tr["specs/design/dependencies/email-service/openapi.yaml"] = "openapi: 3.0.3\ninfo:\n  title: x\n  version: '1'\npaths: {}\n"
			},
			want: "no paths",
		},
		"archive rule": {
			mutate: func(tr map[string]string) { tr["src/main.go"] = "package main" },
			want:   "outside the spec tree",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			pod, s := newSeedRig(t, seedLedger{})
			tree := seedTree()
			tc.mutate(tree)
			err := s.Seed(context.Background(), "default", "p", bundleOf(t, tree))
			var rejected *SeedRejectedError
			reason := ""
			switch {
			case errors.As(err, &rejected):
				reason = rejected.Reason
			case errors.Is(err, specbundle.ErrRejected):
				reason = specbundle.Reason(err)
			default:
				t.Fatalf("err = %v, want a rejection", err)
			}
			if !strings.Contains(reason, tc.want) {
				t.Errorf("reason = %q, want it to contain %q", reason, tc.want)
			}
			if n := len(commitCalls(pod)); n != 0 {
				t.Fatalf("commits = %d, want none", n)
			}
		})
	}
}
