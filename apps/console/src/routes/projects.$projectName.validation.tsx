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
import { ValidationPage } from "../features/validation/components/ValidationPage";

// ?view=logs shows the run log; absent shows the report (once a run completed).
// The param is validated as the single literal "logs" — anything else clears it.
export const Route = createFileRoute("/projects/$projectName/validation")({
  validateSearch: (search: Record<string, unknown>): { view?: "logs" } =>
    search.view === "logs" ? { view: "logs" } : {},
  component: ValidationRoute,
});

function ValidationRoute() {
  const { projectName } = Route.useParams();
  const { view } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ValidationPage
      projectName={projectName}
      view={view}
      onViewChange={(next) =>
        void navigate({
          search: next ? { view: next } : {},
          replace: true,
        })
      }
    />
  );
}
