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

import { useCallback, useEffect, useState } from "react";
import {
  AppShell,
  Box,
  Collapse,
  ColorSchemeToggle,
  Divider,
  Footer,
  Header,
  IconButton,
  Sidebar,
  Tooltip,
  UserMenu,
  version as OXYGEN_UI_VERSION,
} from "@wso2/oxygen-ui";
import {
  FolderOpen,
  LogOut,
  Settings,
  Sparkles,
  User as UserIcon,
  WSO2,
} from "@wso2/oxygen-ui-icons-react";
import {
  Link,
  Outlet,
  useNavigate,
  useParams,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
import { useSession } from "../auth/SessionContext";
import { OrgSwitcher, ProjectSwitcher } from "./HeaderSwitchers";
import { AgentChatPanel } from "../features/agent-chat/components/AgentChatPanel";

// Sidebar highlight follows the route; grows one mapping per top-level route.
function activeItemFor(pathname: string): string {
  if (pathname.startsWith("/settings")) return "settings";
  return "projects";
}

// App shell per the oxygen-ui skill's canonical AppLayout: Header + Sidebar +
// Main(Outlet) + Footer. NotificationPanel arrives with its feature.
export function AppLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeItem = activeItemFor(pathname);
  const { user, signOut, orgHandle } = useSession();

  // Project AI panel (#130): available on every project route — mounted here
  // because the full-screen spec route bypasses ProjectLayout. Same
  // strict:false param read as the header's project switcher.
  const params = useParams({ strict: false }) as { projectName?: string };
  const projectName = params.projectName;
  const [chatOpen, setChatOpen] = useState(false);

  // "Generate spec" CTA (#150): the Spec card navigates here with ?generate=1.
  // Open the panel and hand the one-shot signal to AgentChatPanel, which sends
  // the first requirements turn; then strip the param so a refresh/back doesn't
  // re-fire it.
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    generate?: "requirements" | "design";
  };
  const generate = search.generate;
  useEffect(() => {
    if (generate && projectName) setChatOpen(true);
  }, [generate, projectName]);
  const clearGenerate = useCallback(() => {
    if (!projectName) return;
    void navigate({
      to: "/projects/$projectName/spec",
      params: { projectName },
      search: {},
      replace: true,
    });
  }, [navigate, projectName]);

  return (
    <AppShell initialCollapsed={false} collapseOnSelectOnMobile>
      <AppShell.Navbar>
        <Header>
          <Header.Toggle />
          <Header.Brand>
            {/* Logo/title lead home — the projects list (issue #71). */}
            <Link
              to="/"
              style={{
                display: "flex",
                alignItems: "center",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <Header.BrandLogo>
                <WSO2 size={24} />
              </Header.BrandLogo>
              <Header.BrandTitle>Agentic Engineer</Header.BrandTitle>
            </Link>
          </Header.Brand>
          <Header.Switchers showDivider={false}>
            <OrgSwitcher />
            <ProjectSwitcher />
          </Header.Switchers>
          <Header.Spacer />
          <Header.Actions>
            {projectName && (
              <Tooltip title={chatOpen ? "Close agent chat" : "Agent chat"}>
                <IconButton
                  aria-label="Toggle agent chat"
                  color={chatOpen ? "primary" : "default"}
                  onClick={() => setChatOpen((v) => !v)}
                >
                  <Sparkles size={20} />
                </IconButton>
              </Tooltip>
            )}
            <ColorSchemeToggle />
            <Divider orientation="vertical" flexItem sx={{ mx: 2 }} />
            <UserMenu>
              <UserMenu.Trigger name={user.name} />
              <UserMenu.Header
                name={user.name}
                email={user.email}
                {...(user.role ? { role: user.role } : {})}
              />
              <UserMenu.Item icon={<UserIcon />} label="Profile" />
              <UserMenu.Item icon={<Settings />} label="Settings" />
              <UserMenu.Divider />
              <UserMenu.Logout icon={<LogOut />} label="Sign out" onClick={signOut} />
            </UserMenu>
          </Header.Actions>
        </Header>
      </AppShell.Navbar>

      <AppShell.Sidebar>
        <Sidebar activeItem={activeItem}>
          <Sidebar.Nav>
            <Sidebar.Category>
              <Sidebar.Item id="projects" link={<Link to="/" />}>
                <Sidebar.ItemIcon>
                  <FolderOpen />
                </Sidebar.ItemIcon>
                <Sidebar.ItemLabel>Projects</Sidebar.ItemLabel>
              </Sidebar.Item>
            </Sidebar.Category>
          </Sidebar.Nav>
          <Sidebar.Footer>
            <Sidebar.Category>
              {/* Org-level Settings (issue #96) — not the UserMenu's
                  personal-settings stub above, which is untouched. */}
              <Sidebar.Item id="settings" link={<Link to="/settings" />}>
                <Sidebar.ItemIcon>
                  <Settings />
                </Sidebar.ItemIcon>
                <Sidebar.ItemLabel>Settings</Sidebar.ItemLabel>
              </Sidebar.Item>
            </Sidebar.Category>
          </Sidebar.Footer>
        </Sidebar>
      </AppShell.Sidebar>

      <AppShell.Main>
        {/* Content + the project AI panel side by side: the page shrinks
            rather than being overlaid; the panel mounts only while open.
            AppShell.Main is itself a flex container, so this wrapper must
            grow (it's a flex ITEM) or it collapses to content width. */}
        <Box
          sx={{
            display: "flex",
            flexGrow: 1,
            width: "100%",
            minWidth: 0,
            height: "100%",
            minHeight: 0,
          }}
        >
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Outlet />
          </Box>
          {/* Horizontal Collapse gives the sidebar-style slide; unmountOnExit
              keeps the closed panel out of the tree (no idle polling). */}
          {projectName && (
            <Collapse
              in={chatOpen}
              orientation="horizontal"
              unmountOnExit
              sx={{ height: "100%", flexShrink: 0 }}
            >
              <AgentChatPanel
                org={orgHandle ?? "default"}
                projectName={projectName}
                onClose={() => setChatOpen(false)}
                {...(generate ? { autoGenerate: generate } : {})}
                onAutoGenerated={clearGenerate}
              />
            </Collapse>
          )}
        </Box>
      </AppShell.Main>

      <AppShell.Footer>
        <Footer>
          <Footer.Copyright>
            © {new Date().getFullYear()} WSO2 LLC.
          </Footer.Copyright>
          <Footer.Divider />
          <Footer.Version>oxygen-ui-v{OXYGEN_UI_VERSION}</Footer.Version>
        </Footer>
      </AppShell.Footer>
    </AppShell>
  );
}
