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

// `/<skill>` flow commands — RECOGNISED by the server, for every token (#373).
//
// Clients send commands VERBATIM, and the server turns one into a TurnSpec: a
// statement of what the turn is for. It does not compose the instruction text —
// the agents service does that (services/agents/src/prompts/turn.ts), so the
// wording exists once, in the service that talks to the model. See
// services/agents/design/ADR-0003.
//
// Recognising the command HERE is still load-bearing:
//
//   - `/start` carries state no client sees and the agent cannot read — the
//     idea captured in specs/.agentic-engineer.toml, whose dot-led segment is
//     stripped from every turn snapshot. Only this side can read it.
//   - The flow token gates web search + MCP minting for design turns
//     (designOrCollabTurn), and MCP needs a BFF-signed bearer.
//
// Flows are deliberately NOT a conversation-identity dimension: a flow runs an
// interview whose answers are ordinary chat turns, so every turn of a project
// conversation must share one namespace (see useCaseGeneral).
//
// The idea only ever rides the FIRST `/start` turn: after that it is in the
// conversation history, so nothing needs re-attaching.

package spec

import (
	"context"
	"log/slog"
	"regexp"
	"slices"
	"strings"

	"github.com/wso2/aep/aep-api/internal/clients/agentsvc"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// startCommand is the one token carrying server-read state beyond the token.
const startCommand = "/start"

// slashCommandPattern is deliberately narrow so real chat is never eaten: a
// single leading `/`, a skill-name token ending at whitespace or message end,
// optional free text after it. A bare `/`, a mid-message slash, `//x`, or
// trailing punctuation on the token all fail the match and pass through as
// ordinary chat.
//
// The playground keeps its own copy of this grammar (it plays the server role
// when running without the platform). Duplication is deliberate: a regex cannot
// be shared across languages without a generator, and the two never run on the
// same input — a mismatch shows up as the playground routing a line differently
// from production, not as a wrong prompt.
var slashCommandPattern = regexp.MustCompile(`^/([a-z0-9-]+)(?:\s+([\s\S]+))?$`)

// turnSpecFor classifies a raw instruction. Non-command text is an ordinary
// chat turn with an empty flow. A `/<skill>` command names the skill; `/start`
// additionally carries the project idea (typed inline wins, else read from the
// descriptor at `at` — best-effort: no descriptor, no idea, and the start skill
// asks the user instead).
func (s *Service) turnSpecFor(ctx context.Context, ref sourcecontrol.RepoRef, at, raw string) (agentsvc.TurnSpec, string) {
	m := slashCommandPattern.FindStringSubmatch(strings.TrimSpace(raw))
	if m == nil {
		return agentsvc.TurnSpec{Kind: agentsvc.TurnKindChat, Text: raw}, ""
	}
	token, rest := m[1], strings.TrimSpace(m[2])

	if "/"+token == startCommand {
		idea := rest
		if idea == "" {
			idea = s.readProjectIdea(ctx, ref, at)
		}
		return agentsvc.TurnSpec{
			Kind:       agentsvc.TurnKindStart,
			Idea:       strings.TrimSpace(idea),
			References: s.listReferenceDocs(ctx, ref, at),
		}, token
	}

	// Flow turns carry the reference paths too: a flow generates artifacts
	// (wireframes.dsl from /design most of all) that must be grounded in what
	// the user attached — a drawn sketch is the wireframe brief. Chat prose
	// stays reference-free; the documents already sit in the conversation
	// history from the kickoff.
	return agentsvc.TurnSpec{
		Kind:       agentsvc.TurnKindFlow,
		Skill:      token,
		Text:       rest,
		References: s.listReferenceDocs(ctx, ref, at),
	}, token
}

// ReferencesDir is where the console commits the documents attached at project
// create (#383). It is ordinary versioned spec content — the agent can read it
// from its own snapshot — so the turn carries only the PATHS, as a pointer.
const ReferencesDir = "specs/requirements/references/"

// listReferenceDocs lists the reference documents at `at`, sorted. Nothing
// there (the ordinary case — most projects attach none) returns nil, so the
// field drops out of the turn JSON entirely and the turn is byte-identical to
// one from before this channel existed.
//
// Best-effort, exactly like the captured idea: a repo we cannot list is not a
// reason to fail someone's kickoff. Worst case the agent interviews without
// knowing the documents are there, which is what it did before #384.
func (s *Service) listReferenceDocs(ctx context.Context, ref sourcecontrol.RepoRef, at string) []string {
	entries, _, err := s.git.Workspace().List(ctx, ref, at)
	if err != nil {
		slog.WarnContext(ctx, "references unlistable; turn continues without them",
			"dir", ReferencesDir, "error", err)
		return nil
	}
	var out []string
	for _, e := range entries {
		// HasPrefix on the trailing-slash dir also excludes the folder entry
		// itself, and any sibling that merely starts with the same name.
		if strings.HasPrefix(e.Path, ReferencesDir) {
			out = append(out, e.Path)
		}
	}
	slices.Sort(out)
	return out
}
