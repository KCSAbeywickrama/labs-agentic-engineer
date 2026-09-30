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

import type * as Y from "yjs";
import {
  useAnswerBlocking,
  useSettleProposal,
  type Proposal,
  type ProposalVerdict,
  type SpecFeature,
} from "./api/specModel";
import { appendToSection, editFile, settleProposalInDoc } from "./collab/specEdits";

// The user's answers to what the agent left on the documents, each in two
// halves: the spec model's state (provisional; MSW on the mock) and the words
// in the doc. The doc is written once the state has changed, so a failed
// request leaves both as they were (its error is the hook's `error`).
// `mutateAsync`, not per-call callbacks: the doc is written even when the box
// that asked has gone.

async function settled(request: Promise<unknown>): Promise<boolean> {
  try {
    await request;
    return true;
  } catch {
    return false;
  }
}

/** Answer a feature's blocking question: it is unblocked, and the answer is a settled decision in its file. */
export function useAnswerBlockingQuestion(projectName: string, doc: Y.Doc) {
  const mutation = useAnswerBlocking(projectName);
  const answer = async (feature: Pick<SpecFeature, "id" | "path">, text: string) => {
    if (!(await settled(mutation.mutateAsync({ featureId: feature.id, answer: text })))) return;
    editFile(doc, feature.path, (tr) => appendToSection(tr, "Decisions", text));
  };
  return { answer, pending: mutation.isPending, error: mutation.error };
}

/** Accept or discard the agent's proposal, in the model and in the documents. */
export function useProposalVerdict(projectName: string, doc: Y.Doc) {
  const mutation = useSettleProposal(projectName);
  const settle = async (proposal: Proposal, verdict: ProposalVerdict) => {
    if (!(await settled(mutation.mutateAsync({ proposalId: proposal.id, verdict })))) return;
    settleProposalInDoc(doc, proposal, verdict);
  };
  return { settle, pending: mutation.isPending ? mutation.variables.verdict : null, error: mutation.error };
}
