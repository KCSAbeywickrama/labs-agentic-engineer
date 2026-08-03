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

// Code generated from packages/contracts/prompts/strings.json by prompts/gen.mjs. DO NOT EDIT.

// Package prompts holds the generated prompt strings shared with the TS
// consumers via packages/contracts/prompts/strings.json — the single authored
// copy. Edit the JSON and run `make gen`; never edit this file.
package prompts

const StartInstruction = "Load the start skill and follow it."
const IdeaSteerPrefix = "\n\nThe user's idea for this project:\n\n"
const SpecPathsRule = "\n\nSpec sources live under specs/ (requirements under specs/requirements/, design under specs/design/) — when creating a file that does not exist yet, always use its full path, never a bare filename."
const PlanInstruction = "Plan the implementation Tasks for this project. Load the task-planning skill and follow it. The design is under specs/design/ and the requirements under specs/requirements/. Existing open Tasks (if any) are listed at the end of this message for reference — add Tasks ONLY for work they do not cover, and do not recreate or update the listed Tasks in this turn."
const PlanContextHeader = "\n\n## Existing open Tasks in this version (reference)\n"
const TargetSuffixPrefix = "\n\n(target: "
const TargetSuffixClose = ")"
const HeadlessNote = "\n\nNo interview is possible in this run: do not call ask_question or ask_questions. Generate on stated assumptions and mark each assumption as assumed in the document."
