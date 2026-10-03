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
 * A preview smoke run under Oxygen: `prototype preview --theme` played in
 * Chromium, through the sandboxed frame, as a reviewer clicks it. It covers
 * what a theme draws and wires — navigation, rows, forms and validation, tabs,
 * dialogs, drawers, the stepper, Annotate selecting instead of acting — and
 * that the frame fetches nothing.
 */

import { chromium, type Browser, type FrameLocator, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startPreview, type PreviewProcess } from "../harness.js";

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

interface Session {
  preview: PreviewProcess;
  page: Page;
  app: FrameLocator;
  requests: string[];
  /** Uncaught errors in the host page or its sandboxed frame. */
  errors: string[];
}

async function open(fixture: string): Promise<Session> {
  const preview = await startPreview(`valid/${fixture}`);
  const page = await browser.newPage();
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  // Playwright reports a frame's uncaught errors here too, the sandboxed one included.
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(preview.url);
  return { preview, page, app: page.frameLocator('iframe[title$="prototype app"]'), requests, errors };
}

/**
 * The frame is sandboxed without `allow-same-origin`, so it has no storage: any
 * code of the theme or of Oxygen that reads `localStorage` unguarded throws
 * there. None may, whatever the run drew.
 */
async function close(s: Session): Promise<void> {
  const errors = s.errors;
  await s.page.close();
  await s.preview.stop();
  expect(errors).toEqual([]);
}

describe("contacts under Oxygen", () => {
  let s: Session;

  beforeAll(async () => {
    s = await open("contacts");
  });

  afterAll(async () => {
    await close(s);
  });

  beforeEach(async () => {
    // A reload starts from the seed and the entry screen (no --persist).
    await s.page.reload();
    await s.app.getByRole("heading", { name: "Acme contacts" }).waitFor();
  });

  it("navigates, validates a form and creates a record that shows on another screen, fetching nothing", async () => {
    await s.app.getByRole("row", { name: "Alan Turing" }).click();
    await s.app.getByRole("heading", { name: "Alan Turing" }).waitFor();
    await s.app.locator('[data-proto-key="nav.contacts"]').click();

    await s.app.getByRole("button", { name: "New contact" }).click();
    await s.app.getByRole("button", { name: "Save" }).click();
    await s.app.getByText("Fix 2 problems").waitFor();
    await s.app.getByRole("textbox", { name: "Name", exact: true }).fill("Grace Hopper");
    await s.app.getByRole("textbox", { name: "Email", exact: true }).fill("grace@example.com");
    await s.app.getByRole("button", { name: "Save" }).click();
    await s.app.getByRole("heading", { name: "Grace Hopper" }).waitFor();
    await s.app.locator('[data-proto-key="nav.contacts"]').click();
    await s.app.getByRole("row", { name: "Grace Hopper" }).waitFor();

    // Fonts and styles are inline: everything came from the preview server, which serves the host page and the runtime.
    expect(s.requests.filter((url) => !url.startsWith(s.preview.url))).toEqual([]);
  });

  it("runs in a frame that has no storage, and raises no uncaught error there", async () => {
    const noStorage = await s.page
      .frames()
      .find((f) => f !== s.page.mainFrame())!
      .evaluate(() => {
        try {
          void window.localStorage;
          return false;
        } catch {
          return true;
        }
      });
    expect(noStorage).toBe(true);
    expect(s.errors).toEqual([]);
  });

  it("fills fields and turns a switch on by their accessible names", async () => {
    await s.app.locator('[data-proto-key="nav.settings"]').click();
    await s.app.getByRole("textbox", { name: "Company", exact: true }).fill("Globex");
    await s.app.getByRole("button", { name: "Save settings" }).click();
    await s.app.getByText("Confirm company change is required").first().waitFor();
    await s.app.getByRole("switch", { name: "Confirm company change", exact: true }).click();
    await s.app.getByRole("button", { name: "Save settings" }).click();
    await s.app.getByRole("heading", { name: "Globex contacts" }).waitFor();
  });

  it("selects instead of acting in Annotate", async () => {
    await s.page.getByRole("button", { name: "Annotate" }).click();
    const button = s.app.locator('[data-proto-key="btn.new"]');
    await button.click();
    expect(await button.getAttribute("aria-pressed")).toBe("true");
    expect(await s.app.getByRole("heading", { name: "New contact" }).count()).toBe(0);
    await s.page.getByRole("button", { name: "Preview" }).click();
  });
});

describe("integration-monitor under Oxygen", () => {
  let s: Session;

  beforeAll(async () => {
    s = await open("integration-monitor");
  });

  afterAll(async () => {
    await close(s);
  });

  it("switches tabs and opens and closes a dialog and a drawer", async () => {
    await s.app.getByRole("row", { name: "#8812" }).click();
    await s.app.getByRole("heading", { name: "Run #8812 · Salesforce → ERP" }).waitFor();
    await s.app.getByRole("tab", { name: "Log" }).click();
    await s.app.getByText("Run started").waitFor();

    // Escape the dialog handles is the prototype's own: it must not reach the host (which would close a console review).
    await s.page.evaluate(() => {
      const w = window as unknown as { __escapes: number };
      w.__escapes = 0;
      window.addEventListener("message", (e) => {
        if ((e.data as { type?: string } | null)?.type === "proto:escape") w.__escapes++;
      });
    });
    await s.app.getByRole("button", { name: "Replay run" }).click();
    const dialog = s.app.getByRole("dialog", { name: "Replay run #8812?" });
    await dialog.waitFor();
    await s.app.getByRole("button", { name: "Cancel" }).press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await s.page.waitForTimeout(300);
    expect(await s.page.evaluate(() => (window as unknown as { __escapes: number }).__escapes)).toBe(0);

    await s.app.getByRole("tab", { name: "Summary" }).click();
    await s.app.getByRole("button", { name: "View payload" }).click();
    const drawer = s.app.getByRole("dialog", { name: "First failed message" });
    await drawer.waitFor();
    await s.app.getByRole("button", { name: "Close" }).click();
    await drawer.waitFor({ state: "hidden" });
  });
});

describe("expense-approval under Oxygen", () => {
  let s: Session;

  beforeAll(async () => {
    s = await open("expense-approval");
  });

  afterAll(async () => {
    await close(s);
  });

  it("moves between steps", async () => {
    await s.app.getByRole("heading", { name: "Approval queue" }).waitFor();
    await s.page.getByRole("combobox", { name: "Role" }).selectOption({ label: "Employee" });
    await s.app.locator('[data-proto-key="nav.new"]').click();
    await s.app.getByRole("heading", { name: "New expense" }).waitFor();
    await s.app.getByRole("spinbutton", { name: "Amount", exact: true }).waitFor();
    await s.app.getByRole("button", { name: "Next" }).click();
    await s.app.getByText("Attach the receipt. Photos and PDFs are accepted.").waitFor();
    await s.app.getByRole("button", { name: "Back" }).click();
    await s.app.getByRole("spinbutton", { name: "Amount", exact: true }).waitFor();
  });
});
