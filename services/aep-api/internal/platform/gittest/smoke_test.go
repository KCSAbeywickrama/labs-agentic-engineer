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

package gittest

// Smoke tests proving the harness end to end: clone/seed/tag over the file://
// remote, and a full Git Data API round-trip against the same bare repo.
//
// The GitData server is driven here with net/http requests that MIRROR the
// git host client's wire format (clients/github/artifacts.go) — same paths,
// same JSON field names. The artifacts save-flow tests re-drive these same
// endpoints through the REAL clients/github client via WithAPIBase; matching
// the wire format by hand here is what independently pins the contract.

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// --- Remote: clone / seed / tag ---------------------------------------------

func TestRemote_CloneReflectsSeed(t *testing.T) {
	t.Parallel()
	r := NewRemote(t, WithSeed(map[string]string{
		"specs/requirements/main.md": "# hello",
	}, "seed"))

	clone := r.Clone(t)
	got, err := os.ReadFile(filepath.Join(clone, "specs", "requirements", "main.md"))
	if err != nil {
		t.Fatalf("read cloned file: %v", err)
	}
	if string(got) != "# hello" {
		t.Fatalf("cloned content = %q, want %q", got, "# hello")
	}
}

func TestRemote_SeedAndTagVisibleAfterFetch(t *testing.T) {
	t.Parallel()
	r := NewRemote(t, WithSeed(map[string]string{"README.md": "root"}, "seed"))

	newSHA := r.Seed(t, map[string]string{"specs/requirements/main.md": "reqs"}, "add reqs")
	r.Tag(t, "v1", "Requirements v1")

	if head := r.HeadSHA(t); head != newSHA {
		t.Fatalf("HeadSHA = %s, want seeded %s", head, newSHA)
	}
	if tags := r.Tags(t); len(tags) != 1 || tags[0] != "v1" {
		t.Fatalf("Tags = %v, want [v1]", tags)
	}
	if content := r.FileAt(t, "main", "specs/requirements/main.md"); content != "reqs" {
		t.Fatalf("FileAt(main) = %q, want %q", content, "reqs")
	}

	// A fresh clone sees the seeded commit and tag — i.e. they really landed in
	// the bare repo and propagate over the file:// protocol (as `git fetch`
	// would).
	clone := r.Clone(t)
	if _, err := os.Stat(filepath.Join(clone, "specs", "requirements", "main.md")); err != nil {
		t.Fatalf("seeded file missing in clone: %v", err)
	}
	tagsOut, err := runGit(clone, nil, nil, "tag", "-l")
	if err != nil {
		t.Fatalf("git tag -l in clone: %v", err)
	}
	if got := bytes.TrimSpace([]byte(tagsOut)); string(got) != "v1" {
		t.Fatalf("clone tags = %q, want v1", got)
	}
}

// --- GitData: full save round-trip ------------------------------------------

func TestGitData_SaveRoundTrip(t *testing.T) {
	t.Parallel()
	r := NewRemote(t, WithSeed(map[string]string{
		"specs/requirements/main.md": "# original",
	}, "seed"))
	c := newGitDataClient(t, GitDataServer(t, r))

	// The exact sequence save_via_api.go drives:
	// GetRef → GetCommit → GetTree → CreateBlob → CreateTree → CreateCommit → UpdateRef.
	mainSHA := c.getRef("heads/main")
	if mainSHA != r.HeadSHA(t) {
		t.Fatalf("GetRef = %s, want HeadSHA %s", mainSHA, r.HeadSHA(t))
	}
	treeSHA := c.getCommitTree(mainSHA)
	if paths := c.getTreePaths(treeSHA); !contains(paths, "specs/requirements/main.md") {
		t.Fatalf("GetTree paths = %v, want to contain main.md", paths)
	}

	blobSHA := c.createBlob([]byte("# new content"))
	newTree := c.createTree(treeSHA, []treeEntry{{
		Path: "specs/requirements/new.md", Mode: "100644", Type: "blob", SHA: &blobSHA,
	}})
	newCommit := c.createCommit(commitReq{
		Message: "add new.md", Tree: newTree, Parents: []string{mainSHA},
		Author:    &ident{Name: "Alice", Email: "alice@aep.test"},
		Committer: &ident{Name: "Alice", Email: "alice@aep.test"},
	})
	c.updateRef("heads/main", newCommit, false, http.StatusOK)

	// New commit is visible in the bare repo AND in a fresh clone.
	if head := r.HeadSHA(t); head != newCommit {
		t.Fatalf("after UpdateRef HeadSHA = %s, want %s", head, newCommit)
	}
	if got := r.FileAt(t, "main", "specs/requirements/new.md"); got != "# new content" {
		t.Fatalf("FileAt(new.md) = %q, want %q", got, "# new content")
	}
	clone := r.Clone(t)
	if _, err := os.Stat(filepath.Join(clone, "specs", "requirements", "new.md")); err != nil {
		t.Fatalf("new.md missing in clone after save: %v", err)
	}
}

func TestGitData_TreeDeletionViaNullSHA(t *testing.T) {
	t.Parallel()
	r := NewRemote(t, WithSeed(map[string]string{
		"specs/requirements/main.md": "keep",
		"specs/requirements/gone.md": "delete me",
	}, "seed"))
	c := newGitDataClient(t, GitDataServer(t, r))

	mainSHA := c.getRef("heads/main")
	treeSHA := c.getCommitTree(mainSHA)

	// sha:null entry removes the path from the resulting tree.
	newTree := c.createTree(treeSHA, []treeEntry{{
		Path: "specs/requirements/gone.md", Mode: "100644", Type: "blob", SHA: nil,
	}})
	newCommit := c.createCommit(commitReq{Message: "rm gone.md", Tree: newTree, Parents: []string{mainSHA}})
	c.updateRef("heads/main", newCommit, false, http.StatusOK)

	if _, err := r.exec(nil, nil, "cat-file", "blob", "main:specs/requirements/gone.md"); err == nil {
		t.Fatal("gone.md still present after sha:null deletion")
	}
	if got := r.FileAt(t, "main", "specs/requirements/main.md"); got != "keep" {
		t.Fatalf("survivor main.md = %q, want %q", got, "keep")
	}
}

// --- GitData: CAS conflict + BeforeUpdateRef hook ---------------------------

func TestGitData_UpdateRefNonFastForwardIs422(t *testing.T) {
	t.Parallel()
	r := NewRemote(t, WithSeed(map[string]string{"specs/requirements/main.md": "v0"}, "seed"))
	gd := GitDataServer(t, r)
	c := newGitDataClient(t, gd)

	// Client builds a commit on top of the main it observed (C0).
	c0 := c.getRef("heads/main")
	tree := c.getCommitTree(c0)
	blob := c.createBlob([]byte("client edit"))
	clientTree := c.createTree(tree, []treeEntry{{Path: "specs/requirements/a.md", Mode: "100644", Type: "blob", SHA: &blob}})
	clientCommit := c.createCommit(commitReq{Message: "client", Tree: clientTree, Parents: []string{c0}})

	// An external writer advances main to a DIVERGENT commit exactly once, right
	// before the ref is moved — so the client's commit is no longer a
	// fast-forward. sync.Once keeps a retrying caller from thrashing forever.
	var once sync.Once
	var hookFired bool
	gd.BeforeUpdateRef = func() {
		once.Do(func() {
			hookFired = true
			r.Seed(t, map[string]string{"specs/requirements/external.md": "external"}, "external push")
		})
	}

	// force=false → the server returns 422, the wire condition github_artifacts.go
	// maps to ErrRefNotFastForward.
	c.updateRef("heads/main", clientCommit, false, http.StatusUnprocessableEntity)

	if !hookFired {
		t.Fatal("BeforeUpdateRef hook did not fire")
	}
	// main is the external commit, not the client's — the CAS genuinely rejected.
	if head, want := r.HeadSHA(t), clientCommit; head == want {
		t.Fatalf("main advanced to client commit %s despite non-FF", head)
	}
}

// --- GitData: tag-ref collision ---------------------------------------------

func TestGitData_TagRefCollisionIs422(t *testing.T) {
	t.Parallel()
	r := NewRemote(t, WithSeed(map[string]string{"specs/requirements/main.md": "v0"}, "seed"))
	c := newGitDataClient(t, GitDataServer(t, r))

	mainSHA := c.getRef("heads/main")

	// First tag ref for v1 succeeds.
	obj1 := c.createTagObject(tagReq{Tag: "v1", Message: "Requirements v1", Object: mainSHA, Type: "commit",
		Tagger: &ident{Name: "Alice", Email: "alice@aep.test"}})
	c.createTagRef("refs/tags/v1", obj1, http.StatusCreated)

	// Second CreateTagRef for the same name is a real 422 → ErrTagAlreadyExists.
	obj2 := c.createTagObject(tagReq{Tag: "v1", Message: "Requirements v1 again", Object: mainSHA, Type: "commit",
		Tagger: &ident{Name: "Bob", Email: "bob@aep.test"}})
	c.createTagRef("refs/tags/v1", obj2, http.StatusUnprocessableEntity)

	// ListMatchingRefs("tags/v") returns exactly the one tag ref that landed.
	refs := c.matchingRefs("tags/v")
	if len(refs) != 1 || refs[0] != "refs/tags/v1" {
		t.Fatalf("matching-refs = %v, want [refs/tags/v1]", refs)
	}
	if tags := r.Tags(t); len(tags) != 1 || tags[0] != "v1" {
		t.Fatalf("Tags = %v, want [v1]", tags)
	}
}

// --- Stub: route registry ---------------------------------------------------

func TestStub_RegistersAndRecords(t *testing.T) {
	t.Parallel()
	s := NewStub(t)
	s.On(http.MethodPost, "/repos/acme/widgets/issues", http.StatusCreated, `{"number":7}`)

	// Registered route returns the configured status+body.
	resp, err := http.Post(s.URL+"/repos/acme/widgets/issues", "application/json", bytes.NewReader([]byte(`{"title":"bug"}`)))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusCreated || string(body) != `{"number":7}` {
		t.Fatalf("registered route = %d %q, want 201 {\"number\":7}", resp.StatusCode, body)
	}

	// Unregistered route 404s.
	resp2, err := http.Get(s.URL + "/repos/acme/widgets/hooks")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	_ = resp2.Body.Close()
	if resp2.StatusCode != http.StatusNotFound {
		t.Fatalf("unregistered route = %d, want 404", resp2.StatusCode)
	}

	// Both requests were recorded, in order, with method/path/body.
	reqs := s.Requests()
	if len(reqs) != 2 {
		t.Fatalf("recorded %d requests, want 2", len(reqs))
	}
	if reqs[0].Method != http.MethodPost || reqs[0].Path != "/repos/acme/widgets/issues" || reqs[0].Body != `{"title":"bug"}` {
		t.Fatalf("request[0] = %+v", reqs[0])
	}
	if reqs[1].Path != "/repos/acme/widgets/hooks" {
		t.Fatalf("request[1] path = %q, want /repos/acme/widgets/hooks", reqs[1].Path)
	}
}

// --- test-local Git Data client (mirrors github_artifacts.go's wire format) --

type gitDataClient struct {
	t    *testing.T
	base string // .../repos/{owner}/{repo}/git
}

func newGitDataClient(t *testing.T, gd *GitData) *gitDataClient {
	return &gitDataClient{t: t, base: gd.URL + "/repos/acme/widgets/git"}
}

type ident struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Date  string `json:"date,omitempty"`
}

type treeEntry struct {
	Path string  `json:"path"`
	Mode string  `json:"mode"`
	Type string  `json:"type"`
	SHA  *string `json:"sha"` // nil → null on the wire (deletion)
}

type commitReq struct {
	Message   string
	Tree      string
	Parents   []string
	Author    *ident
	Committer *ident
}

type tagReq struct {
	Tag     string
	Message string
	Object  string
	Type    string
	Tagger  *ident
}

func (c *gitDataClient) getRef(ref string) string {
	var out struct {
		Object struct {
			SHA string `json:"sha"`
		} `json:"object"`
	}
	c.do(http.MethodGet, "/ref/"+ref, nil, http.StatusOK, &out)
	return out.Object.SHA
}

func (c *gitDataClient) getCommitTree(sha string) string {
	var out struct {
		Tree struct {
			SHA string `json:"sha"`
		} `json:"tree"`
	}
	c.do(http.MethodGet, "/commits/"+sha, nil, http.StatusOK, &out)
	return out.Tree.SHA
}

func (c *gitDataClient) getTreePaths(sha string) []string {
	var out struct {
		Tree []struct {
			Path string `json:"path"`
			Type string `json:"type"`
		} `json:"tree"`
	}
	c.do(http.MethodGet, "/trees/"+sha+"?recursive=true", nil, http.StatusOK, &out)
	var paths []string
	for _, e := range out.Tree {
		if e.Type == "blob" {
			paths = append(paths, e.Path)
		}
	}
	return paths
}

func (c *gitDataClient) createBlob(content []byte) string {
	body := map[string]any{
		"content":  base64.StdEncoding.EncodeToString(content),
		"encoding": "base64",
	}
	var out struct {
		SHA string `json:"sha"`
	}
	c.do(http.MethodPost, "/blobs", body, http.StatusCreated, &out)
	return out.SHA
}

func (c *gitDataClient) createTree(baseTree string, entries []treeEntry) string {
	body := map[string]any{"tree": entries}
	if baseTree != "" {
		body["base_tree"] = baseTree
	}
	var out struct {
		SHA string `json:"sha"`
	}
	c.do(http.MethodPost, "/trees", body, http.StatusCreated, &out)
	return out.SHA
}

func (c *gitDataClient) createCommit(req commitReq) string {
	body := map[string]any{"message": req.Message, "tree": req.Tree, "parents": req.Parents}
	if req.Author != nil {
		body["author"] = req.Author
	}
	if req.Committer != nil {
		body["committer"] = req.Committer
	}
	var out struct {
		SHA string `json:"sha"`
	}
	c.do(http.MethodPost, "/commits", body, http.StatusCreated, &out)
	return out.SHA
}

func (c *gitDataClient) updateRef(ref, sha string, force bool, wantStatus int) {
	body := map[string]any{"sha": sha, "force": force}
	c.do(http.MethodPatch, "/refs/"+ref, body, wantStatus, nil)
}

func (c *gitDataClient) createTagObject(req tagReq) string {
	body := map[string]any{"tag": req.Tag, "message": req.Message, "object": req.Object, "type": req.Type}
	if req.Tagger != nil {
		body["tagger"] = req.Tagger
	}
	var out struct {
		SHA string `json:"sha"`
	}
	c.do(http.MethodPost, "/tags", body, http.StatusCreated, &out)
	return out.SHA
}

func (c *gitDataClient) createTagRef(ref, tagObjSHA string, wantStatus int) {
	c.do(http.MethodPost, "/refs", map[string]any{"ref": ref, "sha": tagObjSHA}, wantStatus, nil)
}

func (c *gitDataClient) matchingRefs(prefix string) []string {
	var out []struct {
		Ref string `json:"ref"`
	}
	c.do(http.MethodGet, "/matching-refs/"+prefix, nil, http.StatusOK, &out)
	refs := make([]string, 0, len(out))
	for _, r := range out {
		refs = append(refs, r.Ref)
	}
	return refs
}

// do issues one request, asserts the status, and decodes into out (if non-nil).
func (c *gitDataClient) do(method, path string, body any, wantStatus int, out any) {
	c.t.Helper()
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			c.t.Fatalf("marshal %s %s: %v", method, path, err)
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+path, reader)
	if err != nil {
		c.t.Fatalf("new request %s %s: %v", method, path, err)
	}
	req.Header.Set("Authorization", "Bearer test-token") // accepted, not validated
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatalf("do %s %s: %v", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != wantStatus {
		c.t.Fatalf("%s %s = status %d (%s), want %d", method, path, resp.StatusCode, raw, wantStatus)
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			c.t.Fatalf("decode %s %s: %v (body %s)", method, path, err, raw)
		}
	}
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
