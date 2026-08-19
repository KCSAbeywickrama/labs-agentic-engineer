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

import { useMemo } from "react";
import { Alert, Box, Chip, Typography } from "@wso2/oxygen-ui";

import {
  isParseError,
  parseAgentAfm,
  type AgentSpec,
  type AgentToolGroup,
} from "./parse.js";

/**
 * Read-time resolution status for ONE `x-aep.tools.openapi[].allow` entry,
 * keyed `"<component>:<operation>"` in AgentViewProps.toolStatus. This is the
 * ONLY source of `status`/`reason`: they are computed server-side by
 * spec.ComputeAgentToolStatus on every design read and never authored into
 * agent.afm.md, so parse.ts deliberately does not derive them (see its
 * file-header comment). Kept as raw strings rather than a closed union so an
 * unrecognized value still renders instead of pinning this package to the
 * server's exact enum.
 */
export interface AgentToolStatusInfo {
  /** "resolved" | "unresolved" | "unchecked". */
  status: string;
  /** Empty on resolved; human-readable otherwise. */
  reason?: string | undefined;
}

export interface AgentViewProps {
  /** Raw `agent.afm.md` text. */
  spec: string;
  /**
   * OPTIONAL per-operation resolution status, keyed `"<component>:<operation>"`,
   * from the design read model's `Dependency.operations`. Optional and keyed
   * defensively — a missing entry simply renders without a chip — so a caller
   * that does not fetch dependencies is unaffected, mirroring DesignView's
   * `dependencyStatus`.
   */
  toolStatus?: Record<string, AgentToolStatusInfo> | undefined;
}

// Visual vocabulary mirrors @aep/ui-design-view's DesignView so the two
// component-level artifacts (Design Overview, Agent Spec) read as one family
// in the spec workspace: an uppercase type badge as the eyebrow, a bold h4
// name, labeled facts, and overline section headings.

const AGENT_BADGE_COLOR = "#7c3aed";
const mono = { fontFamily: "monospace", fontSize: "0.875rem" } as const;

function SolidBadge({ label, color }: { label: string; color: string }) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        px: 1,
        py: 0.5,
        borderRadius: 1,
        flexShrink: 0,
        fontFamily: "monospace",
        fontSize: "0.6875rem",
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        bgcolor: color,
        color: theme.palette.getContrastText(color),
      })}
    >
      {label}
    </Box>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: "flex", gap: 2, alignItems: "baseline" }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 96, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography component="span" sx={mono}>
        {value}
      </Typography>
    </Box>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="overline"
      color="text.secondary"
      sx={{ display: "block", mt: 3, mb: 1, fontWeight: 700, letterSpacing: "0.08em" }}
    >
      {children}
    </Typography>
  );
}

/**
 * The AFM keeps `${env:NAME}` placeholders for anything the platform injects
 * at deploy — the model name and endpoint among them. The reader wants to know
 * WHERE it comes from, not see the placeholder syntax; a literal value (a
 * design that pinned one) still shows verbatim.
 */
function modelFact(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^\$\{env:[^}]+\}$/.test(value) ? "set by the platform at deploy" : value;
}

/** Plain-language gloss for the interface types AFM defines. */
function interfaceGloss(type: string): string | undefined {
  switch (type) {
    case "webchat":
      return "An HTTP endpoint a web app calls, one request per turn — the caller keeps the conversation and sends it back each time.";
    case "webhook":
      return "Invoked by an external system's callback rather than a user.";
    case "platformchat":
      return "Reached through a chat platform's own integration.";
    default:
      return undefined;
  }
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusColor(status: string): "success" | "error" | "warning" | "default" {
  if (status === "resolved") return "success";
  if (status === "unresolved") return "error";
  if (status === "unchecked") return "warning";
  return "default";
}

function ToolGroup({
  group,
  toolStatus,
}: {
  group: AgentToolGroup;
  toolStatus?: Record<string, AgentToolStatusInfo> | undefined;
}) {
  return (
    <Box
      sx={{
        mb: 1.5,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 2,
        bgcolor: "background.paper",
      }}
    >
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
        {group.component}
      </Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
        {group.operations.map((operation) => {
          const info = toolStatus?.[`${group.component}:${operation}`];
          return (
            <Box key={operation}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography component="span" sx={mono}>
                  {operation}
                </Typography>
                {info ? (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={statusLabel(info.status)}
                    color={statusColor(info.status)}
                  />
                ) : null}
              </Box>
              {info?.reason ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", ml: 0.25 }}>
                  {info.reason}
                </Typography>
              ) : null}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function AgentSpecBody({
  spec,
  toolStatus,
}: {
  spec: AgentSpec;
  toolStatus?: Record<string, AgentToolStatusInfo> | undefined;
}) {
  const modelName = modelFact(spec.model?.name);
  const modelEndpoint = modelFact(spec.model?.url);

  return (
    <Box sx={{ p: 3, overflow: "auto", height: "100%" }}>
      <Box sx={{ maxWidth: 960, mx: "auto" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <SolidBadge label="ai-agent" color={AGENT_BADGE_COLOR} />
        </Box>
        <Typography variant="h4" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
          {spec.name || "agent"}
        </Typography>

        {spec.description ? (
          <>
            <SectionHeading>Description</SectionHeading>
            <Typography variant="body1" color="text.secondary">
              {spec.description}
            </Typography>
          </>
        ) : null}

        {spec.model ? (
          <>
            <SectionHeading>Model</SectionHeading>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              {spec.model.provider ? <Fact label="Provider" value={spec.model.provider} /> : null}
              {modelName ? <Fact label="Model" value={modelName} /> : null}
              {modelEndpoint ? <Fact label="Endpoint" value={modelEndpoint} /> : null}
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              The agent gets model access from its component type, on the organisation&apos;s own
              key — nothing to configure here.
            </Typography>
          </>
        ) : null}

        {spec.interfaces.length > 0 ? (
          <>
            <SectionHeading>Interfaces</SectionHeading>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {spec.interfaces.map((iface) => {
                const gloss = interfaceGloss(iface.type);
                return (
                  <Box key={`${iface.type}:${iface.path ?? ""}`}>
                    <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5 }}>
                      <Typography component="span" sx={{ fontWeight: 700 }}>
                        {iface.type}
                      </Typography>
                      {iface.path ? (
                        <Typography component="span" sx={mono}>
                          POST {iface.path}
                        </Typography>
                      ) : null}
                    </Box>
                    {gloss ? (
                      <Typography variant="body2" color="text.secondary">
                        {gloss}
                      </Typography>
                    ) : null}
                  </Box>
                );
              })}
            </Box>
          </>
        ) : null}

        <SectionHeading>Tools</SectionHeading>
        {spec.tools.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No tools — this agent answers from its instructions alone.
          </Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              The operations this agent may call. The allow-list is the security boundary: an
              operation left out is never generated as a tool, so no phrasing can reach it.
            </Typography>
            {spec.tools.map((group) => (
              <ToolGroup key={group.component} group={group} toolStatus={toolStatus} />
            ))}
          </>
        )}

        {spec.prompt.length > 0 ? (
          <>
            <SectionHeading>Behaviour</SectionHeading>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
              {spec.prompt.map((section, index) => (
                <Box key={`${section.heading}-${index}`}>
                  {section.heading ? (
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
                      {section.heading}
                    </Typography>
                  ) : null}
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                    {section.body}
                  </Typography>
                </Box>
              ))}
            </Box>
          </>
        ) : null}
      </Box>
    </Box>
  );
}

export function AgentView({ spec, toolStatus }: AgentViewProps) {
  const attempt = useMemo(() => parseAgentAfm(spec), [spec]);

  if (isParseError(attempt)) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">{attempt.error}</Alert>
      </Box>
    );
  }

  return <AgentSpecBody spec={attempt} toolStatus={toolStatus} />;
}
