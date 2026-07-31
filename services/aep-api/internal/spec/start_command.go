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

// `/start` — the project kickoff command, and the ONE slash command the server
// owns rather than the client.
//
// Every other `/<skill>` shortcut is expanded client-side by
// slashSkillInstruction (@aep/contracts/prompts) before the turn is sent, so
// the server only ever sees prose. `/start` is passed through VERBATIM instead,
// because the server has to recognize it: it is the only command whose
// instruction must be enriched with state the client cannot see — the idea
// captured in specs/.agentic-engineer.toml, a file no client parses and the
// agent cannot read.
//
// Deliberately NOT signalled through `useCase`: that field is baked into the
// conversation identity (namespacedID → org_X--proj_Y--<useCase>--<uuid>), so
// keying the kickoff on it would put the turn in a different conversation from
// the chat around it. `/start` runs an INTERVIEW, so its follow-up answers —
// ordinary chat turns — must land in the same conversation or the agent loses
// the thread of its own questions.
//
// The idea only ever rides the FIRST turn: after that it is in the
// conversation history, so nothing needs re-attaching.

package spec

import "strings"

// startCommand is the verbatim token clients pass through unexpanded.
const startCommand = "/start"

// StartInstruction is the server-side expansion of `/start`.
//
// MUST match slashSkillInstruction("/start") in packages/contracts/prompts —
// the client-side expander every other `/<skill>` command goes through.
// playground/test/steer-parity.test.ts pins the two together.
const StartInstruction = "Load the start skill and follow it."

// parseStartCommand reports whether a raw instruction is the `/start` command,
// returning any idea typed inline after it (`/start an expense tracker`).
//
// The grammar is deliberately narrow — the exact token, alone or followed by
// whitespace — so ordinary prose that merely mentions the word is never eaten.
func parseStartCommand(instruction string) (inlineIdea string, ok bool) {
	trimmed := strings.TrimSpace(instruction)
	if trimmed == startCommand {
		return "", true
	}
	rest, found := strings.CutPrefix(trimmed, startCommand+" ")
	if !found {
		return "", false
	}
	return strings.TrimSpace(rest), true
}
