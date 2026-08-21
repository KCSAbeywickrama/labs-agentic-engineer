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
  Box,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography,
} from "@wso2/oxygen-ui";
import { Link } from "@tanstack/react-router";
import { EmptyState } from "../../../components/EmptyState";
import { PageHeader } from "../../../components/PageHeader";
import {
  useComponentsDeployments,
  useProjectComponents,
} from "../../projects/api/queries";
import { AgentChatTester, type DeployKnowledge } from "./AgentChatTester";

// First cut (spec D5): the only component type with a tester is the ai-agent.
// The API tester lands on the same route and the same proxy later, so the
// picker is written as "components with a tester", not "agents".
const TESTABLE_TYPE = "ai-agent";

const DEPLOY_LABEL: Record<DeployKnowledge, string> = {
  unknown: "Checking deployment…",
  ready: "Deployed",
  unreachable: "Not reachable yet",
};

export function TestPage({ projectName }: { projectName: string }) {
  const components = useProjectComponents(projectName);
  const agents = useMemo(
    () => (components.data?.items ?? []).filter((c) => c.type === TESTABLE_TYPE),
    [components.data],
  );
  // The Deployments board's poller, reused: an agent is reachable only once a
  // deployment of it is Ready, and that is the same read the board renders.
  const { deployments, isPending: deploymentsPending } = useComponentsDeployments(
    projectName,
    agents.map((a) => a.name),
  );
  const readyNames = useMemo(
    () =>
      new Set(
        deployments
          .filter((d) => d.status === "Ready" && d.componentName)
          .map((d) => d.componentName as string),
      ),
    [deployments],
  );
  // While the read is in flight NOTHING is known: an empty `readyNames` is the
  // absence of an answer, not the answer "no". Collapsing the two would call
  // every deployed agent unreachable on first paint and disable its input,
  // then flip once the poll returned.
  const deployKnowledge = (componentName: string): DeployKnowledge =>
    deploymentsPending
      ? "unknown"
      : readyNames.has(componentName)
        ? "ready"
        : "unreachable";

  const [selected, setSelected] = useState<string | null>(null);
  const active = selected && agents.some((a) => a.name === selected)
    ? selected
    : (agents[0]?.name ?? null);

  const header = (
    <PageHeader
      title="Test"
      backTo={{
        link: <Link to="/projects/$projectName" params={{ projectName }} />,
        label: "Back to Overview",
      }}
    />
  );

  if (components.isPending) {
    return (
      <>
        {header}
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
          <CircularProgress aria-label="Loading components" />
        </Box>
      </>
    );
  }

  if (components.isError) {
    return (
      <>
        {header}
        <Alert severity="error">Failed to load this project&apos;s components</Alert>
      </>
    );
  }

  return (
    <>
      {header}
      {/* The picker earns its width only when there is a choice to make. With a
          single agent it was a lone card in a 280px column of whitespace, and
          the agent's identity is already in the chat header — so the chat gets
          the full width instead. */}
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="stretch">
        {agents.length !== 1 && (
        <Box sx={{ width: { xs: "100%", md: 280 }, flexShrink: 0 }}>
          {agents.length === 0 ? (
            <EmptyState compact bordered description="No agents in this project." />
          ) : (
            <Stack spacing={1}>
              {agents.map((agent) => (
                <Card
                  key={agent.name}
                  component="button"
                  type="button"
                  onClick={() => setSelected(agent.name)}
                  sx={{
                    width: "100%",
                    textAlign: "left",
                    cursor: "pointer",
                    border: 1,
                    borderColor: agent.name === active ? "primary.main" : "divider",
                  }}
                >
                  <CardContent>
                    <Typography variant="body2">
                      {agent.displayName || agent.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {DEPLOY_LABEL[deployKnowledge(agent.name)]}
                    </Typography>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}
        </Box>
        )}
        {/* A bordered surface with a fixed height: the transcript scrolls
            INSIDE it, so the composer stays put instead of being pushed down
            the page as the conversation grows. */}
        <Box
          sx={{
            flexGrow: 1,
            minWidth: 0,
            height: { xs: "auto", md: "calc(100vh - 220px)" },
            minHeight: 420,
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            bgcolor: "background.paper",
            overflow: "hidden",
          }}
        >
          {active && (
            <AgentChatTester
              projectName={projectName}
              componentName={active}
              deployKnowledge={deployKnowledge(active)}
            />
          )}
        </Box>
      </Stack>
    </>
  );
}
