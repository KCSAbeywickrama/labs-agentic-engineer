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

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from "@wso2/oxygen-ui";
import { Eye, EyeOff, GitHub, Lightbulb } from "@wso2/oxygen-ui-icons-react";
import { useConnectGitHubPat } from "../../settings/api/queries";
import { GitHubPatScopeGuide } from "../../settings/components/GitHubPatScopeGuide";

// Validation is the PATCH itself: the BFF probes the PAT against GitHub
// before persisting (#96 pattern), so errors surface from the mutation.
export function GitHubStep() {
  const [pat, setPat] = useState("");
  const [githubLogin, setGithubLogin] = useState("");
  const [showPat, setShowPat] = useState(false);
  const connect = useConnectGitHubPat();

  const submit = () => {
    const org = githubLogin.trim();
    if (!pat || !org) return;
    connect.mutate({ pat, githubLogin: org });
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <GitHub size={22} />
        <Typography variant="h6">Connect GitHub</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary">
        The platform hosts your organization's skills catalogue and project
        repos on GitHub. The token must be owned by a member of the GitHub
        organization the platform should use.
      </Typography>
      <Alert severity="info" icon={<Lightbulb size={18} />}>
        Pro tip: create a dedicated GitHub organization for this platform so
        its agents' repos, tokens, and skills catalogue stay isolated from
        your team's main org.
      </Alert>

      <GitHubPatScopeGuide />

      <TextField
        required
        label="GitHub organization name"
        placeholder="octocat"
        value={githubLogin}
        onChange={(e) => setGithubLogin(e.target.value)}
        helperText="The GitHub organization the platform reads and writes repos in."
        fullWidth
      />
      <TextField
        required
        label="Personal access token"
        placeholder="ghp_..."
        type={showPat ? "text" : "password"}
        value={pat}
        onChange={(e) => setPat(e.target.value)}
        fullWidth
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label={showPat ? "hide token" : "show token"}
                  onClick={() => setShowPat((v) => !v)}
                  edge="end"
                >
                  {showPat ? <EyeOff size={18} /> : <Eye size={18} />}
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />

      {connect.isError && <Alert severity="error">{connect.error.message}</Alert>}

      <Button
        variant="contained"
        onClick={submit}
        disabled={!pat || !githubLogin.trim() || connect.isPending}
        sx={{ alignSelf: "flex-end" }}
      >
        {connect.isPending ? "Validating…" : "Connect GitHub"}
      </Button>
    </Box>
  );
}
