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

import {
  AppShell,
  ColorSchemeToggle,
  Divider,
  Footer,
  Header,
  Sidebar,
  UserMenu,
  version as OXYGEN_UI_VERSION,
} from "@wso2/oxygen-ui";
import { FolderOpen, Settings, User as UserIcon, WSO2 } from "@wso2/oxygen-ui-icons-react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";

// TODO(auth): replace with the signed-in user when auth lands.
const devUser = {
  name: "Developer",
  email: "developer@example.com",
  role: "Developer",
};

// Sidebar highlight follows the route; grows one mapping per top-level route.
function activeItemFor(pathname: string): string {
  if (pathname === "/" || pathname.startsWith("/projects")) return "projects";
  return "projects";
}

// App shell per the oxygen-ui skill's canonical AppLayout: Header + Sidebar +
// Main(Outlet) + Footer. NotificationPanel and org/project switchers arrive
// with their features.
export function AppLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeItem = activeItemFor(pathname);

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
          <Header.Spacer />
          <Header.Actions>
            <ColorSchemeToggle />
            <Divider orientation="vertical" flexItem sx={{ mx: 2 }} />
            <UserMenu>
              <UserMenu.Trigger name={devUser.name} />
              <UserMenu.Header
                name={devUser.name}
                email={devUser.email}
                role={devUser.role}
              />
              <UserMenu.Item icon={<UserIcon />} label="Profile" />
              <UserMenu.Item icon={<Settings />} label="Settings" />
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
              {/* Stub until the Admin feature lands. */}
              <Sidebar.Item id="settings">
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
        <Outlet />
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
