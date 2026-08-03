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

// `/<skill>` flow commands — expanded by the SERVER, for every token (#373).
//
// Clients send commands VERBATIM. Expanding here (instead of the old
// client-side slashSkillInstruction split) buys two things:
//
//   - `/start` can be enriched with state no client sees — the idea captured
//     in specs/.agentic-engineer.toml, a file no client parses and the agent
//     cannot read (dot-led segments are stripped from every turn snapshot).
//   - The flow's EAGER SKILLS (#335 latency) are decided server-side, so a
//     console CTA and a typed command produce byte-identical turns — the old
//     CTA-vs-typed asymmetry cannot exist.
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
	"regexp"
	"strings"

	"github.com/wso2/aep/aep-api/internal/prompts"
	"github.com/wso2/aep/aep-api/internal/sourcecontrol"
)

// startCommand is the one token with server-side enrichment beyond expansion.
const startCommand = "/start"

// flowEagerSkills maps a flow token to the skill bodies the agents service
// inlines into the turn's prompt up front — the server-decided eager map
// (#373). A token absent here still expands; the model loads its skill lazily.
var flowEagerSkills = map[string][]string{
	"start":  {"grilling", "organization"},
	"amend":  {"grilling", "organization"},
	"design": {"design"},
}

// slashCommandPattern mirrors the grammar of the retired client-side expander
// (@aep/contracts/prompts slashSkillInstruction), deliberately narrow so real
// chat is never eaten: a single leading `/`, a skill-name token ending at
// whitespace or message end, optional free text after it. A bare `/`, a
// mid-message slash, `//x`, or trailing punctuation on the token all fail the
// match and pass through as ordinary chat.
var slashCommandPattern = regexp.MustCompile(`^/([a-z0-9-]+)(?:\s+([\s\S]+))?$`)

// expandFlowInstruction turns a raw instruction into the composed turn text.
// Non-command text passes through verbatim with an empty flow. A `/<skill>`
// command expands to the canonical skill pointer; `/start` is additionally
// enriched with the project idea (typed inline wins, else read from the
// descriptor at `at` — best-effort: no descriptor, no append, and the start
// skill asks the user instead).
func (s *Service) expandFlowInstruction(ctx context.Context, ref sourcecontrol.RepoRef, at, raw string) (text, flow string, eagerSkills []string) {
	m := slashCommandPattern.FindStringSubmatch(strings.TrimSpace(raw))
	if m == nil {
		return raw, "", nil
	}
	token, rest := m[1], strings.TrimSpace(m[2])

	if "/"+token == startCommand {
		idea := rest
		if idea == "" {
			idea = s.readProjectIdea(ctx, ref, at)
		}
		return prompts.StartInstruction + ideaSteer(idea), token, flowEagerSkills[token]
	}

	text = "Load the " + token + " skill and follow it."
	if rest != "" {
		text += "\n\n" + rest
	}
	return text, token, flowEagerSkills[token]
}
