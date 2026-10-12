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

import { Button, Tooltip } from "@wso2/oxygen-ui";
import { useStartInterview } from "../../agent-chat/useStartInterview";
import { useDesignTurns } from "../../design/useDesignTurns";
import { specActions } from "../model/specActions";
import { useSpecWorkspace } from "../useSpecWorkspace";

/** The Spec card's header: the next interview and Design, one of them the primary (model/specActions.ts). */
export function SpecActions({ projectName, file }: { projectName: string; file?: string | undefined }) {
  const { workspace } = useSpecWorkspace(projectName);
  const interview = useStartInterview(projectName);
  const design = useDesignTurns(projectName);
  if (!workspace) return null;
  const view = specActions({ features: workspace.features, design: workspace.design, file });
  return (
    <>
      {view.interview && (
        <Button
          size="small"
          variant={view.interview.primary ? "contained" : "outlined"}
          disabled={!interview.ready}
          onClick={() => view.interview && interview.start(view.interview.feature)}
        >
          Interview {view.interview.feature.name}
        </Button>
      )}
      {view.design &&
        ("disabled" in view.design ? (
          <Tooltip title={view.design.disabled}>
            <span>
              <Button size="small" variant="outlined" disabled>
                Design
              </Button>
            </span>
          </Tooltip>
        ) : (
          <Button size="small" variant={view.design.primary ? "contained" : "outlined"} disabled={!design.ready} onClick={design.design}>
            {view.design.label}
          </Button>
        ))}
    </>
  );
}
