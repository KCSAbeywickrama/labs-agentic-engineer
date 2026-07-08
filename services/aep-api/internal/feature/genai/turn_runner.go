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

package genai

// turn_runner.go — the detached committed-truth turn execution (design §6,
// D13–D15, D20): dispatch the agents service with the WorkspaceRef, tap every
// StreamPart into the broker while folding file mutations in Go, gate the
// fold on the terminal manifest, and land the result as ONE commit on main
// via Workspace.Mutate. The runner heartbeats the agent_turns row; a replica
// crash leaves a stale heartbeat for the sweep (turn_sweep.go).

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"runtime/debug"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/wso2/aep/aep-api/internal/clients/agentsvc"
	"github.com/wso2/aep/aep-api/internal/feature/gitrepo"
	"github.com/wso2/aep/aep-api/internal/platform/agentfold"
)

const (
	// turnRunTimeout bounds one detached turn end to end (generation runs
	// minutes; 30min is the hard stop — plan.go precedent, made explicit).
	turnRunTimeout = 30 * time.Minute
	// turnIdleTimeout aborts the stream if no bytes arrive for this long.
	// The agents service emits keep-alives ~every 15s, so a longer silence
	// means a hung turn.
	turnIdleTimeout = 90 * time.Second
	// turnHeartbeatEvery is the agent_turns heartbeat cadence (the sweep
	// fails rows stale past turnSweepStaleAfter).
	turnHeartbeatEvery = 15 * time.Second
)

// divergenceNote is the D20 note prepended to the next dispatch after a
// FAILED turn: the conversation history claims work git never received.
const divergenceNote = "Note: your previous turn's changes were NOT applied; the workspace reflects the repository state."

// turnJob is everything the detached runner needs, captured at POST time
// (identities, key, refs — D20: nothing is re-read from a request context).
type turnJob struct {
	turnID           string
	orgID            string
	projectID        string
	useCase          string
	conversationID   string // FE-chosen uuid (agent_turns key)
	nsConversationID string // namespaced agents-service id
	instruction      string // user instruction + steering + target suffix
	summary          string // raw user instruction (commit message subject)
	repoRef          gitrepo.RepoRef
	baseRef          string
	skillsRef        string
	anthropicKey     string
	author           *gitrepo.GitIdentity
	committer        *gitrepo.GitIdentity
}

// baseMovedError is the D15 overlap conflict: main moved past the turn's base
// and the movement touched paths the fold also touched. fn returns it inside
// Mutate → immediate abort, no retry.
type baseMovedError struct {
	Paths []string
}

func (e *baseMovedError) Error() string {
	return "base moved with overlapping changes: " + strings.Join(e.Paths, ", ")
}

// runTurnSafe is the panic barrier around the detached turn goroutine: a panic
// anywhere on the turn path (the fold, the YAML frontmatter parser, a
// misbehaving dep) must not crash the whole aep-api process. On recover it logs
// the stack, marks the turn FAILED through the normal finish path — releasing
// the D18 one-active-turn guard immediately and emitting the broker terminal so
// attached viewers are unblocked — and returns. The happy path (and every
// handled terminal) is finished inside runTurn itself; this only fires when
// runTurn unwinds via panic before its own finishTurn ran.
func (s *service) runTurnSafe(ctx context.Context, job turnJob) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("genai: turn runner panicked — recovered, failing the turn",
				"turn", job.turnID, "panic", r, "stack", string(debug.Stack()))
			// The run context may be poisoned by the unwind; finish on a fresh
			// budget so the failed row + terminal event always land.
			finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
			defer cancel()
			s.finishTurn(finishCtx, job, failedTerminal(turnReasonInternal, "turn runner panicked", nil))
		}
	}()
	s.runTurn(ctx, job)
}

// runTurn drives one detached turn to its terminal state. ctx is already
// detached from the request (context.WithoutCancel).
func (s *service) runTurn(ctx context.Context, job turnJob) {
	runCtx, cancel := context.WithTimeout(ctx, turnRunTimeout)
	defer cancel()
	term := s.executeTurn(runCtx, job)
	// The terminal write must not die with the run deadline (a timed-out turn
	// still needs its failed row + terminal event) — give it its own budget.
	finishCtx, finishCancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer finishCancel()
	s.finishTurn(finishCtx, job, term)
}

// mcpForTurn mints the per-turn MCP discovery block for a design-generation
// turn (dependency-management Phase 5): a BFF-signed token (aud aep-api-mcp)
// carrying the org, plus the BFF's internal MCP endpoint the agents service
// calls back into. Returns nil (no MCP block) when the minter / base URL are
// not wired, when the use case is not design generation, or when minting fails
// — a turn without MCP is byte-identical to today, so this is best-effort.
func (s *service) mcpForTurn(ctx context.Context, job turnJob) *agentsvc.MCPBlock {
	if s.mcpTokens == nil || s.mcpBaseURL == "" || job.useCase != useCaseDesignGenerate {
		return nil
	}
	token, err := s.mcpTokens.IssueMCPToken(job.orgID)
	if err != nil {
		slog.WarnContext(ctx, "genai: MCP token mint failed — dispatching turn without MCP discovery",
			"turn", job.turnID, "error", err)
		return nil
	}
	return &agentsvc.MCPBlock{
		URL:   strings.TrimRight(s.mcpBaseURL, "/") + "/internal/v1/mcp",
		Token: token,
	}
}

// executeTurn produces the turn's terminal state (never panics the goroutine).
func (s *service) executeTurn(ctx context.Context, job turnJob) TurnTerminal {
	instruction := job.instruction
	filesChangedExternally := false
	// D20: filesChangedExternally is server-derived — the last terminal turn
	// of this conversation landed a ref different from the current base (an
	// Apply, another conversation's turn, or an external push moved main).
	// A failed prior turn additionally gets the divergence note.
	if last, err := s.turns.LastTerminal(ctx, job.orgID, job.projectID, job.conversationID); err != nil {
		slog.WarnContext(ctx, "genai: last-terminal lookup failed — dispatching without the D20 flags",
			"turn", job.turnID, "error", err)
	} else if last != nil {
		landed := last.CommitSHA
		if landed == "" {
			landed = last.BaseRef
		}
		filesChangedExternally = landed != job.baseRef
		if last.Status == turnStatusFailed {
			instruction = divergenceNote + "\n\n" + instruction
		}
	}

	body, err := s.client.Turn(ctx, job.nsConversationID, job.orgID, job.anthropicKey, agentsvc.TurnRequest{
		Instruction: instruction,
		Workspace: agentsvc.WorkspaceRef{
			ConversationID: job.nsConversationID,
			TurnID:         job.turnID,
			RepoSlug:       job.repoRef.RepoSlug,
			Ref:            job.baseRef,
			SkillsRef:      job.skillsRef,
		},
		FilesChangedExternally: filesChangedExternally,
		MCP:                    s.mcpForTurn(ctx, job),
	})
	if err != nil {
		slog.WarnContext(ctx, "genai: turn dispatch failed", "turn", job.turnID, "error", err)
		return failedTerminal(turnReasonDispatchFailed, "agents dispatch failed: "+err.Error(), nil)
	}
	defer body.Close()

	// Heartbeat the row while the stream runs (D17).
	hbStop := make(chan struct{})
	defer close(hbStop)
	go func() {
		ticker := time.NewTicker(turnHeartbeatEvery)
		defer ticker.Stop()
		for {
			select {
			case <-hbStop:
				return
			case <-ticker.C:
				if err := s.turns.Heartbeat(ctx, job.turnID); err != nil {
					slog.WarnContext(ctx, "genai: turn heartbeat failed", "turn", job.turnID, "error", err)
				}
			}
		}
	}()

	// Idle watchdog (plan_tap precedent): any read pulses activity; silence
	// past the deadline closes body to unblock the pending read.
	var idleAborted atomic.Bool
	activity := make(chan struct{}, 1)
	watchStop := make(chan struct{})
	defer close(watchStop)
	go func() {
		timer := time.NewTimer(turnIdleTimeout)
		defer timer.Stop()
		for {
			select {
			case <-watchStop:
				return
			case <-activity:
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				timer.Reset(turnIdleTimeout)
			case <-timer.C:
				idleAborted.Store(true)
				_ = body.Close()
				return
			}
		}
	}()

	fold := agentfold.New(s.turnBaseReader(job.repoRef, job.baseRef))
	var manifest *agentfold.Manifest
	var foldErr error
	end, readErr := agentfold.ForEachDataFrame(&pulseReader{r: body, activity: activity}, func(raw []byte) error {
		var part agentfold.StreamPart
		if err := json.Unmarshal(raw, &part); err != nil {
			return nil // truncation remnant — skip, matching the parser rule
		}
		if m, ok := agentfold.ManifestOf(part); ok {
			manifest = &m
			return nil // backend integrity plumbing — never forwarded (D14)
		}
		s.broker.Append(job.turnID, raw)
		if _, err := fold.ApplyToolCall(ctx, part); err != nil {
			foldErr = err
			return err
		}
		return nil
	})

	switch {
	case foldErr != nil:
		var ufe *agentfold.UnsupportedFrontmatterError
		if errors.As(foldErr, &ufe) {
			// The agents-side bundle applied a write the Go fold cannot
			// byte-reproduce — a parity failure by construction (loud, D14).
			slog.ErrorContext(ctx, "genai: fold cannot reproduce frontmatter write — turn rejected, main untouched",
				"turn", job.turnID, "path", ufe.Path, "reason", ufe.Reason)
			return failedTerminal(turnReasonFoldParity, foldErr.Error(), nil)
		}
		slog.WarnContext(ctx, "genai: fold infrastructure failure", "turn", job.turnID, "error", foldErr)
		return failedTerminal(turnReasonInternal, foldErr.Error(), nil)
	case readErr != nil:
		msg := "agents stream read failed: " + readErr.Error()
		if idleAborted.Load() {
			msg = "agents stream idle past deadline"
		}
		return failedTerminal(turnReasonStreamDied, msg, nil)
	case manifest == nil:
		// Severed (EOF) or completed-with-error ([DONE] after an in-band
		// error frame) — either way agents vouched for nothing: no commit.
		msg := "stream ended without a manifest"
		if end == agentfold.StreamEOF {
			msg = "stream severed before the manifest"
		}
		return failedTerminal(turnReasonStreamDied, msg, nil)
	}

	// D14 integrity gate: the Go fold must agree byte-for-byte with the
	// agents-side FileBundle on every mutated path.
	if err := agentfold.Verify(fold, *manifest); err != nil {
		slog.ErrorContext(ctx, "genai: FOLD PARITY FAILURE — turn rejected, main untouched",
			"turn", job.turnID, "error", err)
		return failedTerminal(turnReasonFoldParity, err.Error(), nil)
	}
	if manifest.IsEmpty() {
		// A chat turn with no file ops: valid, completes with no commit. The
		// terminal still carries the base sha as the "content as of" pin.
		return TurnTerminal{Status: turnStatusCompleted, CommitSHA: job.baseRef, NoChanges: true}
	}
	return s.commitFold(ctx, job, fold)
}

// commitFold lands the verified fold as one commit on main (D13/D15).
func (s *service) commitFold(ctx context.Context, job turnJob, fold *agentfold.Fold) TurnTerminal {
	touched := fold.Touched()
	paths := make([]string, 0, len(touched))
	for path := range touched {
		paths = append(paths, path)
	}
	sort.Strings(paths)

	// Baseline blob SHAs at the turn's base — the D15 overlap input. Read
	// BEFORE Mutate: Diff/ReadFile take their own flock, and Mutate holds the
	// exclusive one (locks are per-acquisition, so a nested read would
	// self-deadlock).
	ws := s.git.Workspace()
	baseline := make(map[string]string, len(paths))
	for _, path := range paths {
		_, blobSHA, err := ws.ReadFile(ctx, job.repoRef, job.baseRef, path)
		if errors.Is(err, gitrepo.ErrPathNotFound) {
			baseline[path] = ""
			continue
		}
		if err != nil {
			return failedTerminal(turnReasonInternal, "read base blob "+path+": "+err.Error(), nil)
		}
		baseline[path] = blobSHA
	}

	res, err := ws.Mutate(ctx, job.repoRef, func(tx gitrepo.Tx) error {
		// D15: main moved past the turn's base. Overlap = a touched path
		// whose committed content differs between the turn's base and the
		// current base (equivalent to changed(base..HEAD) ∩ touched,
		// computed against Tx.Base() so no nested Workspace call is needed).
		if tx.Base().CommitSHA() != job.baseRef {
			var conflicts []string
			for _, path := range paths {
				_, blobSHA, rerr := tx.Base().Read(path)
				if errors.Is(rerr, gitrepo.ErrPathNotFound) {
					blobSHA = ""
				} else if rerr != nil {
					return fmt.Errorf("re-read %s at new base: %w", path, rerr)
				}
				if blobSHA != baseline[path] {
					conflicts = append(conflicts, path)
				}
			}
			if len(conflicts) > 0 {
				return &baseMovedError{Paths: conflicts}
			}
			// Disjoint movement → replay the overlay on the new base (the
			// Mutate CAS loop pushes it).
		}
		for _, path := range paths {
			if content := touched[path]; content == nil {
				tx.Delete(path)
			} else {
				tx.Write(path, []byte(*content))
			}
		}
		return nil
	}, gitrepo.CommitOpts{
		Message:   commitMessage(job.useCase, job.summary),
		Author:    job.author,
		Committer: job.committer,
	})

	var bm *baseMovedError
	switch {
	case errors.As(err, &bm):
		slog.WarnContext(ctx, "genai: turn failed base-moved", "turn", job.turnID, "paths", bm.Paths)
		return failedTerminal(turnReasonBaseMoved, "main moved past the turn's base with overlapping changes", bm.Paths)
	case errors.Is(err, gitrepo.ErrRefNotFastForward):
		return failedTerminal(turnReasonInternal, "commit retries exhausted (origin kept advancing)", nil)
	case err != nil:
		slog.WarnContext(ctx, "genai: turn commit failed", "turn", job.turnID, "error", err)
		return failedTerminal(turnReasonInternal, "commit failed: "+err.Error(), nil)
	}
	// Changed=false: the fold re-produced content identical to base — no
	// commit object, but the turn is a valid completion.
	return TurnTerminal{Status: turnStatusCompleted, CommitSHA: res.CommitSHA, NoChanges: !res.Changed}
}

// finishTurn stamps the terminal row state and emits the ONE terminal stream
// event. A row that is no longer running (swept mid-run) keeps the sweep's
// verdict — the runner does not overwrite it or emit a competing terminal.
func (s *service) finishTurn(ctx context.Context, job turnJob, term TurnTerminal) {
	ok, err := s.turns.Finish(ctx, job.turnID, term)
	if err != nil {
		slog.ErrorContext(ctx, "genai: finish turn row failed", "turn", job.turnID, "error", err)
		// Fall through: attached clients still deserve the terminal event.
	} else if !ok {
		slog.WarnContext(ctx, "genai: turn was swept before it finished — keeping the sweep verdict",
			"turn", job.turnID, "wouldBe", term.Status)
		return
	}
	s.broker.Terminal(job.turnID, terminalEventJSON(term))
	// Notify any waiting devflow workflow of the terminal outcome (best-effort).
	if s.finishHook != nil {
		s.finishHook(ctx, job.orgID, job.projectID, job.turnID, job.useCase, term.Status)
	}
}

// turnBaseReader adapts Workspace.ReadFile at the turn's base ref into the
// agentfold BaseReader, applying the agents-side InTurnSnapshot filter — a
// path the agents snapshot walk dropped (non-.md/.dsl/design.json, dot-led
// segment, binary) must read as exists=false here even though it is in git,
// or NO_SUCH_FILE parity breaks (agentfold snapshot_filter contract).
func (s *service) turnBaseReader(ref gitrepo.RepoRef, baseRef string) agentfold.BaseReader {
	return func(ctx context.Context, path string) ([]byte, bool, error) {
		content, _, err := s.git.Workspace().ReadFile(ctx, ref, baseRef, path)
		if errors.Is(err, gitrepo.ErrPathNotFound) {
			return nil, false, nil
		}
		if err != nil {
			return nil, false, err
		}
		if !agentfold.InTurnSnapshot(path, content) {
			return nil, false, nil
		}
		return content, true, nil
	}
}

// commitMessage renders the D20 conventional message:
// generate(requirements|design)/chat(requirements): <first line of the user
// instruction, truncated>.
func commitMessage(useCase, summary string) string {
	verb := "generate"
	scope := "requirements"
	switch useCase {
	case useCaseRequirementsChat:
		verb = "chat"
	case useCaseDesignGenerate:
		scope = "design"
	}
	return verb + "(" + scope + "): " + firstLine(summary, 72)
}

func firstLine(s string, max int) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	s = strings.TrimSpace(s)
	if len(s) > max {
		cut := s[:max]
		// Do not split a multi-byte rune.
		for len(cut) > 0 && !isRuneStart(cut[len(cut)-1]) {
			cut = cut[:len(cut)-1]
		}
		s = strings.TrimSpace(cut) + "…"
	}
	if s == "" {
		s = "agent turn"
	}
	return s
}

func isRuneStart(b byte) bool { return b&0xC0 != 0x80 }

// failedTerminal builds a failed TurnTerminal.
func failedTerminal(reason, message string, paths []string) TurnTerminal {
	return TurnTerminal{Status: turnStatusFailed, Reason: reason, Message: message, Paths: paths}
}

// terminalEventJSON renders the ONE terminal stream event appended by aep-api
// (never by agents): turn-committed / turn-failed, exactly as pinned by the
// console contract.
func terminalEventJSON(term TurnTerminal) []byte {
	var payload any
	if term.Status == turnStatusCompleted {
		payload = struct {
			Type      string `json:"type"`
			CommitSHA string `json:"commitSha"`
			NoChanges bool   `json:"noChanges"`
		}{Type: "turn-committed", CommitSHA: term.CommitSHA, NoChanges: term.NoChanges}
	} else {
		payload = struct {
			Type    string   `json:"type"`
			Reason  string   `json:"reason"`
			Message string   `json:"message,omitempty"`
			Paths   []string `json:"paths,omitempty"`
		}{Type: "turn-failed", Reason: term.Reason, Message: term.Message, Paths: term.Paths}
	}
	b, err := json.Marshal(payload)
	if err != nil { // unreachable: static shapes
		return []byte(`{"type":"turn-failed","reason":"internal"}`)
	}
	return b
}

// pulseReader pulses the idle-watchdog activity channel on every successful
// read (keep-alive comment bytes count — they are exactly the liveness signal).
type pulseReader struct {
	r        io.Reader
	activity chan<- struct{}
}

func (p *pulseReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	if n > 0 {
		select {
		case p.activity <- struct{}{}:
		default:
		}
	}
	return n, err
}
