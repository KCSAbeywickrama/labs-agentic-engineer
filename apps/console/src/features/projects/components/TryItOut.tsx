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

import { useMemo, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  Chip,
  IconButton,
  Link as MuiLink,
  ListingTable,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import {
  Copy,
  ExternalLink,
  FlaskConical,
  Search,
} from "@wso2/oxygen-ui-icons-react";
import { parseOpenApi, type Operation } from "@aep/ui-openapi-view";
import { StatusChip } from "../../../components/StatusChip";
import { env } from "../../../config/env";
import { thunderUsersConsoleHref } from "../../../config/thunderConsole";
import { useProjectRoles, useRevealTestUserPassword } from "../../spec/api/roles";
import { useComponentOpenApi } from "../api/queries";
import {
  curlFor,
  filterEndpoints,
  flattenEndpoints,
  methodTone,
  methodsIn,
} from "../lib/deploymentDetail";
import { cardChip } from "../lib/deploymentLedger";
import type { DeploymentCard } from "../lib/deploymentRows";
import { publishedTestUsers, type PublishedTestUser } from "../lib/publishedTestUsers";
import { AccentPill } from "./AccentPill";
import { TestUserRow } from "./TestUsersDialog";

// TRY IT OUT (ADR-0032, the Deployment Detail design): each live component
// as a panel a person can act on. A web application is visited, and carries
// the test users it exists to sign in with; a service lists its endpoints off
// the contract the platform serves, each with a curl for the deployed URL and
// a way into the contract viewer. What the design drew and this does not
// build: a health probe (nothing probes), a token picker, "Get token" and
// "Open app as" (nothing mints a token), and "Run" (the console holds no
// token to run with).

function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    return Promise.reject(new Error("Clipboard is not available"));
  }
  return navigator.clipboard.writeText(value);
}

/** "web app" · "service" — the type as a person says it. */
function kindLabel(type: string | undefined): string {
  return type === "web-application" ? "web app" : (type ?? "");
}

/** The URL row: the label, the link, and a copy control. */
function UrlRow({ url, name }: { url: string; name: string }) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <Stack
      direction="row"
      spacing={1.25}
      sx={{ alignItems: "center", px: 2, py: 1, borderTop: 1, borderColor: "divider" }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ width: 40, fontWeight: 700, letterSpacing: "0.06em" }}>
        URL
      </Typography>
      <MuiLink
        href={url}
        target="_blank"
        rel="noreferrer"
        variant="body2"
        sx={{
          fontFamily: "monospace",
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          minWidth: 0,
          flexGrow: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {url} <ExternalLink size={13} aria-hidden />
      </MuiLink>
      <Tooltip title={note ?? "Copy URL"}>
        <IconButton
          size="small"
          aria-label={`Copy the URL of ${name}`}
          onClick={() =>
            void copyText(url)
              .then(() => setNote("Copied"))
              .catch((e: unknown) => setNote(e instanceof Error ? e.message : String(e)))
          }
        >
          <Copy size={14} />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

// ── Test users ──────────────────────────────────────────────────────────────

const USERS_SHOWN = 5;

/**
 * The environment's test accounts, inline: they exist to sign in to the app
 * above them, so they sit inside its panel. Filterable, and folded past five
 * rows so a many-role app does not push the API panel off the screen.
 */
export function TestUsersInline({
  logins,
  loadState,
  thunderUrl,
  revealPassword,
}: {
  logins: readonly PublishedTestUser[];
  loadState: "ready" | "pending" | "error";
  thunderUrl: string;
  revealPassword: (username: string) => Promise<string>;
}) {
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const q = query.trim().toLowerCase();
  const matching = logins.filter(
    (l) => q === "" || l.username.toLowerCase().includes(q) || l.role.toLowerCase().includes(q),
  );
  const shown = all ? matching : matching.slice(0, USERS_SHOWN);
  return (
    <Box sx={{ borderTop: 1, borderColor: "divider" }}>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1, px: 2, py: 1.25 }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Sign in with a test user
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {loadState === "ready"
            ? `${logins.length} account${logins.length === 1 ? "" : "s"} · one per role · Development only`
            : loadState === "pending"
              ? "Loading test users…"
              : "Couldn't load test users."}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        {logins.length > USERS_SHOWN && (
          <TextField
            size="small"
            placeholder="Filter by role or name"
            inputProps={{ "aria-label": "Filter test users by role or name" }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ width: 220 }}
          />
        )}
        <MuiLink
          href={thunderUsersConsoleHref(thunderUrl)}
          target="_blank"
          rel="noreferrer"
          variant="body2"
          aria-label="Open Thunder Console to add or remove real accounts"
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
        >
          Manage in Thunder Console <ExternalLink size={12} aria-hidden />
        </MuiLink>
      </Stack>
      {loadState === "ready" && logins.length > 0 && (
        <>
          <ListingTable.Container sx={{ width: "100%" }}>
            <ListingTable density="compact">
              <ListingTable.Head>
                <ListingTable.Row>
                  <ListingTable.Cell>Account</ListingTable.Cell>
                  <ListingTable.Cell sx={{ width: 240 }}>Password</ListingTable.Cell>
                  <ListingTable.Cell sx={{ width: 160 }}>Role</ListingTable.Cell>
                  <ListingTable.Cell sx={{ width: 120 }}>Cold start</ListingTable.Cell>
                </ListingTable.Row>
              </ListingTable.Head>
              <ListingTable.Body>
                {shown.map((login) => (
                  <TestUserRow key={login.username} login={login} revealPassword={revealPassword} />
                ))}
              </ListingTable.Body>
            </ListingTable>
          </ListingTable.Container>
          {matching.length > USERS_SHOWN && (
            <Stack
              direction="row"
              sx={{ alignItems: "center", justifyContent: "space-between", px: 2, py: 1, borderTop: 1, borderColor: "divider" }}
            >
              <Typography variant="caption" color="text.secondary">
                Showing {shown.length} of {matching.length}
              </Typography>
              <Button size="small" onClick={() => setAll((v) => !v)}>
                {all ? "Show fewer" : "Show all"}
              </Button>
            </Stack>
          )}
          {matching.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
              No account matches.
            </Typography>
          )}
        </>
      )}
      {loadState === "ready" && logins.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 1.5 }}>
          No test users were published for this version.
        </Typography>
      )}
    </Box>
  );
}

/** Live wiring for the inline panel. Mounted only for a green development. */
export function useTestUsers(projectName: string, enabled: boolean) {
  const live = useProjectRoles(projectName, enabled);
  const reveal = useRevealTestUserPassword(projectName);
  const loadState = live.isPending ? "pending" : live.isError ? "error" : "ready";
  const logins =
    loadState === "ready" ? publishedTestUsers(live.data?.testUsers ?? []) : [];
  return {
    logins,
    loadState: loadState as "ready" | "pending" | "error",
    thunderUrl: env.thunderUrl,
    revealPassword: async (username: string) => {
      const data = await reveal.mutateAsync(username);
      return data.password;
    },
  };
}

// ── Endpoints ───────────────────────────────────────────────────────────────

const ENDPOINTS_SHOWN = 6;

function MethodWord({ method }: { method: Operation["method"] }) {
  const tone = methodTone(method);
  return (
    <Typography
      component="span"
      variant="caption"
      sx={{
        fontFamily: "monospace",
        fontWeight: 700,
        width: 56,
        flexShrink: 0,
        color: tone === "neutral" ? "text.secondary" : `${tone}.main`,
      }}
    >
      {method}
    </Typography>
  );
}

/**
 * A service's endpoints off its contract: searchable, filterable by method,
 * a curl per row for the deployed URL, and Try into the contract viewer. The
 * chosen curl expands under the list so the whole command is readable and
 * copyable at once.
 */
function ServiceEndpoints({
  projectName,
  componentName,
  displayName,
  baseUrl,
  onTryApi,
  onCount,
}: {
  projectName: string;
  componentName: string;
  displayName: string;
  baseUrl: string | undefined;
  onTryApi: () => void;
  /** The contract's endpoint count, once known, for the panel header. */
  onCount?: (n: number) => void;
}) {
  const contract = useComponentOpenApi(projectName, componentName, true);
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState<Operation["method"] | "ALL">("ALL");
  const [all, setAll] = useState(false);
  const [chosen, setChosen] = useState<Operation | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const ops = useMemo(() => {
    const spec = contract.data?.spec;
    if (!spec) return null;
    const parsed = parseOpenApi(spec);
    if ("kind" in parsed) return "unparsable" as const;
    return flattenEndpoints(parsed);
  }, [contract.data?.spec]);

  if (contract.isPending) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 1.5, display: "block" }}>
        Loading endpoints…
      </Typography>
    );
  }
  if (contract.isError || ops === null) {
    return (
      <Box sx={{ px: 2, py: 1.5 }}>
        <Alert
          severity="warning"
          action={<Button size="small" onClick={() => void contract.refetch()}>Retry</Button>}
        >
          The contract could not be loaded
          {contract.error instanceof Error && contract.error.message ? `: ${contract.error.message}` : ""}
        </Alert>
      </Box>
    );
  }
  if (ops === "unparsable") {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
        The contract could not be parsed — open it with Try API to read it as written.
      </Typography>
    );
  }
  if (onCount && ops.length > 0) onCount(ops.length);

  const visible = filterEndpoints(ops, query, method);
  const shown = all ? visible : visible.slice(0, ENDPOINTS_SHOWN);
  const methods = methodsIn(ops);
  const copyCurl = (op: Operation) => {
    if (!baseUrl) return;
    setChosen(op);
    void copyText(curlFor(baseUrl, op))
      .then(() => setNote("Copied"))
      .catch((e: unknown) => setNote(e instanceof Error ? e.message : String(e)));
  };

  return (
    <Box sx={{ borderTop: 1, borderColor: "divider" }}>
      <Stack
        direction="row"
        spacing={1.25}
        sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1, px: 2, py: 1.25 }}
      >
        <TextField
          size="small"
          placeholder="Search endpoints"
          inputProps={{ "aria-label": `Search ${displayName} endpoints` }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          InputProps={{ startAdornment: <Box component={Search} size={14} aria-hidden sx={{ mr: 1, color: "text.secondary" }} /> }}
          sx={{ flexGrow: 1, minWidth: 200 }}
        />
        <Stack direction="row" spacing={0.5} role="group" aria-label="Filter by method">
          {(["ALL", ...methods] as const).map((m) => (
            <Chip
              key={m}
              size="small"
              label={m === "ALL" ? "All" : m}
              clickable
              variant={method === m ? "filled" : "outlined"}
              color={method === m ? "primary" : "default"}
              onClick={() => setMethod(m)}
              aria-pressed={method === m}
              sx={{ fontFamily: m === "ALL" ? undefined : "monospace" }}
            />
          ))}
        </Stack>
      </Stack>
      <Box role="list" aria-label={`${displayName} endpoints`}>
        {shown.map((op) => (
          <Stack
            key={op.id}
            role="listitem"
            direction="row"
            spacing={1.25}
            sx={{ alignItems: "center", px: 2, py: 0.75, borderTop: 1, borderColor: "divider" }}
          >
            <MethodWord method={op.method} />
            <Typography
              variant="body2"
              sx={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              <Box component="span" sx={{ fontFamily: "monospace" }}>
                {op.path}
              </Box>
              {/* The contract's one-line summary — the parser names the
                  operation by it and falls back to the path, which would only
                  repeat the row. */}
              {op.name && op.name !== op.path && (
                <Typography component="span" variant="caption" color="text.secondary">
                  {" "}
                  {op.name}
                </Typography>
              )}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              disabled={!baseUrl}
              startIcon={<Copy size={13} aria-hidden />}
              aria-label={`Copy a curl for ${op.method} ${op.path}`}
              onClick={() => copyCurl(op)}
              sx={{ flexShrink: 0, textTransform: "none", fontFamily: "monospace" }}
            >
              curl
            </Button>
            <AccentPill aria-label={`Try ${op.method} ${op.path}`} onClick={onTryApi}>
              Try
            </AccentPill>
          </Stack>
        ))}
        {visible.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: "divider" }}>
            No endpoint matches.
          </Typography>
        )}
      </Box>
      {chosen && baseUrl && (
        <Box
          sx={{
            mx: 2,
            my: 1.5,
            p: 1.5,
            borderRadius: 1.5,
            bgcolor: "grey.900",
            color: "grey.100",
            fontFamily: "monospace",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 0.75 }}>
            <Typography variant="caption" sx={{ color: "grey.400" }}>
              {chosen.method} {chosen.path}
              {note ? ` · ${note}` : ""}
            </Typography>
            <Button
              size="small"
              color="inherit"
              startIcon={<Copy size={13} aria-hidden />}
              aria-label={`Copy the curl for ${chosen.method} ${chosen.path}`}
              onClick={() => copyCurl(chosen)}
              sx={{ color: "grey.100" }}
            >
              Copy
            </Button>
          </Stack>
          <Box component="pre" sx={{ m: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", fontFamily: "inherit" }}>
            {curlFor(baseUrl, chosen)}
          </Box>
        </Box>
      )}
      {visible.length > ENDPOINTS_SHOWN && (
        <Stack
          direction="row"
          sx={{ alignItems: "center", justifyContent: "space-between", px: 2, py: 1, borderTop: 1, borderColor: "divider" }}
        >
          <Typography variant="caption" color="text.secondary">
            Showing {shown.length} of {visible.length} endpoints
          </Typography>
          <Button size="small" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : "Show all"}
          </Button>
        </Stack>
      )}
    </Box>
  );
}

// ── The panels ──────────────────────────────────────────────────────────────

export interface TestUsersProps {
  logins: readonly PublishedTestUser[];
  loadState: "ready" | "pending" | "error";
  thunderUrl: string;
  revealPassword: (username: string) => Promise<string>;
}

/**
 * One component's panel: identity, its release, its state, its way in, its
 * URL — and what a person does with it next: the accounts for a web app,
 * the endpoints for a service.
 */
function ComponentPanel({
  projectName,
  card,
  type,
  talksTo,
  testUsers,
  onTryApi,
}: {
  projectName: string;
  card: DeploymentCard;
  type: string | undefined;
  talksTo: string[];
  testUsers: TestUsersProps | null;
  onTryApi: () => void;
}) {
  const [endpointCount, setEndpointCount] = useState<number | null>(null);
  const chip = cardChip(card);
  const d = card.deployment;
  const isWebApp = type === "web-application";
  const isService = type === "service";
  const serving = card.kind === "success";
  const kind = kindLabel(type);
  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        overflow: "hidden",
        ...(card.kind === "notDeployed" && { opacity: 0.6, borderStyle: "dashed" }),
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", px: 2, py: 1.5, flexWrap: "wrap", rowGap: 1 }}>
        <Avatar sx={{ width: 28, height: 28, bgcolor: "action.hover", color: "text.primary", fontSize: 13 }}>
          {(card.displayName.trim()[0] ?? "C").toUpperCase()}
        </Avatar>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flexShrink: 0 }}>
          {card.displayName}
        </Typography>
        {d?.releaseName && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}
          >
            {d.releaseName}
          </Typography>
        )}
        {kind && (
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
            · {kind}
            {isService && endpointCount !== null ? ` · ${endpointCount} endpoint${endpointCount === 1 ? "" : "s"}` : ""}
          </Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <StatusChip label={chip.label} tone={chip.tone} {...(chip.outlined && { variant: "outlined" as const })} />
        {isWebApp && d?.endpointUrl && (
          <Button
            variant="contained"
            size="small"
            href={d.endpointUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Visit ${card.displayName}`}
            endIcon={<ExternalLink size={13} aria-hidden />}
          >
            Visit app
          </Button>
        )}
        {/* Only a SERVING service is worth trying — an undeployed or failed
            one has a contract but nothing behind it. */}
        {isService && serving && (
          <AccentPill
            onClick={onTryApi}
            aria-label={`Try ${card.displayName} API`}
            startIcon={<FlaskConical size={13} aria-hidden />}
          >
            Try API
          </AccentPill>
        )}
      </Stack>
      {d?.endpointUrl && <UrlRow url={d.endpointUrl} name={card.displayName} />}
      {isWebApp && talksTo.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 2, pb: 1.25 }}>
          Talks to{" "}
          <Box component="span" sx={{ fontWeight: 600 }}>
            {talksTo.join(", ")}
          </Box>{" "}
          on this environment
        </Typography>
      )}
      {isWebApp && testUsers && <TestUsersInline {...testUsers} />}
      {isService && serving && (
        <ServiceEndpoints
          projectName={projectName}
          componentName={card.componentName}
          displayName={card.displayName}
          baseUrl={d?.endpointUrl}
          onTryApi={onTryApi}
          onCount={setEndpointCount}
        />
      )}
    </Box>
  );
}

/**
 * The "Try it out" card: every component of the environment as a panel. The
 * test users sit inside the first web application's panel — they exist to
 * sign in to it — and under their own heading when there is none.
 */
export function TryItOutCard({
  projectName,
  cards,
  types,
  talksTo,
  live,
  total,
  testUsers,
  onTryApi,
}: {
  projectName: string;
  cards: DeploymentCard[];
  types: Map<string, string>;
  talksTo: (componentName: string) => string[];
  live: number;
  total: number;
  /** The accounts, when this environment has them (a green development). */
  testUsers: TestUsersProps | null;
  onTryApi: (componentName: string) => void;
}) {
  const firstWebApp = cards.find((c) => types.get(c.componentName) === "web-application");
  return (
    <Card variant="outlined">
      <Stack
        direction="row"
        spacing={1.25}
        sx={{ alignItems: "baseline", px: 2.25, py: 1.5, borderBottom: 1, borderColor: "divider" }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Try it out
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {live} of {total} components live
          {testUsers && firstWebApp ? " · sign in with a test user below" : ""}
        </Typography>
      </Stack>
      <Stack spacing={1.5} sx={{ p: 2 }}>
        {cards.map((card) => (
          <ComponentPanel
            key={card.componentName}
            projectName={projectName}
            card={card}
            type={types.get(card.componentName)}
            talksTo={talksTo(card.componentName)}
            testUsers={testUsers && card === firstWebApp ? testUsers : null}
            onTryApi={() => onTryApi(card.componentName)}
          />
        ))}
        {testUsers && !firstWebApp && (
          <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, overflow: "hidden" }}>
            <TestUsersInline {...testUsers} />
          </Box>
        )}
      </Stack>
    </Card>
  );
}
