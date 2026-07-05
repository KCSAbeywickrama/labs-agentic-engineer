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
import { FileText } from "@wso2/oxygen-ui-icons-react";
import { SectionPlaceholder } from "../features/projects/components/SectionPlaceholder";

export const Route = createFileRoute("/projects/$projectName/spec")({
  component: SpecPlaceholderRoute,
});

function SpecPlaceholderRoute() {
  const { projectName } = Route.useParams();
  return (
    <SectionPlaceholder
      icon={<FileText size={48} />}
      title="Spec is on its way"
      description="This is where you and the agents work out what to build — the requirement and the design together, as one living spec. Its own feature issue will land it."
      projectName={projectName}
    />
  );
}
