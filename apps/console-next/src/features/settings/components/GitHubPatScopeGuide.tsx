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

import { Box, Button, Chip, Typography } from "@wso2/oxygen-ui";
import { ExternalLink } from "@wso2/oxygen-ui-icons-react";

// The platform's documented classic-PAT scope set (carried over from the
// legacy console's ConnectPATForm; final confirmation tracked on the BE
// handshake issue #171). Rendered identically by the onboarding wizard and
// the Settings GitHub card so the two surfaces can't drift.
const REQUIRED_PAT_SCOPES = [
  {
    scope: "repo",
    why: "read and write the org's spec, code, and skills repositories",
  },
  {
    scope: "admin:org",
    why: "create and manage repositories under the GitHub organization",
  },
  {
    scope: "admin:repo_hook",
    why: "register the per-repo webhook when a project repo is provisioned",
  },
] as const;

// Classic-token creation URL with the required scopes preselected.
const TOKEN_URL = `https://github.com/settings/tokens/new?scopes=${REQUIRED_PAT_SCOPES.map(
  (s) => s.scope,
).join(",")}&description=Agentic%20Engineer%20Platform`;

// Scope checklist + preselected-scopes creation link for a classic GitHub
// PAT. The surrounding surface owns any intro copy; this renders only the
// guidance that must stay identical everywhere.
export function GitHubPatScopeGuide() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Typography variant="body2">
        The token must be a <strong>classic personal access token</strong> with
        these scopes:
      </Typography>
      <Box
        component="ul"
        sx={{
          m: 0,
          pl: 3,
          display: "flex",
          flexDirection: "column",
          gap: 0.75,
        }}
      >
        {REQUIRED_PAT_SCOPES.map(({ scope, why }) => (
          <Typography key={scope} component="li" variant="body2">
            <Chip
              label={scope}
              size="small"
              sx={{ fontFamily: "monospace", mr: 1 }}
            />
            {why}
          </Typography>
        ))}
      </Box>
      <Button
        variant="text"
        size="small"
        href={TOKEN_URL}
        target="_blank"
        rel="noreferrer"
        endIcon={<ExternalLink size={14} />}
        sx={{ alignSelf: "flex-start" }}
      >
        Create a token on GitHub (scopes preselected)
      </Button>
    </Box>
  );
}
