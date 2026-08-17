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

package gitfs

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Reference documents (console #383 / ADR-0017) are the files a user attaches
// on the create view. They are TRANSIENT TURN INPUTS, not spec artifacts:
// nothing commits them and they never reach GitHub.
//
// That leaves a delivery problem this file solves. A turn workspace is
// `git archive --format=tar <sha>` out of a bare mirror (snapshots.go) — there
// is no persistent working tree anywhere in the platform, so an untracked or
// .gitignore'd file has no way in. `.gitignore` prevents commits; it does not
// carry bytes. So the store lives beside the mirror, and Ensure OVERLAYS it
// into each freshly extracted snapshot at ReferenceOverlayDir. Agents read the
// same path they would have read if the documents had been committed, which is
// why nothing downstream of the snapshot had to change.

// ReferenceOverlayDir is where a stored reference lands inside a snapshot —
// the same path the feature's v1 committed to, so agents, the `start` skill,
// and the turn's reference list all keep addressing one location.
const ReferenceOverlayDir = "specs/requirements/references"

// MaxReferenceBytes is the per-document cap, checked on the real bytes (the
// console screens for it too; this is the authority). MaxReferenceCount caps
// the set so one project cannot fill an org's quota by itself.
const (
	MaxReferenceBytes = 5 << 20
	MaxReferenceCount = 10
)

// ErrReferenceRejected is a caller error — a bad name, an oversized document,
// or too many of them. Handlers map it to 400.
var ErrReferenceRejected = errors.New("gitfs: reference document rejected")

// referenceNamePattern is the allowed shape of a stored document's name. It is
// deliberately stricter than a filesystem would demand: the name is attacker-
// influenced (it comes off a multipart part), and it is later joined onto both
// the store path and a path inside the snapshot.
var referenceNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$`)

// referenceExtensions are the types the models can actually read.
//
// Two groups, and the split matters downstream. The BINARY group is what the
// model reads NATIVELY as file parts — PDF plus the four image media types the
// Messages API accepts (image/png, image/jpeg, image/gif, image/webp); there is
// no fifth. The TEXT group is everything the model reads as plain text, so it
// is open-ended by nature — these are the formats a requirements brief or an
// API spec actually arrives in.
//
// Deliberately absent: .docx / .xlsx / .pptx. The models do not read Office
// formats natively — those need the code-execution Skills route — so accepting
// one here would store bytes no turn can use.
var referenceExtensions = map[string]bool{
	// Binary, read natively as file parts.
	".pdf": true, ".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true,
	// Text, read as workspace files.
	".md": true, ".txt": true, ".csv": true, ".tsv": true, ".json": true,
	".yaml": true, ".yml": true, ".xml": true, ".html": true, ".rst": true,
}

// ReferenceDoc is one document to store: a bare file name and its raw bytes.
type ReferenceDoc struct {
	Name    string
	Content []byte
}

// validateReferenceName rejects traversal, hidden files, and anything outside
// the readable extensions. A name with no dot has no extension to check, and
// `..` cannot survive the pattern (it starts with a dot).
func validateReferenceName(name string) error {
	if !referenceNamePattern.MatchString(name) {
		return fmt.Errorf("%w: invalid name %q", ErrReferenceRejected, name)
	}
	ext := strings.ToLower(filepath.Ext(name))
	if !referenceExtensions[ext] {
		return fmt.Errorf("%w: unsupported type %q", ErrReferenceRejected, ext)
	}
	return nil
}

// PutReferences replaces the project's whole stored set. Replace, not merge:
// the console uploads once, immediately after create, and a partial merge would
// leave a half-failed retry's documents behind with no surface to notice them
// (the console shows references nowhere after create).
//
// The write is staged in tmp/ and renamed into place, so a reader — Ensure's
// overlay — never observes a half-written set.
func (e *Engine) PutReferences(ctx context.Context, ref RepoRef, docs []ReferenceDoc) (err error) {
	defer func() { err = e.mapDiskErr(err) }()
	dest, err := ReferenceStoreDir(e.root, ref)
	if err != nil {
		return err
	}
	if len(docs) > MaxReferenceCount {
		return fmt.Errorf("%w: at most %d documents (got %d)", ErrReferenceRejected, MaxReferenceCount, len(docs))
	}
	seen := make(map[string]bool, len(docs))
	for _, d := range docs {
		if err := validateReferenceName(d.Name); err != nil {
			return err
		}
		if len(d.Content) > MaxReferenceBytes {
			return fmt.Errorf("%w: %q is larger than %d bytes", ErrReferenceRejected, d.Name, MaxReferenceBytes)
		}
		// Two parts on one name would write the path twice and the later one
		// would silently replace the earlier document.
		if seen[d.Name] {
			return fmt.Errorf("%w: duplicate name %q", ErrReferenceRejected, d.Name)
		}
		seen[d.Name] = true
	}
	if pct := e.DiskUsagePct(); pct >= DiskAdmissionRefusePct {
		return fmt.Errorf("%w (usage=%d%%)", ErrDiskAdmission, pct)
	}

	if err := os.MkdirAll(TmpDir(e.root), 0o755); err != nil {
		return fmt.Errorf("gitfs: create tmp dir: %w", err)
	}
	staging, err := os.MkdirTemp(TmpDir(e.root), "references-*")
	if err != nil {
		return fmt.Errorf("gitfs: reference staging: %w", err)
	}
	defer os.RemoveAll(staging) // no-op after a successful rename

	for _, d := range docs {
		if err := os.WriteFile(filepath.Join(staging, d.Name), d.Content, 0o644); err != nil {
			return fmt.Errorf("gitfs: stage reference %q: %w", d.Name, err)
		}
	}
	// Same widening as a snapshot root: the agents pod reads this content over
	// the shared mount as a different UID, once it is overlaid.
	if err := os.Chmod(staging, 0o755); err != nil {
		return fmt.Errorf("gitfs: chmod reference staging: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return fmt.Errorf("gitfs: create repo dir: %w", err)
	}
	// os.Rename cannot replace a non-empty directory, so the old set moves to
	// trash first. The gap between the two is why a concurrent overlay is
	// best-effort — see overlayReferences.
	if dirExists(dest) {
		if err := os.Rename(dest, e.referenceTrashDest()); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("gitfs: retire previous references: %w", err)
		}
	}
	if err := os.Rename(staging, dest); err != nil {
		return fmt.Errorf("gitfs: publish references: %w", err)
	}
	return nil
}

// referenceTrashDest is a fresh name under trash/ for the retired set; the
// reaper's trash pass purges it on its own schedule.
func (e *Engine) referenceTrashDest() string {
	dir := TrashDir(e.root)
	_ = os.MkdirAll(dir, 0o755)
	staged, err := os.MkdirTemp(dir, "references-*")
	if err != nil {
		// MkdirTemp failed, so nothing exists at this path — the rename below
		// creates it, which is exactly what is wanted.
		return filepath.Join(dir, "references-retired")
	}
	// Reserve the NAME, not the directory: os.Rename needs the destination to
	// not exist.
	_ = os.Remove(staged)
	return staged
}

// ListReferences returns the stored document names, sorted. A project with no
// store (the ordinary case — most attach nothing) returns nil, not an error.
func (e *Engine) ListReferences(ctx context.Context, ref RepoRef) ([]string, error) {
	dir, err := ReferenceStoreDir(e.root, ref)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, e.mapDiskErr(fmt.Errorf("gitfs: list references: %w", err))
	}
	var names []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		// Re-validated on the way out: the store is a directory on a shared
		// volume, and a name that could not have been written by PutReferences
		// has no business being overlaid into a snapshot.
		if validateReferenceName(entry.Name()) != nil {
			continue
		}
		names = append(names, entry.Name())
	}
	sort.Strings(names)
	return names, nil
}

// overlayReferences copies the stored set into a freshly extracted snapshot at
// ReferenceOverlayDir, before it is published. This is what makes a non-git
// document readable by a turn.
//
// Best-effort by design, matching the steer it feeds: a failure here must not
// fail the snapshot, because that would take down every turn on the project —
// including the ones that never attached a document. The cost is that a lost
// overlay is silent (the agent simply interviews as if nothing were attached),
// which is why it is logged at WARN rather than swallowed.
func (e *Engine) overlayReferences(ctx context.Context, ref RepoRef, staging string) {
	names, err := e.ListReferences(ctx, ref)
	if err != nil {
		slog.WarnContext(ctx, "gitfs: references unlistable; snapshot published without them",
			"org", ref.OrgID, "project", ref.ProjectID, "error", err)
		return
	}
	if len(names) == 0 {
		return
	}
	src, err := ReferenceStoreDir(e.root, ref)
	if err != nil {
		return
	}
	dst := filepath.Join(staging, filepath.FromSlash(ReferenceOverlayDir))
	if err := os.MkdirAll(dst, 0o755); err != nil {
		slog.WarnContext(ctx, "gitfs: reference overlay dir; snapshot published without them",
			"org", ref.OrgID, "project", ref.ProjectID, "error", err)
		return
	}
	for _, name := range names {
		if err := copyFile(filepath.Join(src, name), filepath.Join(dst, name)); err != nil {
			slog.WarnContext(ctx, "gitfs: reference not overlaid",
				"org", ref.OrgID, "project", ref.ProjectID, "name", name, "error", err)
		}
	}
}

// copyFile copies one regular file, 0644 — the same mode extractTar gives a
// snapshot blob, so an overlaid document is indistinguishable from a committed
// one to everything downstream.
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	info, err := in.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("gitfs: %q is not a regular file", src)
	}
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
