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

import { http, HttpResponse } from "msw";
import {
  PROVISIONAL_PROPOSAL_PATH,
  PROVISIONAL_SPEC_CHANGES_SEEN_PATH,
  PROVISIONAL_SPEC_PATH,
  type SpecModel,
} from "../../features/spec/api/specModel";
import { liveDesign, saveDesign } from "../designState";
import { liveSpec, specView } from "../specState";

// PROVISIONAL — mock-only until S3 lands the spec model's contract; see
// features/spec/api/specModel.ts and mocks/specState.ts.

export const specHandlers = [
  http.get(`*${PROVISIONAL_SPEC_PATH}`, ({ params }) =>
    HttpResponse.json<SpecModel>(specView(String(params.projectName))),
  ),

  http.post(`*${PROVISIONAL_PROPOSAL_PATH}`, ({ params }) => {
    const model = liveSpec(String(params.projectName));
    const proposal = model.proposal;
    if (!proposal || proposal.id !== params.proposalId) {
      return HttpResponse.json({ detail: "That change is no longer waiting." }, { status: 404 });
    }
    if (params.verdict === "accept") model.productWide.push(...proposal.productWide);
    else if (params.verdict !== "discard") return HttpResponse.json({ detail: "Unknown verdict." }, { status: 400 });
    model.proposal = null;
    return HttpResponse.json<SpecModel>(specView(String(params.projectName)));
  }),

  // The user opened the Spec tab: the lines design comments changed are seen.
  http.post(`*${PROVISIONAL_SPEC_CHANGES_SEEN_PATH}`, ({ params }) => {
    const projectName = String(params.projectName);
    const design = liveDesign(projectName);
    design.comments = design.comments.map((c) => ({ ...c, specSeen: true }));
    saveDesign(projectName, design);
    return HttpResponse.json<SpecModel>(specView(projectName));
  }),
];
