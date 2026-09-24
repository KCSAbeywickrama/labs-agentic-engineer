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
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from "@wso2/oxygen-ui";
import { ExternalLink, Eye, EyeOff } from "@wso2/oxygen-ui-icons-react";
import type { AiSettings } from "../aiSettings";

type StoredKey = NonNullable<AiSettings["apiKey"]>;

/**
 * The org's Anthropic API key, a row of the AI agents card.
 *
 * A new or replacement key is part of the card's draft and goes out with the
 * card's one Save; the server validates it against Anthropic before writing
 * anything, and a refusal comes back here, on the key field. Disconnecting is
 * the exception: it is destructive, so it is confirmed and sent on its own.
 */
export function AnthropicKeyRow({
  stored,
  value,
  onChange,
  error,
  disabled,
  hasSubscription,
  onDisconnect,
  disconnecting,
  disconnectError,
  explained,
}: {
  stored: StoredKey | null;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  disabled: boolean;
  hasSubscription: boolean;
  onDisconnect: (onDone: () => void) => void;
  disconnecting: boolean;
  disconnectError: string | undefined;
  /** Whether the row explains why the key is needed; the wizard explains it above. */
  explained: boolean;
}) {
  const [showKey, setShowKey] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const connected = stored !== null;
  const editing = !connected || replacing;

  const cancelReplace = () => {
    onChange("");
    setReplacing(false);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Typography variant="subtitle2" component="h3">
        Anthropic API key
      </Typography>

      {connected ? (
        <>
          <Box
            sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }}
          >
            <Typography variant="body2" fontFamily="monospace">
              {stored.keyPrefix}•••••••••{stored.keyLast4}
            </Typography>
            {!replacing && (
              <Button
                size="small"
                onClick={() => setReplacing(true)}
                disabled={disabled}
              >
                Replace
              </Button>
            )}
            <Button
              size="small"
              color="error"
              onClick={() => setDisconnectOpen(true)}
              disabled={disabled}
            >
              Disconnect
            </Button>
          </Box>
          <Typography variant="body2" color="text.secondary">
            Connected {new Date(stored.connectedAt).toLocaleString()}
            {stored.lastValidatedAt &&
              ` · last validated ${new Date(stored.lastValidatedAt).toLocaleString()}`}
          </Typography>
          {stored.validationError && (
            <Alert severity="warning">{stored.validationError}</Alert>
          )}
        </>
      ) : (
        explained && (
          <Typography variant="body2" color="text.secondary">
            Every agent calls the model with this key. There is no platform
            fallback, so agents cannot run until one is added.
          </Typography>
        )
      )}

      {editing && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 1 }}>
          <TextField
            label={connected ? "New API key" : "API key"}
            placeholder="sk-ant-api…"
            type={showKey ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            error={error !== undefined}
            helperText={error ?? "Validated with Anthropic when you save."}
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
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
            {connected && (
              <Button size="small" onClick={cancelReplace} disabled={disabled}>
                Keep the current key
              </Button>
            )}
            <Button
              variant="text"
              size="small"
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer"
              endIcon={<ExternalLink size={14} />}
            >
              Get an API key
            </Button>
          </Box>
        </Box>
      )}

      <Dialog
        open={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Disconnect Anthropic?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Every agent loses access to Claude until a new key is connected.
            {/* The server removes the subscription with the key it depends on. */}
            {hasSubscription &&
              " The stored Claude subscription token is deleted as well."}
          </DialogContentText>
          {disconnectError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {disconnectError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisconnectOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => onDisconnect(() => setDisconnectOpen(false))}
            disabled={disconnecting}
          >
            Disconnect
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
