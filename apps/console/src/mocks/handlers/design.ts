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
import { PROVISIONAL_DEPENDENCY_PATH, PROVISIONAL_DESIGN_PATH, type DesignModel } from "../../features/design/api/designModel";
import { designView, liveDesign, saveDesign } from "../designState";

// PROVISIONAL — mock-only until E1/E4; see features/design/api/designModel.ts
// and mocks/designState.ts. The design turns themselves are chat turns
// (fixtures/designTurns.ts); settling a dependency is the user's own move.

function detail(message: string, status: number): Response {
  return HttpResponse.json({ detail: message }, { status });
}

export const designHandlers = [
  http.get(`*${PROVISIONAL_DESIGN_PATH}`, ({ params }) =>
    HttpResponse.json<DesignModel>(designView(String(params.projectName))),
  ),

  http.post(`*${PROVISIONAL_DEPENDENCY_PATH}`, async ({ params, request }) => {
    const projectName = String(params.projectName);
    const design = liveDesign(projectName);
    const dependency = design.dependencies.find((d) => d.featureId === params.featureId && d.answer === null);
    const body = (await request.json()) as { answer?: unknown };
    if (!dependency) return detail("Nothing is waiting on that feature.", 404);
    if (typeof body.answer !== "string" || !body.answer.trim()) return detail("An answer is required.", 422);
    dependency.answer = body.answer.trim();
    saveDesign(projectName, design);
    return HttpResponse.json<DesignModel>(designView(projectName));
  }),
];
