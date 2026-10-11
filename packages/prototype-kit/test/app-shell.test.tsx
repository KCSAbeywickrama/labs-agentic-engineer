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

/**
 * The app shell's user menu: Account and Sign out always, Settings only when
 * the application has a settings screen, so a prototype with nothing to set
 * never needs invented preferences to fill one.
 */

import type { ComponentType, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell, type ThemeAppShellProps } from "../src/components/shell.js";
import { KitContext, type KitContextValue } from "../src/runtime/context.js";
import { createDataStore } from "../src/runtime/store.js";
import { ThemeContext } from "../src/theme/context.js";
import type { ThemeRegistry } from "../src/theme/contract.js";
import type { PrototypeManifest } from "../src/manifest/types.js";

const manifest = {
  schemaVersion: 3,
  name: "Lunch",
  entryScreen: "screen.home",
  roles: [{ id: "teammate", name: "Teammate" }],
  states: [{ id: "state.default", name: "Default" }],
  screens: [
    { id: "screen.home", name: "Home", roleIds: ["teammate"] },
    { id: "screen.account", name: "Account", roleIds: ["teammate"] },
    { id: "screen.settings", name: "Settings", roleIds: ["teammate"] },
    { id: "screen.signed-out", name: "Signed out", roleIds: ["teammate"] },
  ],
  flows: [],
} as PrototypeManifest;

/** Renders `shell` and returns the props the theme's AppShell was given. */
function themeProps(shell: ReactNode): ThemeAppShellProps {
  let seen: ThemeAppShellProps | undefined;
  const ThemeShell: ComponentType<ThemeAppShellProps> = (props) => {
    seen = props;
    return null;
  };
  const registry = new Proxy({} as ThemeRegistry, { get: (_, name) => (name === "AppShell" ? ThemeShell : () => null) });
  const ctx = {
    manifest,
    view: { mode: "preview", roleId: "teammate", stateId: "state.default", screenId: "screen.home", pins: {} },
    params: {},
    store: createDataStore({}, undefined, () => {}),
    toggle: () => {},
    openPin: () => {},
    go: () => {},
  } as unknown as KitContextValue;
  renderToStaticMarkup(
    <ThemeContext.Provider value={registry}>
      <KitContext.Provider value={ctx}>{shell}</KitContext.Provider>
    </ThemeContext.Provider>,
  );
  if (!seen) throw new Error("the theme's AppShell was not drawn");
  return seen;
}

const base = { id: "shell", user: { name: "Maya" }, nav: [], account: "screen.account", signOut: "screen.signed-out" };

describe("<AppShell> user menu", () => {
  it("has a Settings entry when the application names a settings screen", () => {
    const props = themeProps(<AppShell {...base} settings="screen.settings" />);
    expect(props.menu.map((e) => e.label)).toEqual(["Account", "Settings"]);
    expect(props.signOut?.label).toBe("Sign out");
  });

  it("has none when the application has nothing to set, and keeps Account and Sign out", () => {
    const props = themeProps(<AppShell {...base} menu={[{ id: "menu.team", label: "My team", to: "screen.home" }]} />);
    expect(props.menu.map((e) => e.label)).toEqual(["Account", "My team"]);
    expect(props.signOut?.label).toBe("Sign out");
  });
});
