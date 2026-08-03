/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

// Code generated from packages/contracts/prompts/strings.json by prompts/gen.mjs. DO NOT EDIT.

export const startInstruction = "Load the start skill and follow it.";
export const ideaSteerPrefix = "\n\nThe user's idea for this project:\n\n";
export const specPathsRule = "\n\nSpec sources live under specs/ (requirements under specs/requirements/, design under specs/design/) — when creating a file that does not exist yet, always use its full path, never a bare filename.";
export const planInstruction = "Plan the implementation Tasks for this project. Load the task-planning skill and follow it. The design is under specs/design/ and the requirements under specs/requirements/. When a \"Milestone scope\" section lists in-scope stories, cover every story marked NEEDS TASKS and leave COVERED stories' Tasks untouched. Existing open Tasks (if any) are listed at the end of this message for reference — add Tasks ONLY for work they do not cover, and do not recreate or update the listed Tasks in this turn.";
export const planContextHeader = "\n\n## Existing open Tasks in this version (reference)\n";
export const targetSuffixPrefix = "\n\n(target: ";
export const targetSuffixClose = ")";
export const headlessNote = "\n\nNo interview is possible in this run: do not call ask_question or ask_questions. Generate on stated assumptions and mark each assumption as assumed in the document.";
