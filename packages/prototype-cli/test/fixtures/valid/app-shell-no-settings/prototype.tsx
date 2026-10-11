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

// Fixture: an app with nothing to set, drawn in the kit's app shell with no
// `settings`: its user menu has Account, an entry of its own and Sign out, and
// the prototype has no settings screen.

import type { ReactNode } from "react";
import {
  AppShell,
  Button,
  Detail,
  EmptyState,
  Heading,
  Screen,
  Table,
  Text,
  defineApp,
  useDisplayState,
  useRole,
  type AppShellUser,
} from "@wso2/prototype-kit";

const USERS: Record<string, AppShellUser> = {
  employee: { name: "Dana Lee", email: "dana@acme.example" },
  manager: { name: "Priya Shah", email: "priya@acme.example" },
};

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  return (
    <AppShell
      id="shell"
      user={USERS[role] ?? { name: "Guest" }}
      nav={[
        { id: "nav.requests", label: "My requests", to: "screen.requests" },
        { id: "nav.team", label: "Team requests", to: "screen.team" },
      ]}
      account="screen.account"
      signOut="screen.signed-out"
      menu={[{ id: "menu.team", label: "My team", to: "screen.team" }]}
    >
      {children}
    </AppShell>
  );
}

const REQUESTS = [
  { id: "row.r1", cells: ["2026-02-02", "2026-02-06", "Approved"], tone: "success" as const },
  { id: "row.r2", cells: ["2026-03-16", "2026-03-17", "Pending"], tone: "warning" as const },
];

function Requests() {
  const state = useDisplayState();
  return (
    <Shell>
      <Heading id="heading.requests" text="My requests" />
      <Table
        id="table.requests"
        columns={["From", "To", "Status"]}
        rows={state === "state.empty" ? [] : REQUESTS}
        empty={<EmptyState id="empty.requests" title="No requests yet" text="Requests you make show here." />}
      />
    </Shell>
  );
}

function Team() {
  return (
    <Shell>
      <Heading id="heading.team" text="Team requests" />
      <Table id="table.team" columns={["Who", "From", "To"]} rows={[{ id: "row.t1", cells: ["Dana Lee", "2026-03-16", "2026-03-17"] }]} />
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const user = USERS[role] ?? { name: "Guest" };
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail
        id="detail.account"
        fields={[
          { label: "Name", value: user.name },
          { label: "Email", value: user.email ?? "" },
        ]}
      />
    </Shell>
  );
}

function SignedOut() {
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Text id="text.signed-out" text="Sign in again to see your leave requests." />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to="screen.requests" />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.requests": Requests,
    "screen.team": Team,
    "screen.account": Account,
    "screen.signed-out": SignedOut,
  },
});
