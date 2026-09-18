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

import { createFileRoute } from "@tanstack/react-router";
import { ValidationLedger } from "../features/validation/components/ValidationLedger";

/**
 * The validation ledger — one row per version.
 *
 * This route used to BE the validation page, pinned to the newest milestone
 * with no way to reach any other. Old links land here rather than redirecting:
 * a list of every version is a better answer to "show me validation" than the
 * newest one was, and `?view=logs` — the page's old report/log toggle — is
 * dropped by validateSearch rather than honoured, because the two now sit on
 * one page.
 */
export const Route = createFileRoute("/projects/$projectName/validation/")({
  validateSearch: (): Record<string, never> => ({}),
  component: ValidationLedgerRoute,
});

function ValidationLedgerRoute() {
  const { projectName } = Route.useParams();
  return <ValidationLedger projectName={projectName} />;
}
