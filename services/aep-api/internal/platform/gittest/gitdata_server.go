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

// GitData is an httptest.Server implementing exactly the GitHub Git Data API
// endpoints the gitrepo client (github_artifacts.go) drives, backed by a
// Remote's bare repo. Every response reads real git state via plumbing, so the
// save flow's blob→tree→commit→ref→tag sequence and conflict_retry.go's
// CAS/tag-collision branches run against genuine git semantics.
//
// Wire shapes and paths are derived from the client, not GitHub's full API:
//   - GET   /repos/{o}/{r}/git/ref/{ref}            → {"object":{"sha"}}      (GetRef; ref e.g. "heads/main")
//   - GET   /repos/{o}/{r}/git/commits/{sha}        → {"sha","tree":{"sha"},"parents":[{"sha"}],"message"}
//   - GET   /repos/{o}/{r}/git/trees/{sha}?recursive=true → {"sha","tree":[...],"truncated"}
//   - GET   /repos/{o}/{r}/git/blobs/{sha}          → {"content"(base64),"encoding"}
//   - GET   /repos/{o}/{r}/git/matching-refs/{pfx}  → [{"ref","object":{"sha"}}]  (pfx e.g. "tags/v")
//   - POST  /repos/{o}/{r}/git/blobs                → {"sha"}   (accepts base64 AND utf-8 encoding)
//   - POST  /repos/{o}/{r}/git/trees                → {"sha"}   (base_tree + entries; sha:null = delete)
//   - POST  /repos/{o}/{r}/git/commits              → {"sha"}   (author/committer → GIT_*_ env)
//   - PATCH /repos/{o}/{r}/git/refs/{ref}           → {"object":{"sha"}} or 422 (ErrRefNotFastForward)
//   - POST  /repos/{o}/{r}/git/tags                 → {"sha"}   (annotated tag object via mktag)
//   - POST  /repos/{o}/{r}/git/refs                 → {"ref"}   or 422 (ErrTagAlreadyExists)
//
// Owner/repo path segments are accepted but ignored — this is a single-repo
// server. The Authorization header is accepted and NOT validated (the client
// always sends "Bearer <token>"; file remotes and this fake need no auth).
//
// FIDELITY: the JSON envelope is faithful only to the fields the client reads.
// Real-GitHub drift stays integration-owned. The artifacts save-flow tests
// drive this server through the REAL git host client (clients/github) via the
// WithAPIBase seam; smoke_test.go additionally drives it with net/http requests
// matching the client's wire format.

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// GitData wraps an httptest.Server. Embed exposes .URL and .Close.
type GitData struct {
	*httptest.Server
	remote *Remote

	// BeforeUpdateRef, if set, is called at the start of every UpdateRef
	// (PATCH .../git/refs/{ref}) before the ref is read or moved. A test uses
	// it to advance main "externally" mid-save and force a deterministic
	// non-fast-forward — set it before driving the save flow (the request's
	// happens-before makes the read race-free).
	BeforeUpdateRef func()

	// BeforeCreateTagRef, if set, is called at the start of every CreateRef
	// (POST .../git/refs — production only creates tag refs here) before the
	// exists-check runs. A test uses it to claim the tag name "externally"
	// and force a deterministic 422 → ErrTagAlreadyExists through the REAL
	// client — the tag-collision twin of BeforeUpdateRef.
	BeforeCreateTagRef func()
}

// GitDataServer starts a Git Data API server backed by r's bare repo and
// registers Close on t.Cleanup.
func GitDataServer(t *testing.T, r *Remote) *GitData {
	t.Helper()
	g := &GitData{remote: r}
	g.Server = httptest.NewServer(http.HandlerFunc(g.route))
	t.Cleanup(g.Server.Close)
	return g
}

// gitIdentity mirrors GitHub's author/committer/tagger object on the wire.
type gitIdentity struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Date  string `json:"date"`
}

func (g *GitData) route(w http.ResponseWriter, req *http.Request) {
	// Path shape: /repos/{owner}/{repo}/git/{resource}/{rest...}
	seg := strings.Split(strings.Trim(req.URL.Path, "/"), "/")
	if len(seg) < 5 || seg[0] != "repos" || seg[3] != "git" {
		g.notFound(w)
		return
	}
	resource := seg[4]
	rest := seg[5:]

	switch {
	case req.Method == http.MethodGet && resource == "ref":
		g.getRef(w, strings.Join(rest, "/"))
	case req.Method == http.MethodGet && resource == "commits" && len(rest) == 1:
		g.getCommit(w, rest[0])
	case req.Method == http.MethodGet && resource == "trees" && len(rest) == 1:
		g.getTree(w, req, rest[0])
	case req.Method == http.MethodGet && resource == "blobs" && len(rest) == 1:
		g.getBlob(w, rest[0])
	case req.Method == http.MethodGet && resource == "matching-refs":
		g.matchingRefs(w, strings.Join(rest, "/"))
	case req.Method == http.MethodGet && resource == "tags" && len(rest) == 1:
		g.getTagObject(w, rest[0])
	case req.Method == http.MethodPost && resource == "blobs" && len(rest) == 0:
		g.createBlob(w, req)
	case req.Method == http.MethodPost && resource == "trees" && len(rest) == 0:
		g.createTree(w, req)
	case req.Method == http.MethodPost && resource == "commits" && len(rest) == 0:
		g.createCommit(w, req)
	case req.Method == http.MethodPost && resource == "tags" && len(rest) == 0:
		g.createTagObject(w, req)
	case req.Method == http.MethodPost && resource == "refs" && len(rest) == 0:
		g.createRef(w, req)
	case req.Method == http.MethodPatch && resource == "refs":
		g.updateRef(w, req, strings.Join(rest, "/"))
	default:
		g.notFound(w)
	}
}

// ----- read endpoints -----

func (g *GitData) getRef(w http.ResponseWriter, ref string) {
	full := "refs/" + ref
	sha, err := g.remote.exec(nil, nil, "rev-parse", "--verify", full)
	if err != nil {
		g.notFound(w) // 404 → GetRef surfaces HTTPStatusError{404}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ref":    full,
		"object": map[string]any{"sha": strings.TrimSpace(sha), "type": "commit"},
	})
}

func (g *GitData) getCommit(w http.ResponseWriter, sha string) {
	full, err := g.remote.exec(nil, nil, "rev-parse", "--verify", sha+"^{commit}")
	if err != nil {
		g.notFound(w)
		return
	}
	commitSHA := strings.TrimSpace(full)
	tree, ok := g.git(w, "rev-parse", commitSHA+"^{tree}")
	if !ok {
		return
	}
	parentsRaw, ok := g.git(w, "show", "-s", "--format=%P", commitSHA)
	if !ok {
		return
	}
	message, ok := g.git(w, "show", "-s", "--format=%B", commitSHA)
	if !ok {
		return
	}
	parents := []map[string]any{}
	for _, p := range strings.Fields(parentsRaw) {
		parents = append(parents, map[string]any{"sha": p})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"sha":     commitSHA,
		"tree":    map[string]any{"sha": strings.TrimSpace(tree)},
		"parents": parents,
		"message": strings.TrimRight(message, "\n"),
	})
}

func (g *GitData) getTree(w http.ResponseWriter, req *http.Request, sha string) {
	treeSHA, err := g.remote.exec(nil, nil, "rev-parse", "--verify", sha+"^{tree}")
	if err != nil {
		g.notFound(w)
		return
	}
	treeSHA = strings.TrimSpace(treeSHA)
	// The client sends ?recursive=true; accept any truthy value.
	args := []string{"ls-tree", "--full-tree", "-l"}
	if isTruthy(req.URL.Query().Get("recursive")) {
		args = append(args, "-r", "-t")
	}
	args = append(args, treeSHA)
	out, ok := g.git(w, args...)
	if !ok {
		return
	}
	entries := []map[string]any{}
	for _, line := range strings.Split(strings.TrimRight(out, "\n"), "\n") {
		if line == "" {
			continue
		}
		// "<mode> <type> <sha> <padded-size>\t<path>"
		tab := strings.IndexByte(line, '\t')
		if tab < 0 {
			continue
		}
		fields := strings.Fields(line[:tab])
		if len(fields) < 3 {
			continue
		}
		entry := map[string]any{
			"path": line[tab+1:],
			"mode": fields[0],
			"type": fields[1],
			"sha":  fields[2],
		}
		if len(fields) >= 4 && fields[3] != "-" {
			if n, perr := strconv.ParseInt(fields[3], 10, 64); perr == nil {
				entry["size"] = n
			}
		}
		entries = append(entries, entry)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"sha":       treeSHA,
		"tree":      entries,
		"truncated": false,
	})
}

func (g *GitData) getBlob(w http.ResponseWriter, sha string) {
	raw, err := g.remote.exec(nil, nil, "cat-file", "blob", sha)
	if err != nil {
		g.notFound(w) // 404 → GetBlob surfaces HTTPStatusError{404}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"sha":      sha,
		"content":  base64.StdEncoding.EncodeToString([]byte(raw)),
		"encoding": "base64",
	})
}

func (g *GitData) matchingRefs(w http.ResponseWriter, prefix string) {
	// GitHub's matching-refs is a startswith over "refs/<prefix>"; the wildmatch
	// glob "refs/<prefix>*" reproduces that (it does not cross '/').
	out, err := g.remote.exec(nil, nil,
		"for-each-ref", "--format=%(refname) %(objectname) %(objecttype)", "refs/"+prefix+"*")
	if err != nil {
		g.serverError(w, err)
		return
	}
	refs := []map[string]any{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		f := strings.Fields(line)
		if len(f) < 2 {
			continue
		}
		objType := "commit"
		if len(f) >= 3 {
			objType = f[2]
		}
		refs = append(refs, map[string]any{
			"ref":    f[0],
			"object": map[string]any{"sha": f[1], "type": objType},
		})
	}
	writeJSON(w, http.StatusOK, refs)
}

// getTagObject dereferences an annotated tag object (GET /git/tags/{sha}) to
// the commit it points at. A non-tag sha 404s, mirroring GitHub, so the client
// can fall back to treating the ref sha as a commit for lightweight tags.
func (g *GitData) getTagObject(w http.ResponseWriter, sha string) {
	typ, err := g.remote.exec(nil, nil, "cat-file", "-t", sha)
	if err != nil || strings.TrimSpace(typ) != "tag" {
		g.notFound(w)
		return
	}
	commit, ok := g.git(w, "rev-parse", sha+"^{commit}")
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"sha":    sha,
		"object": map[string]any{"sha": strings.TrimSpace(commit), "type": "commit"},
	})
}

// ----- write endpoints -----

func (g *GitData) createBlob(w http.ResponseWriter, req *http.Request) {
	var body struct {
		Content  string `json:"content"`
		Encoding string `json:"encoding"`
	}
	if !decodeJSON(w, req, &body) {
		return
	}
	var raw []byte
	switch body.Encoding {
	case "", "utf-8":
		raw = []byte(body.Content)
	case "base64":
		clean := strings.NewReplacer("\n", "", "\r", "").Replace(body.Content)
		dec, err := base64.StdEncoding.DecodeString(clean)
		if err != nil {
			g.unprocessable(w, "invalid base64 content")
			return
		}
		raw = dec
	default:
		g.unprocessable(w, "unsupported encoding "+body.Encoding)
		return
	}
	sha, ok := g.gitStdin(w, raw, "hash-object", "-w", "--stdin")
	if !ok {
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"sha": strings.TrimSpace(sha)})
}

func (g *GitData) createTree(w http.ResponseWriter, req *http.Request) {
	var body struct {
		BaseTree string `json:"base_tree"`
		Tree     []struct {
			Path string  `json:"path"`
			Mode string  `json:"mode"`
			Type string  `json:"type"`
			SHA  *string `json:"sha"` // nil / "" → deletion (sha:null on the wire)
		} `json:"tree"`
	}
	if !decodeJSON(w, req, &body) {
		return
	}

	idxDir, err := os.MkdirTemp("", "gittest-tree-")
	if err != nil {
		g.serverError(w, err)
		return
	}
	defer os.RemoveAll(idxDir)
	env := map[string]string{"GIT_INDEX_FILE": filepath.Join(idxDir, "index")}

	if body.BaseTree != "" {
		if _, err := g.remote.exec(env, nil, "read-tree", body.BaseTree); err != nil {
			g.serverError(w, err)
			return
		}
	}

	var info strings.Builder
	var deletes []string
	for _, e := range body.Tree {
		if e.SHA == nil || *e.SHA == "" {
			deletes = append(deletes, e.Path)
			fmt.Fprintf(&info, "0 %s\t%s\n", strings.Repeat("0", 40), e.Path)
			continue
		}
		mode := e.Mode
		if mode == "" {
			mode = "100644"
		}
		fmt.Fprintf(&info, "%s %s\t%s\n", mode, *e.SHA, e.Path)
	}

	// GitHub 422s a delete for a path absent in base_tree; mirror that so the
	// no-op-tombstone filter in save_via_api.go is tested truthfully.
	if len(deletes) > 0 {
		lsOut, err := g.remote.exec(env, nil, "ls-files")
		if err != nil {
			g.serverError(w, err)
			return
		}
		present := map[string]bool{}
		for _, p := range strings.Split(strings.TrimSpace(lsOut), "\n") {
			if p != "" {
				present[p] = true
			}
		}
		for _, d := range deletes {
			if !present[d] {
				g.unprocessable(w, "path does not exist in base tree: "+d)
				return
			}
		}
	}

	if info.Len() > 0 {
		if _, err := g.remote.exec(env, []byte(info.String()), "update-index", "--index-info"); err != nil {
			g.serverError(w, err)
			return
		}
	}
	tree, err := g.remote.exec(env, nil, "write-tree")
	if err != nil {
		g.serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"sha": strings.TrimSpace(tree)})
}

func (g *GitData) createCommit(w http.ResponseWriter, req *http.Request) {
	var body struct {
		Message   string       `json:"message"`
		Tree      string       `json:"tree"`
		Parents   []string     `json:"parents"`
		Author    *gitIdentity `json:"author"`
		Committer *gitIdentity `json:"committer"`
	}
	if !decodeJSON(w, req, &body) {
		return
	}
	env := identityEnv(body.Author, body.Committer)
	args := []string{"commit-tree", body.Tree}
	for _, p := range body.Parents {
		if p != "" {
			args = append(args, "-p", p)
		}
	}
	args = append(args, "-m", body.Message)
	sha, err := g.remote.exec(env, nil, args...)
	if err != nil {
		g.serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"sha": strings.TrimSpace(sha)})
}

func (g *GitData) updateRef(w http.ResponseWriter, req *http.Request, ref string) {
	if g.BeforeUpdateRef != nil {
		g.BeforeUpdateRef()
	}
	var body struct {
		SHA   string `json:"sha"`
		Force bool   `json:"force"`
	}
	if !decodeJSON(w, req, &body) {
		return
	}
	full := "refs/" + ref
	oldSHA := ""
	if out, err := g.remote.exec(nil, nil, "rev-parse", "--verify", full); err == nil {
		oldSHA = strings.TrimSpace(out)
	}

	// force=false is fast-forward-only: old must be an ancestor of new. A
	// non-fast-forward is a real 422 → ErrRefNotFastForward in the client.
	if !body.Force && oldSHA != "" {
		if _, err := g.remote.exec(nil, nil, "merge-base", "--is-ancestor", oldSHA, body.SHA); err != nil {
			g.unprocessable(w, "Update is not a fast forward")
			return
		}
	}

	var err error
	if oldSHA != "" {
		_, err = g.remote.exec(nil, nil, "update-ref", full, body.SHA, oldSHA)
	} else {
		_, err = g.remote.exec(nil, nil, "update-ref", full, body.SHA)
	}
	if err != nil {
		g.serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ref":    full,
		"object": map[string]any{"sha": body.SHA, "type": "commit"},
	})
}

func (g *GitData) createTagObject(w http.ResponseWriter, req *http.Request) {
	var body struct {
		Tag     string       `json:"tag"`
		Message string       `json:"message"`
		Object  string       `json:"object"`
		Type    string       `json:"type"`
		Tagger  *gitIdentity `json:"tagger"`
	}
	if !decodeJSON(w, req, &body) {
		return
	}
	objType := body.Type
	if objType == "" {
		objType = "commit"
	}
	content := fmt.Sprintf("object %s\ntype %s\ntag %s\ntagger %s\n\n%s\n",
		body.Object, objType, body.Tag, taggerLine(body.Tagger), body.Message)
	sha, ok := g.gitStdin(w, []byte(content), "mktag")
	if !ok {
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"sha": strings.TrimSpace(sha)})
}

func (g *GitData) createRef(w http.ResponseWriter, req *http.Request) {
	if g.BeforeCreateTagRef != nil {
		g.BeforeCreateTagRef()
	}
	var body struct {
		Ref string `json:"ref"`
		SHA string `json:"sha"`
	}
	if !decodeJSON(w, req, &body) {
		return
	}
	// Create-only: an existing ref is a real 422 → ErrTagAlreadyExists.
	if _, err := g.remote.exec(nil, nil, "rev-parse", "--verify", body.Ref); err == nil {
		g.unprocessable(w, "Reference already exists")
		return
	}
	if _, err := g.remote.exec(nil, nil, "update-ref", body.Ref, body.SHA); err != nil {
		g.serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"ref":    body.Ref,
		"object": map[string]any{"sha": body.SHA},
	})
}

// ----- helpers -----

// git runs a read-only plumbing command, writing a 500 on failure. Returns
// (stdout, true) on success.
func (g *GitData) git(w http.ResponseWriter, args ...string) (string, bool) {
	out, err := g.remote.exec(nil, nil, args...)
	if err != nil {
		g.serverError(w, err)
		return "", false
	}
	return out, true
}

// gitStdin is git with stdin (hash-object, mktag), 500 on failure.
func (g *GitData) gitStdin(w http.ResponseWriter, stdin []byte, args ...string) (string, bool) {
	out, err := g.remote.exec(nil, stdin, args...)
	if err != nil {
		g.serverError(w, err)
		return "", false
	}
	return out, true
}

// identityEnv builds the GIT_AUTHOR_*/GIT_COMMITTER_* overrides for
// commit-tree from the wire author/committer. Absent fields keep the hermetic
// default; an absent date lets git use the fixed default date.
func identityEnv(author, committer *gitIdentity) map[string]string {
	env := map[string]string{}
	set := func(prefix string, id *gitIdentity) {
		if id == nil {
			return
		}
		if id.Name != "" {
			env["GIT_"+prefix+"_NAME"] = id.Name
		}
		if id.Email != "" {
			env["GIT_"+prefix+"_EMAIL"] = id.Email
		}
		if id.Date != "" {
			env["GIT_"+prefix+"_DATE"] = id.Date
		}
	}
	set("AUTHOR", author)
	set("COMMITTER", committer)
	return env
}

// taggerLine renders "Name <email> <unix-secs> <tz>" for an annotated tag
// object, converting the wire ISO-8601 date to git's raw form.
func taggerLine(tg *gitIdentity) string {
	name, email := defaultActorName, defaultActorEmail
	when := time.Unix(1767225600, 0).UTC() // matches fixedDate
	if tg != nil {
		if tg.Name != "" {
			name = tg.Name
		}
		if tg.Email != "" {
			email = tg.Email
		}
		if tg.Date != "" {
			if parsed, err := time.Parse(time.RFC3339, tg.Date); err == nil {
				when = parsed
			}
		}
	}
	_, offset := when.Zone()
	sign := "+"
	if offset < 0 {
		sign, offset = "-", -offset
	}
	tz := fmt.Sprintf("%s%02d%02d", sign, offset/3600, (offset%3600)/60)
	return fmt.Sprintf("%s <%s> %d %s", name, email, when.Unix(), tz)
}

func isTruthy(v string) bool {
	switch v {
	case "", "false", "0":
		return false
	default:
		return true
	}
}

func decodeJSON(w http.ResponseWriter, req *http.Request, v any) bool {
	if err := json.NewDecoder(req.Body).Decode(v); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body: " + err.Error()})
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (g *GitData) notFound(w http.ResponseWriter) {
	writeJSON(w, http.StatusNotFound, map[string]string{"message": "Not Found"})
}

func (g *GitData) unprocessable(w http.ResponseWriter, msg string) {
	writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"message": msg})
}

func (g *GitData) serverError(w http.ResponseWriter, err error) {
	writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
}
