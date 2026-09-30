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

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentScreen } from "./AgentScreen";
import { toAttachment } from "./attachments";
import { sendTurn } from "./chat";
import type { Launch } from "./launch";

vi.mock("./chat", async (original) => ({ ...(await original<typeof import("./chat")>()), sendTurn: vi.fn() }));
vi.mock("./attachments", async (original) => {
  const actual = await original<typeof import("./attachments")>();
  return { ...actual, toAttachment: vi.fn(actual.toAttachment) };
});

const base: Launch = {
  project: "p",
  component: "receipt-agent",
  issuer: "http://i",
  clientId: "c",
  resource: "r",
  scopes: ["openid"],
  endpoint: "http://agent",
};
const withFiles: Launch = { ...base, attachments: { types: ["image/jpeg"], maxFiles: 1, maxFileSizeMB: 5 } };
const renderScreen = (launch: Launch) =>
  render(<AgentScreen launch={launch} token="t" username="u" onSignOut={async () => {}} />);
const attach = (...files: File[]) =>
  fireEvent.change(screen.getByLabelText("Attach files"), { target: { files } });

describe("AgentScreen attachments", () => {
  beforeEach(() => vi.mocked(sendTurn).mockReset());

  it("shows no attach control for a text-only agent", () => {
    renderScreen(base);
    expect(screen.queryByLabelText("Attach files")).toBeNull();
  });

  it("sends a file with no text", async () => {
    vi.mocked(sendTurn).mockResolvedValue({ kind: "reply", conversationId: "c1", text: "read it", toolCalls: [] });
    renderScreen(withFiles);
    attach(new File(["x"], "r.jpg", { type: "image/jpeg" }));
    fireEvent.click(screen.getByLabelText("Send"));
    await waitFor(() => expect(sendTurn).toHaveBeenCalled());
    expect(vi.mocked(sendTurn).mock.calls[0]![2]).toMatchObject({
      message: "",
      attachments: [{ name: "r.jpg", mediaType: "image/jpeg" }],
    });
  });

  it("keeps the files and draft when the turn fails, and shows the agent's answer", async () => {
    vi.mocked(sendTurn).mockResolvedValue({ kind: "upstream", status: 400, body: '{"error":"this agent does not accept attachments"}' });
    renderScreen(withFiles);
    attach(new File(["x"], "r.jpg", { type: "image/jpeg" }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "read this" } });
    fireEvent.click(screen.getByLabelText("Send"));
    await screen.findByText(/does not accept attachments/);
    expect(screen.getByText("r.jpg")).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toHaveValue("read this");
  });

  it("gives the files and draft back, and unlocks, when a file cannot be read", async () => {
    vi.mocked(toAttachment).mockRejectedValueOnce(new Error("NotReadableError"));
    renderScreen(withFiles);
    attach(new File(["x"], "r.jpg", { type: "image/jpeg" }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "read this" } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(await screen.findByText(/r\.jpg: could not be read/)).toBeInTheDocument();
    expect(screen.getByText("r.jpg")).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toHaveValue("read this");
    expect(screen.getByLabelText("Send")).not.toBeDisabled();
    expect(sendTurn).not.toHaveBeenCalled();
  });

  it("names a rejected file", async () => {
    renderScreen(withFiles);
    attach(new File(["x"], "p.png", { type: "image/png" }));
    expect(await screen.findByText(/p\.png: this agent does not accept this type of file/)).toBeInTheDocument();
  });
});
