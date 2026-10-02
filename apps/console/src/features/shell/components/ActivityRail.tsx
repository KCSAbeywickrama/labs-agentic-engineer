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
import { createLink } from "@tanstack/react-router";
import { Box, IconButton, Tooltip, type SxProps, type Theme } from "@wso2/oxygen-ui";
import {
  FileText,
  Layers,
  LayoutGrid,
  MessageSquare,
  Plus,
} from "@wso2/oxygen-ui-icons-react";
import type { ShellScope } from "../scope";
import { RAIL_WIDTH } from "../layout";
import { RailUserMenu } from "./RailUserMenu";

// MUI's polymorphic `component={Link}` does not typecheck against the router's
// typed `to`/`params`; createLink is the adapter (as in the old console).
const RailLink = createLink(IconButton);

function railButtonSx(active: boolean): SxProps<Theme> {
  return {
    width: 40,
    height: 40,
    borderRadius: 2,
    position: "relative",
    color: active ? "var(--aep-shell-rail-active)" : "var(--aep-shell-rail-text)",
    "&:hover": {
      bgcolor: "var(--aep-shell-rail-hover)",
      color: "var(--aep-shell-rail-active)",
    },
    // The active item's marker: a short bar on the rail's leading edge.
    ...(active && {
      "&::before": {
        content: '""',
        position: "absolute",
        left: -6,
        top: 8,
        bottom: 8,
        width: 2,
        borderRadius: 1,
        bgcolor: "var(--aep-shell-rail-active)",
      },
    }),
  };
}

function RailTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip title={label} placement="right">
      {/* Tooltip needs a child that holds a ref; the span keeps it off the
          router's link component. */}
      <Box component="span" sx={{ display: "inline-flex" }}>
        {children}
      </Box>
    </Tooltip>
  );
}

/**
 * The dark activity rail: brand, New project, Projects; inside a project also
 * Spec and Design; then the chat toggle and the user menu at the bottom.
 */
export function ActivityRail({
  scope,
  chatOpen,
  onToggleChat,
}: {
  scope: ShellScope;
  /** Null where there is no chat to toggle (org level). */
  chatOpen: boolean | null;
  onToggleChat: () => void;
}) {
  const project = scope.kind === "project" ? scope : null;
  const onPage = (page: "projects" | "new") => scope.kind === "org" && scope.page === page;

  return (
    <Box
      component="nav"
      aria-label="Activity rail"
      sx={{
        width: RAIL_WIDTH,
        flexShrink: 0,
        height: "100%",
        bgcolor: "var(--aep-shell-rail)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        py: 1.25,
        gap: 0.5,
        // Above the phone-width chat overlay, which opens beside it.
        zIndex: (t) => t.zIndex.appBar,
      }}
    >
      <Box
        aria-label="Agentic Engineer"
        role="img"
        sx={{
          width: 32,
          height: 32,
          mb: 1,
          borderRadius: 2,
          bgcolor: "primary.main",
          color: "primary.contrastText",
          display: "grid",
          placeItems: "center",
          fontFamily: "monospace",
          fontWeight: 600,
        }}
      >
        ae
      </Box>
      <RailTip label="New project">
        <RailLink to="/projects/new" aria-label="New project" sx={railButtonSx(onPage("new"))}>
          <Plus size={20} />
        </RailLink>
      </RailTip>
      <RailTip label="Projects">
        <RailLink to="/" aria-label="Projects" sx={railButtonSx(onPage("projects"))}>
          <LayoutGrid size={20} />
        </RailLink>
      </RailTip>
      {project && (
        <>
          <RailTip label="Spec">
            <RailLink
              to="/projects/$projectName/spec"
              params={{ projectName: project.projectName }}
              aria-label="Spec"
              sx={railButtonSx(project.card === "spec")}
            >
              <FileText size={20} />
            </RailLink>
          </RailTip>
          <RailTip label="Design">
            <RailLink
              to="/projects/$projectName/design"
              params={{ projectName: project.projectName }}
              aria-label="Design"
              sx={railButtonSx(project.card === "design")}
            >
              <Layers size={20} />
            </RailLink>
          </RailTip>
        </>
      )}
      <Box sx={{ flex: 1 }} />
      {chatOpen !== null && (
        <RailTip label={chatOpen ? "Hide agent chat" : "Show agent chat"}>
          <IconButton
            aria-label="Agent chat"
            aria-pressed={chatOpen}
            onClick={onToggleChat}
            sx={railButtonSx(chatOpen)}
          >
            <MessageSquare size={20} />
          </IconButton>
        </RailTip>
      )}
      <RailUserMenu />
    </Box>
  );
}
