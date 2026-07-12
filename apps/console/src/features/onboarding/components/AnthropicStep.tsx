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
import { ExternalLink, Eye, EyeOff, Key } from "@wso2/oxygen-ui-icons-react";
import { useConnectAnthropic } from "../../settings/api/queries";

// Same probe-before-persist pattern as the GitHub step: the BFF validates
// the key against Anthropic before persisting (#96).
export function AnthropicStep() {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const connect = useConnectAnthropic();

  const submit = () => {
    if (!apiKey) return;
    connect.mutate(apiKey);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <Key size={22} />
        <Typography variant="h6">Connect Anthropic</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary">
        The platform's agents call Claude with your organization's Anthropic
        API key. The key is validated against Anthropic before it is saved,
        and it can be replaced later in Settings.
      </Typography>

      <Button
        variant="text"
        size="small"
        href="https://console.anthropic.com/settings/keys"
        target="_blank"
        rel="noreferrer"
        endIcon={<ExternalLink size={14} />}
        sx={{ alignSelf: "flex-start" }}
      >
        Get an API key from Anthropic
      </Button>

      <TextField
        required
        label="API key"
        placeholder="sk-ant-..."
        type={showKey ? "text" : "password"}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        fullWidth
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label={showKey ? "hide key" : "show key"}
                  onClick={() => setShowKey((v) => !v)}
                  edge="end"
                >
                  {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
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
        disabled={!apiKey || connect.isPending}
        sx={{ alignSelf: "flex-end" }}
      >
        {connect.isPending ? "Validating…" : "Connect Anthropic"}
      </Button>
    </Box>
  );
}
