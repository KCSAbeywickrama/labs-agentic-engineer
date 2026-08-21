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

import { useCallback, type ReactNode } from "react";
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@wso2/oxygen-ui";
import {
  ChevronRight,
  FileText,
  ListChecks,
  Rocket,
  Sparkles,
} from "@wso2/oxygen-ui-icons-react";
import { useNavigate } from "@tanstack/react-router";
import type { components } from "../../../generated/aep-api";
import { useSession } from "../../../auth/SessionContext";
import { useAgentEngaged } from "../../agent-chat/useAgentEngaged";
import { chatKeyFor, setPendingSeed } from "../../agent-chat/chatStore";
import { START_COMMAND } from "@aep/contracts/commands";
import {
  buildStageView,
  CHIP_COLOR,
  deployStageView,
  specStageView,
  type StageView,
} from "../lib/pipeline";

type ProjectStatus = components["schemas"]["ProjectStatus"];

function StageCard({
  icon,
  title,
  view,
  to,
  projectName,
}: {
  icon: ReactNode;
  title: string;
  view: StageView;
  to: string;
  projectName: string;
}) {
  const navigate = useNavigate();
  const ghost = view.tone === "ghost";
  return (
    <Card
      variant="outlined"
      sx={{
        flex: 1,
        minWidth: 0,
        ...(ghost && { opacity: 0.6 }),
        ...(view.tone === "error" && { borderColor: "error.main" }),
      }}
    >
      <CardActionArea
        sx={{ height: "100%", alignItems: "stretch" }}
        onClick={() =>
          void navigate({
            to: `/projects/$projectName/${to}`,
            params: { projectName },
          })
        }
      >
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5 }}>
            {icon}
            <Typography variant="subtitle2" color="text.secondary">
              {title}
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Chip
              size="small"
              label={view.version || "—"}
              color={CHIP_COLOR[view.tone]}
              variant={view.version ? "filled" : "outlined"}
            />
          </Stack>
          <Typography
            variant="body2"
            color={
              view.tone === "error"
                ? "error.main"
                : ghost
                  ? "text.disabled"
                  : "text.secondary"
            }
          >
            {view.line}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

// What the spec stage's button says and does, most authoritative signal first.
//
// The SERVER's `agent` (#562) outranks the local `engaged` read because they
// know different things: `engaged` is derived from the chat log, which only
// exists once the panel has mounted, so a user who lands on the overview and
// never opens the chat sees a turn the console has no local record of. That
// gap is the whole reason `spec.agent` was added to the contract.
//
// A send is offered ONLY when nothing is running and nothing is waiting on the
// user. Injecting `/start` into an open exchange is the bug `agentEngaged`
// documents: landing on an unanswered question form it reads to the start skill
// as the user's skip valve, so the interview is silently replaced by the
// agent's own answers.
function specActionFor(
  view: StageView,
  engaged: boolean,
): { label: string; send: boolean } {
  if (view.action === "open") return { label: "Open spec", send: false };
  if (engaged) return { label: "Continue spec", send: false };
  if (view.action === "retry") return { label: "Try again", send: true };
  return { label: "Generate spec", send: true };
}

// The spec stage as a call-to-action: a resumption affordance (#522). Status
// while the stage is live, a CTA when the flow stopped there — the agent
// advances the journey, and this is how a user picks it back up.
//
// The kickoff fires at project creation now, so the common reading of this card
// is "generation is already underway" and the button only has to be the way IN:
// *Open spec*, not *Generate spec*. It navigates and nothing more.
//
// A CTA that does send fires `/start` through the chat's seed slot rather than
// a `?generate=` query param (which is retired, #562). The panel opens itself
// on the seed and the user stays where they are, watching this card turn over
// to *Writing requirements* — the chat is the spine, and nothing navigates the
// user without a click of their own.
function SpecActionStage({
  projectName,
  view,
  engaged,
  onStart,
}: {
  projectName: string;
  view: StageView;
  engaged: boolean;
  onStart: () => void;
}) {
  const navigate = useNavigate();
  const action = specActionFor(view, engaged);
  return (
    <Card
      variant="outlined"
      sx={{ flex: 1, minWidth: 0, borderColor: "primary.main", borderWidth: 2 }}
    >
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5 }}>
          <FileText size={18} />
          <Typography variant="subtitle2" color="text.secondary">
            Spec
          </Typography>
          {/* An amendment runs against a spec that already has a version —
              keep its chip, so continuing doesn't look like starting over. */}
          {view.version && (
            <>
              <Box sx={{ flexGrow: 1 }} />
              <Chip
                size="small"
                label={view.version}
                color={CHIP_COLOR[view.tone]}
                variant="filled"
              />
            </>
          )}
        </Stack>
        {/* The state line the plain stage card would have shown. An amendment
            replaces that card, and the spec's status ("published", "draft
            changes") is true throughout — losing it would make an open
            exchange look like a project with no spec at all. Empty on the
            cold-start CTA, where there is no spec to have a status. */}
        {view.line && (
          <Typography
            variant="body2"
            color={view.tone === "error" ? "error.main" : "text.secondary"}
            sx={{ mb: 1.5 }}
          >
            {view.line}
          </Typography>
        )}
        {/* The sparkle means "this asks an agent for something". A button that
            only navigates is not that, and reusing the icon there would make the
            one promise this card has to keep — that Open spec does nothing but
            open the spec — read like another generation. */}
        <Button
          variant="contained"
          size="small"
          startIcon={action.send ? <Sparkles size={16} /> : <ChevronRight size={16} />}
          onClick={() => {
            if (action.send) {
              onStart();
              return;
            }
            void navigate({
              to: "/projects/$projectName/spec",
              params: { projectName },
            });
          }}
        >
          {action.label}
        </Button>
      </CardContent>
    </Card>
  );
}

// The overview's centerpiece (#183): one connected journey, spec → build →
// deploy, each stage stamped with its version and linking to its section.
export function OverviewPipeline({
  projectName,
  status,
}: {
  projectName: string;
  status: ProjectStatus;
}) {
  const spec = specStageView(status);
  const build = buildStageView(status);
  const deploy = deployStageView(status);
  // An open exchange turns the spec stage back into an action, whether or not a
  // spec exists: `/start` on an existing PRD is an amendment interview, which
  // asks questions the same way and is skipped by a stray start the same way —
  // and the overview otherwise gives no sign one is open.
  const org = useSession().orgHandle ?? "default";
  const engaged = useAgentEngaged(org, projectName);
  // Firing `/start` is a SEND, so it goes where every other send goes: the
  // chat's one-shot seed slot. AppLayout opens the panel the moment a seed
  // appears and the panel consumes it exactly once — the same path "Resolve
  // via chat" takes, and the reason this card needs no query param and no
  // navigation of its own.
  const startSpec = useCallback(() => {
    // GUARDED: this is an injected command, not the user's words. This card
    // decides from the local chat log, which is empty until the panel mounts —
    // so a teammate in a fresh browser can reach this button while the server
    // thread holds an unanswered question. The panel re-decides after it has
    // rehydrated, which is the first moment the answer is knowable.
    setPendingSeed(chatKeyFor(org, projectName), START_COMMAND, true);
  }, [org, projectName]);

  return (
    <Stack
      direction={{ xs: "column", md: "row" }}
      spacing={1}
      sx={{ alignItems: { xs: "stretch", md: "center" } }}
    >
      {spec.action || engaged ? (
        <SpecActionStage
          projectName={projectName}
          view={spec}
          engaged={engaged}
          onStart={startSpec}
        />
      ) : (
        <StageCard
          icon={<FileText size={18} />}
          title="Spec"
          view={spec}
          to="spec"
          projectName={projectName}
        />
      )}
      <ChevronRight
        size={20}
        style={{ flexShrink: 0, alignSelf: "center", opacity: 0.4 }}
      />
      <StageCard
        icon={<ListChecks size={18} />}
        title="Build"
        view={build}
        to="builds"
        projectName={projectName}
      />
      <ChevronRight
        size={20}
        style={{ flexShrink: 0, alignSelf: "center", opacity: 0.4 }}
      />
      <StageCard
        icon={<Rocket size={18} />}
        title="Deploy"
        view={deploy}
        to="deployments"
        projectName={projectName}
      />
    </Stack>
  );
}
