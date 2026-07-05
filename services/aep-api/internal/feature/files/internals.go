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

package files

import (
	"fmt"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
)

const (
	// specsPrefix scopes the whole Files API — only paths under specs/ are
	// readable or writable through it.
	specsPrefix = "specs/"
	// maxFileBytes caps a single written file. specs/ artifacts (markdown, DSL,
	// component design.json, rendered excalidraw scenes) stay well under this.
	maxFileBytes = 5 << 20 // 5 MiB
	// casAttempts bounds the fast-forward retry on a concurrent writer.
	casAttempts = 4
)

// validatePath enforces the specs/ scope: repo-relative, canonical, no
// traversal, under specs/. Mirrors the artifacts working-tree validator so the
// two agree on what "a spec file" is.
func validatePath(p string) error {
	if p == "" {
		return fmt.Errorf("%w: empty path", ErrPathInvalid)
	}
	clean := path.Clean(p)
	if clean != p {
		return fmt.Errorf("%w: non-canonical path %q", ErrPathInvalid, p)
	}
	if strings.HasPrefix(clean, "/") || strings.HasPrefix(clean, "..") {
		return fmt.Errorf("%w: must be repo-relative under specs/", ErrPathInvalid)
	}
	if !strings.HasPrefix(clean, specsPrefix) {
		return fmt.Errorf("%w: only specs/ paths are accessible via this API", ErrPathInvalid)
	}
	for _, seg := range strings.Split(clean, "/") {
		if seg == ".." {
			return fmt.Errorf("%w: traversal in path", ErrPathInvalid)
		}
	}
	return nil
}

// ---- HEAD-SHA-revalidated tree cache ---------------------------------------
//
// Keyed by "orgID/projectID". Each read revalidates HEAD (one GetRef) and
// reuses the cached blob map when HEAD is unchanged, rebuilding only on a move.
// Bounded to maxTreeCacheEntries projects: on overflow the least-recently-used
// entry is dropped (a miss only costs one GetRef + tree fetch, so a simple
// cap-and-scan beats a real LRU here).

// maxTreeCacheEntries caps the cache at a modest number of (org, project)
// entries so a long-lived process browsing many projects can't grow unbounded.
const maxTreeCacheEntries = 64

type treeEntry struct {
	headSHA  string
	blobs    map[string]gitrepo.TreeEntryResult
	lastUsed time.Time
}

type treeCache struct {
	mu      sync.Mutex
	entries map[string]treeEntry
}

func newTreeCache() *treeCache { return &treeCache{entries: map[string]treeEntry{}} }

func (c *treeCache) matching(key, headSHA string) (map[string]gitrepo.TreeEntryResult, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.entries[key]; ok && e.headSHA == headSHA {
		e.lastUsed = time.Now()
		c.entries[key] = e
		return e.blobs, true
	}
	return nil, false
}

func (c *treeCache) put(key, headSHA string, blobs map[string]gitrepo.TreeEntryResult) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.entries[key]; !exists && len(c.entries) >= maxTreeCacheEntries {
		c.evictOldestLocked()
	}
	c.entries[key] = treeEntry{headSHA: headSHA, blobs: blobs, lastUsed: time.Now()}
}

// evictOldestLocked drops the least-recently-used entry. Caller holds mu.
func (c *treeCache) evictOldestLocked() {
	oldestKey := ""
	var oldest time.Time
	for k, e := range c.entries {
		if oldestKey == "" || e.lastUsed.Before(oldest) {
			oldestKey, oldest = k, e.lastUsed
		}
	}
	if oldestKey != "" {
		delete(c.entries, oldestKey)
	}
}

func (c *treeCache) evict(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, key)
}
