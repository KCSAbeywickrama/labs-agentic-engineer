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
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from "@wso2/oxygen-ui";
import { ExternalLink, Eye, EyeOff, GitHub, Lightbulb } from "@wso2/oxygen-ui-icons-react";
import type { components } from "../../../generated/aep-api";
import { useConnectGitHubPat, useDisconnectGitProvider } from "../api/queries";

type GitProviderProjection = components["schemas"]["GitProviderProjection"];

export function GitHubCredentialCard({
  gitProvider,
}: {
  gitProvider: GitProviderProjection | null;
}) {
  const [pat, setPat] = useState("");
  const [githubLogin, setGithubLogin] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [uninstall, setUninstall] = useState(true);

  const connect = useConnectGitHubPat();
  const disconnect = useDisconnectGitProvider();

  const connected = gitProvider !== null;

  const submit = () => {
    connect.mutate(
      { pat, ...(githubLogin ? { githubLogin } : {}) },
      {
        onSuccess: () => {
          setPat("");
          setGithubLogin("");
        },
      },
    );
  };

  const confirmDisconnect = () => {
    disconnect.mutate(uninstall, {
      onSuccess: () => setDisconnectOpen(false),
    });
  };

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
          <GitHub size={22} />
          <Typography variant="h6">GitHub</Typography>
          {connected && (
            <Chip label={gitProvider.status} size="small" color="success" />
          )}
        </Box>
        <Divider sx={{ mb: 3 }} />

        {connected ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 3 }}>
            {(gitProvider.githubLogin ?? gitProvider.identityLogin) && (
              <Typography variant="body2">
                Organization:{" "}
                <strong>
                  {gitProvider.githubLogin ?? gitProvider.identityLogin}
                </strong>
              </Typography>
            )}
            <Typography variant="body2">
              Connected as{" "}
              <strong>
                {gitProvider.identityName ??
                  gitProvider.identityLogin ??
                  gitProvider.githubLogin}
              </strong>
              {gitProvider.identityEmail
                ? ` (${gitProvider.identityEmail})`
                : ""}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Connected {new Date(gitProvider.connectedAt).toLocaleString()}
              {gitProvider.lastValidatedAt &&
                ` · last validated ${new Date(gitProvider.lastValidatedAt).toLocaleString()}`}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mb: 3 }}>
            <Typography variant="body2" color="text.secondary">
              Connect a GitHub personal access token with{" "}
              <strong>organization-level access</strong> so the platform can
              read and write this org's spec and code repos and host its skills
              catalogue. Use a fine-grained token with the organization set as
              the resource owner, or a classic token with the{" "}
              <code>repo</code> scope owned by a member of the org.
            </Typography>
            <Alert severity="info" icon={<Lightbulb size={18} />}>
              Pro tip: create a dedicated GitHub organization for this platform
              so its agents' repos, tokens, and skills catalogue stay isolated
              from your team's main org.
            </Alert>
          </Box>
        )}

        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <TextField
            label={
              connected
                ? "Replace personal access token"
                : "Personal access token"
            }
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
          <TextField
            label="GitHub organization name"
            placeholder="octocat"
            value={githubLogin}
            onChange={(e) => setGithubLogin(e.target.value)}
            fullWidth
          />
          <Button
            variant="text"
            size="small"
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noreferrer"
            endIcon={<ExternalLink size={14} />}
            sx={{ alignSelf: "flex-start" }}
          >
            Create a token on GitHub
          </Button>
          {connect.isError && (
            <Alert severity="error">{connect.error.message}</Alert>
          )}
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 1,
              justifyContent: "space-between",
            }}
          >
            <Button
              variant="contained"
              onClick={submit}
              disabled={!pat || connect.isPending}
            >
              {connect.isPending
                ? "Validating…"
                : connected
                  ? "Replace token"
                  : "Connect"}
            </Button>
            {connected && (
              <Button
                color="error"
                variant="outlined"
                onClick={() => setDisconnectOpen(true)}
              >
                Disconnect
              </Button>
            )}
          </Box>
        </Box>
      </CardContent>

      <Dialog
        open={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Disconnect GitHub?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Projects relying on this org's GitHub connection will lose spec and
            code access until it's reconnected.
          </DialogContentText>
          <FormControlLabel
            control={
              <Checkbox
                checked={uninstall}
                onChange={(e) => setUninstall(e.target.checked)}
              />
            }
            label="Uninstall the GitHub App (leave unchecked to keep it installed for later re-adoption)"
          />
          {disconnect.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {disconnect.error.message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisconnectOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={confirmDisconnect}
            disabled={disconnect.isPending}
          >
            Disconnect
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
