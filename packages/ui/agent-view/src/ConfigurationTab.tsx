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

import type { ReactNode } from "react";
import { Stack, Typography } from "@wso2/oxygen-ui";

import type { AgentModelConnection } from "./AgentView.js";
import type { AgentSpec } from "./parse.js";
import { mono, Panel, Row } from "./parts.js";

/** Plain-language gloss for the interface types AFM defines. */
function interfaceNote(type: string): string | undefined {
  switch (type) {
    case "webchat":
      return "An HTTP endpoint a web app calls, one request per turn.";
    case "webhook":
      return "Invoked by an external system's callback rather than a user.";
    case "platformchat":
      return "Reached through a chat platform's own integration.";
    default:
      return undefined;
  }
}

/** Memory, said as who remembers the conversation rather than as `client` / `server`. */
function memoryRow(memory: string): { value: string; note?: string } {
  if (memory === "server") {
    return { value: "The agent remembers the conversation", note: "Saved in its own database." };
  }
  if (memory === "client") {
    return { value: "The web app remembers the conversation", note: "Sent back with every message." };
  }
  return { value: memory };
}

/**
 * The model the agent runs on is the organisation's connection from Settings,
 * not the AFM's `model:` block: that block holds only `${env:}` placeholders
 * the deploy fills in from the same connection, so showing it would say
 * nothing. The key never appears; it reaches the agent through the gateway.
 */
function ModelPanel({
  connection,
  settingsLink,
}: {
  connection: AgentModelConnection | null | "loading";
  settingsLink: ReactNode;
}) {
  return (
    <Panel title="Model">
      {connection === "loading" ? (
        <Typography variant="body2" color="text.secondary">
          Loading the organisation&apos;s model connection…
        </Typography>
      ) : connection === null ? (
        <Typography variant="body2" color="text.secondary">
          No model connected. {settingsLink}
        </Typography>
      ) : (
        <>
          <Row label="Model" value={<span style={mono}>{connection.model}</span>} />
          <Row label="Format" value={connection.format} />
          <Row label="Host" value={<span style={mono}>{connection.host}</span>} />
          <Row label="Access" value="Through the environment's AI gateway (Agent Manager)" />
          {settingsLink ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
              The organisation&apos;s model connection. {settingsLink}
            </Typography>
          ) : null}
        </>
      )}
    </Panel>
  );
}

export function ConfigurationTab({
  spec,
  modelConnection,
  settingsLink,
}: {
  spec: AgentSpec;
  modelConnection: AgentModelConnection | null | "loading" | undefined;
  settingsLink: ReactNode;
}) {
  const memory = spec.memory ? memoryRow(spec.memory) : null;
  return (
    <Stack spacing={2}>
      {modelConnection !== undefined ? (
        <ModelPanel connection={modelConnection} settingsLink={settingsLink} />
      ) : null}
      {spec.interfaces.length > 0 ? (
        <Panel title="Exposure">
          {spec.interfaces.map((iface) => (
            <Row
              key={`${iface.type}:${iface.path ?? ""}`}
              label={iface.type}
              value={<span style={mono}>{iface.path ? `POST ${iface.path}` : "—"}</span>}
              note={interfaceNote(iface.type)}
            />
          ))}
        </Panel>
      ) : null}
      {memory ? (
        <Panel title="Memory">
          <Row label="Conversation" value={memory.value} note={memory.note} />
        </Panel>
      ) : null}
    </Stack>
  );
}
