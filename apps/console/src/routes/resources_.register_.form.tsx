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
import { RegisterFormPage } from "../features/marketplace/components/RegisterFormPage";

export const Route = createFileRoute("/resources_/register_/form")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { prompt?: string; name?: string } => {
    const next: { prompt?: string; name?: string } = {};
    if (typeof search.prompt === "string") next.prompt = search.prompt;
    if (typeof search.name === "string") next.name = search.name;
    return next;
  },
  component: RegisterFormRoute,
});

function RegisterFormRoute() {
  const { prompt, name } = Route.useSearch();
  return (
    <RegisterFormPage
      {...(prompt !== undefined ? { prompt } : {})}
      {...(name !== undefined ? { name } : {})}
    />
  );
}
