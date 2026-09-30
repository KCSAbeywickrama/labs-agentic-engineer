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

import { Alert, AlertTitle, Box, Typography } from "@wso2/oxygen-ui";
import type { components } from "../../../generated/aep-api";
import { AiAgentsCard } from "../../settings/components/AiAgentsCard";
import { connectionWasDisconnected } from "../keyDisconnected";

type ConfigProjection = components["schemas"]["ConfigProjection"];

/**
 * The wizard's "Connect a model" step: the settings card itself, unframed,
 * with an intro. Continue saves the connection (the save probes it), and the
 * wizard advances once `llm` is non-null.
 */
export function AiAgentsStep({ config }: { config: ConfigProjection }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {connectionWasDisconnected(config) ? (
        <Alert severity="warning">
          <AlertTitle>Your model connection was disconnected</AlertTitle>
          Agents cannot run until a connection is saved.
        </Alert>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Connect the model your agents will use. Anthropic&apos;s API is filled
          in; switch the format or change the URL for any other provider or your
          own endpoint. Continue checks the connection and saves it; Test
          connection is optional. You can change this later in Settings.
        </Typography>
      )}
      <AiAgentsCard config={config} onboarding />
    </Box>
  );
}
