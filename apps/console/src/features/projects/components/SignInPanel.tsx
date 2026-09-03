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
  Box,
  CircularProgress,
  IconButton,
  Link as MuiLink,
  Stack,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import { Copy, ExternalLink, Eye, EyeOff } from "@wso2/oxygen-ui-icons-react";
import { env } from "../../../config/env";
import { thunderUsersConsoleHref } from "../../../config/thunderConsole";
import {
  useProjectRoles,
  useRevealTestUserPassword,
} from "../../spec/api/roles";
import {
  publishedTestUsers,
  type PublishedTestUser,
} from "../lib/publishedTestUsers";

function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    return Promise.reject(new Error("Clipboard is not available"));
  }
  return navigator.clipboard.writeText(value);
}

/** The password's placeholder while it is hidden. Fixed width, monospace, so
 *  revealing swaps the characters without moving the icons beside them. */
const MASK = "**********";

function LoginRow({
  login,
  revealPassword,
}: {
  login: PublishedTestUser;
  revealPassword: (username: string) => Promise<string>;
}) {
  const [password, setPassword] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The password itself, read once and kept for the row's life.
   *
   * The eye toggles VISIBILITY, not another read: hiding a revealed password
   * and showing it again is a decision about this screen, not a reason to ask
   * the sealed store for a secret a second time. Copy shares the same path, so
   * a reader can copy a password they never put on screen.
   */
  const ensurePassword = async (): Promise<string | null> => {
    if (password !== null) return password;
    setBusy(true);
    setError(null);
    try {
      const value = await revealPassword(login.username);
      setPassword(value);
      return value;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (shown) {
      setShown(false);
      return;
    }
    if ((await ensurePassword()) !== null) setShown(true);
  };

  const copy = async () => {
    const value = await ensurePassword();
    if (value === null) return;
    setError(null);
    try {
      await copyText(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Box>
      <Tooltip title={login.coldStart ? `${login.role} · cold start` : login.role}>
        <Typography
          variant="body2"
          sx={{ fontFamily: "monospace", minWidth: 0, width: "fit-content" }}
        >
          {login.username}
        </Typography>
      </Tooltip>
      {/* The password line is ALWAYS here, masked until asked for. It used to
          appear only after a reveal, which made the card grow by a row at the
          moment of the click and left a reader with no sign that a password
          existed at all until they had already fetched it. */}
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ alignItems: "center", mt: 0.25 }}
      >
        <Typography
          variant="body2"
          aria-live="polite"
          // The mask is decoration: its ten asterisks would be read out one by
          // one, and the eye's accessible name already says whether the
          // password is showing.
          {...(shown && password !== null ? {} : { "aria-hidden": true })}
          sx={{ fontFamily: "monospace", color: "text.secondary" }}
        >
          {shown && password !== null ? password : MASK}
        </Typography>
        <Tooltip title={shown ? "Hide password" : "Reveal password"}>
          <span>
            <IconButton
              size="small"
              disabled={busy}
              aria-label={
                shown
                  ? `Hide the password for ${login.username}`
                  : `Reveal the password for ${login.username}`
              }
              onClick={() => void toggle()}
            >
              {busy ? (
                <CircularProgress size={12} color="inherit" />
              ) : shown ? (
                <EyeOff size={14} />
              ) : (
                <Eye size={14} />
              )}
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Copy password">
          <span>
            <IconButton
              size="small"
              disabled={busy}
              aria-label={`Copy the password for ${login.username}`}
              onClick={() => void copy()}
            >
              <Copy size={14} />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      {error !== null && (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      )}
    </Box>
  );
}

function ThunderSentence({ thunderUrl }: { thunderUrl: string }) {
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ display: "block" }}
    >
      Manage user accounts in{" "}
      <MuiLink
        href={thunderUsersConsoleHref(thunderUrl)}
        target="_blank"
        rel="noreferrer"
        variant="inherit"
        aria-label="Open Thunder Console to add or remove real accounts"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
        }}
      >
        Thunder Console
        <ExternalLink size={11} aria-hidden />
      </MuiLink>
    </Typography>
  );
}

/**
 * Sign-in facts for a live deployment. Parent mounts only when deploy is green.
 * Empty logins stay silent except for the Thunder Console link.
 */
export function SignInPanel({
  logins,
  thunderUrl,
  revealPassword,
  loadState = "ready",
}: {
  logins: readonly PublishedTestUser[];
  thunderUrl: string;
  revealPassword: (username: string) => Promise<string>;
  loadState?: "ready" | "pending" | "error";
}) {
  return (
    <Box>
      {loadState === "pending" && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mb: 1 }}
        >
          Loading test users…
        </Typography>
      )}
      {loadState === "error" && (
        <Typography
          variant="caption"
          color="error"
          sx={{ display: "block", mb: 1 }}
        >
          Couldn&apos;t load test users.
        </Typography>
      )}
      {loadState === "ready" && logins.length > 0 && (
        <>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block" }}
          >
            Test users for agents on this environment
          </Typography>
          <Stack spacing={1} sx={{ mt: 1, mb: 1.5 }}>
            {logins.map((login) => (
              <LoginRow
                key={login.username}
                login={login}
                revealPassword={revealPassword}
              />
            ))}
          </Stack>
        </>
      )}
      <ThunderSentence thunderUrl={thunderUrl} />
    </Box>
  );
}

/**
 * Live Deploy wiring for SignInPanel. Mount only when deploy is green so the
 * roles GET does not run while the panel is hidden.
 */
export function ProjectSignInPanel({
  projectName,
}: {
  projectName: string;
}) {
  const live = useProjectRoles(projectName, true);
  const reveal = useRevealTestUserPassword(projectName);
  const loadState = live.isPending
    ? "pending"
    : live.isError
      ? "error"
      : "ready";
  const logins =
    loadState === "ready" ? publishedTestUsers(live.data?.testUsers ?? []) : [];

  return (
    <SignInPanel
      logins={logins}
      thunderUrl={env.thunderUrl}
      loadState={loadState}
      revealPassword={async (username) => {
        const data = await reveal.mutateAsync(username);
        return data.password;
      }}
    />
  );
}
