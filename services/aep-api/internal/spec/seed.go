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

// The seed: a project recreated from existing code starts from a spec bundle
// (`seed-project`), not from an interview.
//
// A developer skill (`code-to-spec`) reads the product's code and writes what
// `/start` and the interviews would otherwise elicit from a person: the
// requirements with their coverage files, the domain model, and the upstream
// dependency definitions with their contracts. It packs them as an `.aespecs`
// bundle (platform/specbundle), which the console attaches at create. This
// service opens the bundle, holds its content to the same readers the save
// gates use, and commits it in ONE commit through the org's AE Studio,
// together with a `[recreate]` table in the project descriptor. That table is
// the fact the rest of the platform keys on: the kickoff reads it and never
// fires `/start`, and the status poll surfaces it so the console offers
// `/recreate`, the first design of a recreated product.
//
// A raw commit applies none of the Room's write rules, so the bundle reader
// enforces the path and size rules itself and the readers below refuse what
// a save would refuse; nothing is committed on any refusal. Seeding again
// before any turn ran overwrites the seeded files; after a turn it is refused,
// because the agent or the user may have moved them.

package spec

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"
	"time"

	"github.com/wso2/aep/aep-api/internal/platform/reqspec"
	"github.com/wso2/aep/aep-api/internal/platform/specbundle"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// ErrProjectAlreadyStarted reports that the project has run an agent turn, so
// a seed would overwrite work the agent or the user did.
var ErrProjectAlreadyStarted = errors.New("project has already run an agent turn")

// SeedRejectedError is a bundle whose spec content the platform's readers
// refuse: the message names the file and the rule, worded for the 400.
type SeedRejectedError struct{ Reason string }

func (e *SeedRejectedError) Error() string { return "seed: bundle rejected: " + e.Reason }

func seedRejected(format string, a ...any) error {
	return &SeedRejectedError{Reason: fmt.Sprintf(format, a...)}
}

// SeedService commits a project's specs from a bundle.
type SeedService struct {
	git    sourcecontrol.Git
	repos  sourcecontrol.ProjectRepoRows
	ledger KickoffLedger
	now    func() time.Time
}

// NewSeedService wires the seed over the Git port, the project's repository
// row and the finished-turn ledger (the already-started guard).
func NewSeedService(git sourcecontrol.Git, repos sourcecontrol.ProjectRepoRows, ledger KickoffLedger) *SeedService {
	return &SeedService{git: git, repos: repos, ledger: ledger, now: time.Now}
}

// Seed validates archive and commits it. Errors: ErrProjectAlreadyStarted,
// specbundle.ErrRejected (the archive), *SeedRejectedError (its content),
// sourcecontrol.ErrRepoNotFound, else the pod's.
func (s *SeedService) Seed(ctx context.Context, orgID, projectID string, archive []byte) error {
	newest, err := s.ledger.Newest(ctx, orgID, projectID)
	if err != nil {
		return fmt.Errorf("read newest turn: %w", err)
	}
	if newest != nil {
		return ErrProjectAlreadyStarted
	}
	b, err := specbundle.Open(archive)
	if err != nil {
		return err
	}
	if err := validateSeedFiles(b.Files); err != nil {
		return err
	}
	ref, _, err := sourcecontrol.RepoRefFor(ctx, s.repos, orgID, projectID)
	if err != nil {
		return err
	}
	m := b.Manifest
	provenance := RecreateProvenance{
		Producer:         m.Producer.Name,
		ProducerVersion:  m.Producer.Version,
		Product:          m.Product,
		SourceRepository: m.Source.Repository,
		SourceCommit:     m.Source.Commit,
		SeededAt:         s.now().UTC().Format(time.RFC3339),
	}
	paths := slices.Sorted(maps.Keys(b.Files))
	message := fmt.Sprintf("chore: seed specs from %s %s (%s, %s@%s)",
		m.Producer.Name, m.Producer.Version, m.Product, m.Source.Repository, m.Source.Commit)
	_, err = sourcecontrol.CommitRetrying(ctx, s.git, ref, func(ctx context.Context) (sourcecontrol.CommitRequest, error) {
		shas, existing, err := s.tipFiles(ctx, ref, append(slices.Clone(paths), DescriptorPath))
		if err != nil {
			return sourcecontrol.CommitRequest{}, err
		}
		descriptor := NewDescriptor(projectID, "", provenance.SeededAt)
		if raw, ok := existing[DescriptorPath]; ok {
			if descriptor, err = UnmarshalDescriptor([]byte(raw)); err != nil {
				return sourcecontrol.CommitRequest{}, fmt.Errorf("the project descriptor does not parse: %w", err)
			}
		}
		req := sourcecontrol.CommitRequest{Message: message}
		for _, p := range paths {
			content := string(b.Files[p])
			if current, ok := existing[p]; ok && current == content {
				continue // the blob is already there; a re-seed rewrites nothing it need not
			}
			req.Writes = append(req.Writes, sourcecontrol.FileWrite{Path: p, Content: content, BaseSHA: shas[p]})
		}
		if len(req.Writes) == 0 && descriptor.Recreate != nil && sameSeed(*descriptor.Recreate, provenance) {
			return sourcecontrol.CommitRequest{}, nil // the same bundle again: nothing to commit
		}
		descriptor.Recreate = &provenance
		raw, err := MarshalDescriptor(descriptor)
		if err != nil {
			return sourcecontrol.CommitRequest{}, err
		}
		req.Writes = append([]sourcecontrol.FileWrite{{Path: DescriptorPath, Content: string(raw), BaseSHA: shas[DescriptorPath]}}, req.Writes...)
		return req, nil
	})
	return err
}

// tipFiles reads, at the tip, the blob shas of every path (the commit's
// baseShas) and the content of those among paths that exist: one head
// resolution, then two sha-addressed reads. An empty repository reads as
// nothing there.
func (s *SeedService) tipFiles(ctx context.Context, ref sourcecontrol.RepoRef, paths []string) (map[string]string, map[string]string, error) {
	head, err := s.git.Head(ctx, ref, "")
	if errors.Is(err, sourcecontrol.ErrRefNotFound) {
		return map[string]string{}, map[string]string{}, nil
	}
	if err != nil {
		return nil, nil, fmt.Errorf("resolve head: %w", err)
	}
	entries, _, err := s.git.List(ctx, ref, head)
	if err != nil {
		return nil, nil, fmt.Errorf("list tree at head: %w", err)
	}
	shas := make(map[string]string, len(entries))
	for _, e := range entries {
		shas[e.Path] = e.SHA
	}
	existing, _, err := s.git.ReadBundle(ctx, ref, head, sourcecontrol.BundleFilter{Paths: paths})
	if err != nil {
		return nil, nil, fmt.Errorf("read files at head: %w", err)
	}
	return shas, existing, nil
}

// sameSeed: the same bundle, whenever it was seeded.
func sameSeed(a, b RecreateProvenance) bool {
	a.SeededAt, b.SeededAt = "", ""
	return a == b
}

// domainModelFile is the data model's file under specs/design/ (the design
// skill's step 3), which a seed must carry: the first design converges it.
const domainModelFile = "domain-model.md"

// The contract origins a seeded definition may carry: its own, never the
// registry's, which only a save's completion writes.
var seededContractOrigins = map[string]bool{"": true, "provider": true, "derived": true, "assumed": true}

// validateSeedFiles holds the bundle's content to the readers the save gates
// use: the requirements must have a main document and consistent IDs, the
// domain model must be there, and every dependency definition must parse
// strictly, carry its contract file, and be the project's own (no `ref`, no
// consumption instructions — the organization's fields, which a save fills).
func validateSeedFiles(files map[string][]byte) error {
	reqFiles := map[string]string{}
	designFiles := map[string]string{}
	for p, content := range files {
		if rel, ok := strings.CutPrefix(p, requirementsPrefix); ok {
			reqFiles[rel] = string(content)
		} else if rel, ok := strings.CutPrefix(p, designPrefix); ok {
			designFiles[rel] = string(content)
		}
	}
	if strings.TrimSpace(reqFiles[requirementsMainFile]) == "" {
		return seedRejected("%s/%s is missing or blank", RequirementsDir, requirementsMainFile)
	}
	if problems := reqspec.Parse(reqFiles).Problems(); len(problems) > 0 {
		p := problems[0]
		return seedRejected("%s/%s: %s", RequirementsDir, p.Path, p.Message)
	}
	if strings.TrimSpace(designFiles[domainModelFile]) == "" {
		return seedRejected("%s/%s is missing or blank", DesignDir, domainModelFile)
	}
	defs, err := assembleDependencyDefinitions(designFiles)
	if err != nil {
		return seedRejected("%s/%s", DesignDir, err.Error())
	}
	if names := DependencyNamesIn(designFiles); len(names) != len(defs) {
		for _, name := range names {
			if _, ok := designFiles[dependencyDesignKey(name)]; !ok {
				return seedRejected("%s/%s%s/ has no %s", DesignDir, dependencyDirPrefix, name, DependencyDesignFile)
			}
		}
	}
	for _, def := range defs {
		at := DesignDir + "/" + dependencyDesignKey(def.Name)
		switch {
		case def.Resource.Ref != "":
			return seedRejected("%s: a seeded definition carries no ref; the design reuses the organization's records itself", at)
		case def.Resource.ConsumptionInstructions != "":
			return seedRejected("%s: consumptionInstructions is the organization's field", at)
		case def.Resource.Contract == nil:
			continue
		}
		c := def.Resource.Contract
		if !seededContractOrigins[c.Origin] {
			return seedRejected("%s: contract.origin %q is not one a seeded definition may carry", at, c.Origin)
		}
		key := dependencyDirPrefix + def.Name + "/" + c.Path
		raw, ok := designFiles[key]
		if !ok {
			return seedRejected("%s: the contract file %s is not in the bundle", at, c.Path)
		}
		if c.Type == "openapi" {
			if _, err := ValidateOpenAPI([]byte(raw)); err != nil {
				return seedRejected("%s/%s: %s", DesignDir, key, err.Error())
			}
		}
	}
	return nil
}
