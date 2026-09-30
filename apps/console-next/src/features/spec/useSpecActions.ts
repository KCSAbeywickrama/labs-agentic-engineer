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
import { useSettleProposal, type Proposal, type ProposalVerdict } from "./api/specModel";
import { settleProposalInDoc } from "./collab/specEdits";

// The user's verdict on the agent's proposal, in two halves: the spec model's
// state (provisional; MSW on the mock) and the words in the doc. The doc is
// written once the state has changed, so a failed request leaves both as they
// were (its error is the hook's `error`). `mutateAsync`, not per-call
// callbacks: the doc is written even when the bar that asked has gone. An
// answer to a blocking question is the doc alone (collab/specEdits.ts).

async function settled(request: Promise<unknown>): Promise<boolean> {
  try {
    await request;
    return true;
  } catch {
    return false;
  }
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
