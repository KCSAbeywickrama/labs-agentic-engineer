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

// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentView } from "./AgentView.js";

const AFM = `---
spec_version: "0.4.0"
name: "booking-agent"
description: "Books hotels by chatting."
max_iterations: 12

model:
  provider: "anthropic"
  name: "\${env:MODEL_NAME}"
  url: "\${env:MODEL_ENDPOINT}"
  authentication:
    type: "api-key"
    api_key: "\${env:MODEL_API_KEY}"

interfaces:
  - type: webchat
    exposure:
      http:
        path: "/chat"

x-aep:
  tools:
    openapi:
      - component: "hotel-api"
        baseUrl: "\${env:HOTEL_API_URL}"
        allow: [listHotels, createReservation]
  memory:
    type: "client"
  identity:
    mode: "on-behalf-of"
---

# Role
You help a traveler book a hotel.

# Style
Short and practical.
`;

describe("AgentView", () => {
  it("renders the agent's identity and its prompt sections", () => {
    render(<AgentView spec={AFM} />);

    expect(screen.getByText("booking-agent")).toBeInTheDocument();
    expect(screen.getByText("Books hotels by chatting.")).toBeInTheDocument();
    expect(screen.getByText("Role")).toBeInTheDocument();
    expect(screen.getByText("You help a traveler book a hotel.")).toBeInTheDocument();
    expect(screen.getByText("Style")).toBeInTheDocument();
  });

  it("lists each allowed operation under the component that provides it", () => {
    render(<AgentView spec={AFM} />);

    expect(screen.getByText("hotel-api")).toBeInTheDocument();
    expect(screen.getByText("listHotels")).toBeInTheDocument();
    expect(screen.getByText("createReservation")).toBeInTheDocument();
  });

  it("renders without toolStatus — no status chips for callers that don't fetch it", () => {
    render(<AgentView spec={AFM} />);

    expect(screen.queryByText("Resolved")).not.toBeInTheDocument();
    expect(screen.queryByText("Unresolved")).not.toBeInTheDocument();
  });

  it("surfaces the server's reason when an operation is unresolved", () => {
    render(
      <AgentView
        spec={AFM}
        toolStatus={{
          "hotel-api:listHotels": { status: "resolved" },
          "hotel-api:createReservation": {
            status: "unresolved",
            reason: "createReservation is not an operationId of hotel-api's contract",
          },
        }}
      />,
    );

    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText("Unresolved")).toBeInTheDocument();
    expect(
      screen.getByText("createReservation is not an operationId of hotel-api's contract"),
    ).toBeInTheDocument();
  });

  it("does not surface metadata chips — spec version, step cap, memory, identity are noise here", () => {
    render(<AgentView spec={AFM} />);

    expect(screen.queryByText(/AFM 0\.4\.0/)).not.toBeInTheDocument();
    expect(screen.queryByText(/max 12 steps/)).not.toBeInTheDocument();
    expect(screen.queryByText(/client memory/)).not.toBeInTheDocument();
    expect(screen.queryByText("on-behalf-of")).not.toBeInTheDocument();
  });

  it("says where the model comes from rather than showing the ${env:} placeholder", () => {
    render(<AgentView spec={AFM} />);

    expect(screen.getByText("anthropic")).toBeInTheDocument();
    expect(screen.queryByText(/\$\{env:MODEL_NAME\}/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$\{env:MODEL_ENDPOINT\}/)).not.toBeInTheDocument();
    expect(screen.getAllByText("set by the platform at deploy").length).toBeGreaterThan(0);
  });

  it("never renders the auth or API-key fields", () => {
    render(<AgentView spec={AFM} />);

    expect(screen.queryByText("api-key")).not.toBeInTheDocument();
    expect(screen.queryByText(/MODEL_API_KEY/)).not.toBeInTheDocument();
    expect(screen.queryByText("API key")).not.toBeInTheDocument();
  });

  it("explains what the interface type means", () => {
    render(<AgentView spec={AFM} />);

    expect(screen.getByText("webchat")).toBeInTheDocument();
    expect(screen.getByText("POST /chat")).toBeInTheDocument();
    expect(screen.getByText(/an HTTP endpoint a web app calls/i)).toBeInTheDocument();
  });

  it("shows an alert instead of throwing when the document has no front matter", () => {
    render(<AgentView spec={"# Role\nno front matter here\n"} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
