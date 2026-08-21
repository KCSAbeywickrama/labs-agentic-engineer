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

import type { ElementType, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Router replaced so PageHeader's back-link renders as a plain anchor — no
// RouterProvider needed (mirrors DeploymentsPage.test.tsx).
vi.mock("@tanstack/react-router", () => ({
  createLink: (Component: ElementType) =>
    function MockLink({
      to,
      params,
      ...rest
    }: {
      to: string;
      params?: Record<string, unknown>;
    } & Record<string, unknown>) {
      let href = to;
      for (const [key, value] of Object.entries(params ?? {})) {
        href = href.replace(`$${key}`, String(value));
      }
      return <Component component="a" href={href} {...rest} />;
    },
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));

// The component list + the deploy-state poller the Deployments board uses;
// overridden per test, reset in beforeEach.
const DEFAULT_COMPONENTS = [
  { name: "booking-agent", displayName: "Booking Agent", type: "ai-agent" },
  { name: "storefront", displayName: "Storefront", type: "web-application" },
];
const DEFAULT_DEPLOYMENTS = [
  {
    componentName: "booking-agent",
    environment: "development",
    status: "Ready",
    endpointUrl: "https://booking-agent.dev.example.com",
  },
];
let mockComponents: Array<Record<string, unknown>> = DEFAULT_COMPONENTS;
let mockDeployments: Array<Record<string, unknown>> = DEFAULT_DEPLOYMENTS;
// The poller's own in-flight flag. The stub is synchronous, so a test has to
// say so explicitly to exercise the first paint, before any deployment is known.
let mockDeploymentsPending = false;

vi.mock("../../projects/api/queries", () => ({
  useProjectComponents: () => ({
    data: { items: mockComponents },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useComponentsDeployments: () => ({
    isPending: mockDeploymentsPending,
    deployments: mockDeploymentsPending ? [] : mockDeployments,
    failedCount: 0,
  }),
}));

// The typed client is stubbed at the API boundary (the pattern in
// features/validation/api/queries.test.tsx) — the tester's whole contract is
// the InvokeRequest it POSTs and the InvokeResponse it reads back.
const mockPOST = vi.fn();
vi.mock("../../../api/client", () => ({
  client: { POST: (...args: unknown[]) => mockPOST(...args) },
}));

// Imported AFTER the mocks so the module under test picks up the stubs.
const { TestPage } = await import("./TestPage");

/** The InvokeRequest body of the nth invoke call, with its JSON payload parsed. */
function invokeCall(n: number) {
  const body = mockPOST.mock.calls[n]?.[1]?.body as {
    method: string;
    path: string;
    contentType?: string;
    body?: string;
  };
  return {
    ...body,
    payload: JSON.parse(body.body ?? "{}") as {
      conversationId?: string;
      message: string;
    },
  };
}

/** An invoke that relayed successfully, carrying an upstream response. */
function relayed(status: number, body: unknown, truncated = false) {
  return {
    data: {
      status,
      contentType: "application/json",
      body: typeof body === "string" ? body : JSON.stringify(body),
      truncated,
    },
    error: undefined,
    response: { status: 200 } as Response,
  };
}

/** An invoke that aep-api itself refused. */
function refused(status: number, message: string) {
  return {
    data: undefined,
    error: { code: status === 409 ? "conflict" : "internal", message },
    response: { status } as Response,
  };
}

function chat(text: string, conversationId: string, toolCalls: unknown[] = []) {
  return relayed(200, { conversationId, text, toolCalls });
}

async function send(message: string) {
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: message },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  // The turn is over when the in-flight indicator is gone — the input's own
  // disabled state can't stand in for it (a 409 leaves it disabled for good).
  await waitFor(() => expect(screen.queryByLabelText("Sending")).not.toBeInTheDocument());
}

beforeEach(() => {
  mockComponents = DEFAULT_COMPONENTS;
  mockDeployments = DEFAULT_DEPLOYMENTS;
  mockDeploymentsPending = false;
  mockPOST.mockReset();
});

describe("TestPage — the agent list", () => {
  // The first cut's tester is the agent chat, so a component with no tester
  // has no business in the picker (a web app row would be a dead end).
  it("lists only ai-agent components", () => {
    // Two agents, because the picker is only rendered when there is a choice
    // to make — with one agent its identity lives in the chat header instead.
    mockComponents = [
      ...DEFAULT_COMPONENTS,
      { name: "support-agent", displayName: "Support Agent", type: "ai-agent" },
    ];

    render(<TestPage projectName="acme" />);

    expect(screen.getByRole("button", { name: /Booking Agent/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Support Agent/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Storefront/ })).not.toBeInTheDocument();
  });

  it("says so when the project has no agents", () => {
    mockComponents = [{ name: "storefront", displayName: "Storefront", type: "web-application" }];

    render(<TestPage projectName="acme" />);

    expect(screen.getByText("No agents in this project.")).toBeInTheDocument();
  });

  // Regression: `readyNames` is empty until the poller answers, so reading
  // "no ready deployment" as "unreachable" libelled every deployed agent on
  // first paint — and disabled its input — until the first poll returned.
  it("does not call an agent unreachable while the deployments read is still in flight", () => {
    mockDeploymentsPending = true;

    render(<TestPage projectName="acme" />);

    expect(screen.queryByText("Not reachable yet")).not.toBeInTheDocument();
    expect(
      screen.queryByText("This agent is not reachable yet — it has no deployed gateway URL."),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Message")).not.toBeDisabled();
  });

  // Deploy state comes from the same poller the Deployments board reads; an
  // agent with no ready deployment cannot be talked to and says why.
  it("marks an agent with no ready deployment as not reachable yet", () => {
    mockDeployments = [];

    render(<TestPage projectName="acme" />);

    // The lone agent has no picker card, so the tester itself is where an
    // unreachable agent has to say so — and it must also stop taking input.
    expect(screen.getByText(/not reachable yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeDisabled();
  });
});

describe("TestPage — the chat tester", () => {
  it("sends the message through invoke as a POST to /chat, with no conversation id on the first turn", async () => {
    mockPOST.mockResolvedValue(chat("hello there", "conv-1"));

    render(<TestPage projectName="acme" />);
    await send("hi");

    expect(mockPOST).toHaveBeenCalledWith(
      "/projects/{projectName}/components/{componentName}/invoke",
      expect.objectContaining({
        params: { path: { projectName: "acme", componentName: "booking-agent" } },
      }),
    );
    const call = invokeCall(0);
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/chat");
    expect(call.contentType).toBe("application/json");
    expect(call.payload).toEqual({ message: "hi" });
    expect(call.payload.conversationId).toBeUndefined();
  });

  // The memory contract (ADR-0020): the caller holds the issued id and its own
  // transcript, and echoes the id back verbatim — never a message array.
  it("renders the reply and echoes the issued conversation id on the next turn", async () => {
    mockPOST.mockResolvedValue(chat("hello there", "conv-1"));

    render(<TestPage projectName="acme" />);
    await send("hi");

    expect(screen.getByText("hello there")).toBeInTheDocument();

    mockPOST.mockResolvedValue(chat("still here", "conv-1"));
    await send("again");

    expect(invokeCall(1).payload).toEqual({
      conversationId: "conv-1",
      message: "again",
    });
  });

  // An upstream 404 means the conversation is gone or was never this user's;
  // retrying the id would only 404 again.
  it("drops the conversation id when the agent 404s it, and starts fresh", async () => {
    mockPOST.mockResolvedValue(chat("hello there", "conv-1"));

    render(<TestPage projectName="acme" />);
    await send("hi");

    mockPOST.mockResolvedValue(relayed(404, { message: "not found" }));
    await send("again");

    expect(screen.getByText("That conversation expired. Starting a fresh one.")).toBeInTheDocument();

    mockPOST.mockResolvedValue(chat("hello again", "conv-2"));
    await send("third");

    expect(invokeCall(2).payload).toEqual({ message: "third" });
  });

  it("hints at re-signing in when the gateway rejects the session", async () => {
    mockPOST.mockResolvedValue(relayed(401, "unauthorized"));

    render(<TestPage projectName="acme" />);
    await send("hi");

    expect(
      screen.getByText("This session can't reach the agent — sign in again?"),
    ).toBeInTheDocument();
  });

  it("shows any other upstream status with its raw body", async () => {
    mockPOST.mockResolvedValue(relayed(500, "boom"));

    render(<TestPage projectName="acme" />);
    await send("hi");

    expect(screen.getByText("The agent answered 500.")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  // What the tester is FOR: seeing that the agent reached for a tool.
  it("discloses how many tools the agent reached for", async () => {
    mockPOST.mockResolvedValue(
      chat("found two", "conv-1", [{ toolName: "listHotels" }, { toolName: "bookHotel" }]),
    );

    render(<TestPage projectName="acme" />);
    await send("find me a hotel in Paris");

    expect(screen.getByText("called listHotels")).toBeInTheDocument();
    expect(screen.getByText("called bookHotel")).toBeInTheDocument();
  });

  it("refuses to send a second message while a turn is in flight", async () => {
    let settle: (value: unknown) => void = () => {};
    mockPOST.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );

    render(<TestPage projectName="acme" />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeDisabled(),
    );
    // A typed second message must not be sendable either — the block is the
    // turn in flight, not the empty input.
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "and again" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    settle(chat("hello there", "conv-1"));
    await waitFor(() => expect(screen.getByText("hello there")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
    expect(mockPOST).toHaveBeenCalledTimes(1);
  });

  // 409 is aep-api's own answer: the component has no gateway URL to relay to.
  it("states plainly that the agent is not reachable, and stops taking input", async () => {
    mockPOST.mockResolvedValue(refused(409, "not-reachable"));

    render(<TestPage projectName="acme" />);
    await send("hi");

    expect(
      screen.getByText("This agent is not reachable yet — it has no deployed gateway URL."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeDisabled();
  });

  // Every other invoke-level failure is transient as far as the tester knows,
  // so the input stays live for a retry.
  it("banners an invoke failure but keeps the input live", async () => {
    mockPOST.mockResolvedValue(refused(500, "relay exploded"));

    render(<TestPage projectName="acme" />);
    await send("hi");

    expect(screen.getByText("relay exploded")).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).not.toBeDisabled();
  });

  it("clears the transcript and the id on a new conversation", async () => {
    mockPOST.mockResolvedValue(chat("hello there", "conv-1"));

    render(<TestPage projectName="acme" />);
    await send("hi");
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));

    expect(screen.queryByText("hello there")).not.toBeInTheDocument();

    mockPOST.mockResolvedValue(chat("fresh", "conv-2"));
    await send("hi again");

    expect(invokeCall(1).payload).toEqual({ message: "hi again" });
  });

  // The button is shielded by `disabled`, so it can never prove the guard
  // inside `send()`. Enter is the path with no shield — and that guard is the
  // whole lost-update mitigation, so it needs a test that fails without it.
  it("refuses an Enter-key send while a turn is in flight", async () => {
    let settle: (value: unknown) => void = () => {};
    mockPOST.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );

    render(<TestPage projectName="acme" />);
    const input = screen.getByLabelText("Message");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mockPOST).toHaveBeenCalledTimes(1));

    fireEvent.change(input, { target: { value: "and again" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mockPOST).toHaveBeenCalledTimes(1);

    settle(chat("hello there", "conv-1"));
    await waitFor(() => expect(screen.getByText("hello there")).toBeInTheDocument());
    expect(mockPOST).toHaveBeenCalledTimes(1);
  });

  // A body cut at the relay's cap can never parse, so without saying why it
  // surfaces as an unreadable 200 — misleading exactly when the reason matters.
  it("says when the relay cut the body short", async () => {
    mockPOST.mockResolvedValue(relayed(200, '{"text":"a very long ans', true));

    render(<TestPage projectName="acme" />);
    await send("hi");

    expect(screen.getByText("The agent answered 200.")).toBeInTheDocument();
    expect(
      screen.getByText("The relay cut this body short at its 1 MiB cap."),
    ).toBeInTheDocument();
  });

  // Without a mark, a retry appends a second "You" line and the transcript
  // reads as two delivered turns.
  it("marks the turn that never got an answer", async () => {
    mockPOST.mockResolvedValue(refused(500, "relay exploded"));

    render(<TestPage projectName="acme" />);
    await send("hi");

    expect(screen.getByText("not delivered")).toBeInTheDocument();
  });

  it("says out loud that a turn spends real money", () => {
    render(<TestPage projectName="acme" />);

    expect(
      screen.getByText("Talks to the live agent, on the organisation's model key"),
    ).toBeInTheDocument();
  });
});

describe("TestPage — failures that used to be reported as something else", () => {
  // A 404 on a turn that carried NO conversationId cannot be an expired
  // conversation — there was none. It is the gateway or an unwired /chat
  // route, and calling it "expired" hid a routing failure behind a message
  // that could never come true.
  it("does not blame the conversation for a 404 on the first turn", async () => {
    mockPOST.mockResolvedValueOnce(relayed(404, { error: "not found" }));
    render(<TestPage projectName="acme" />);

    await send("hi");

    expect(screen.queryByText(/conversation expired/i)).not.toBeInTheDocument();
    expect(screen.getByText(/404/)).toBeInTheDocument();
  });

  // ...but a 404 on a turn that DID carry an id still means exactly that.
  it("still reports an expired conversation once an id is in play", async () => {
    mockPOST.mockResolvedValueOnce(chat("hello", "c1"));
    render(<TestPage projectName="acme" />);
    await send("hi");

    mockPOST.mockResolvedValueOnce(relayed(404, { error: "not found" }));
    await send("again");

    expect(screen.getByText(/conversation expired/i)).toBeInTheDocument();
  });

  // The typed client RETHROWS a transport failure rather than returning it,
  // and `send` is fired as `void send()`. Without a catch the rejection
  // escapes to the window: no banner, and the turn still reads as delivered.
  it("banners a transport failure instead of letting the rejection escape", async () => {
    mockPOST.mockRejectedValueOnce(new Error("Failed to fetch"));
    render(<TestPage projectName="acme" />);

    await send("hi");

    expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
    expect(screen.getByText("not delivered")).toBeInTheDocument();
  });

  // `notReachable` is a memory of one 409, not a live fact. A deploy that has
  // since finished does not retract it, so the one control offering a way out
  // has to clear it — otherwise the input is disabled for good.
  it("lets a new conversation recover from a not-reachable agent", async () => {
    mockPOST.mockResolvedValueOnce(refused(409, "no deployed gateway URL"));
    render(<TestPage projectName="acme" />);
    await send("hi");
    expect(screen.getByLabelText("Message")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));

    expect(screen.getByLabelText("Message")).not.toBeDisabled();
  });
});

describe("TestPage — switching agents", () => {
  // Two agents, because the reset only fires on a componentName CHANGE and a
  // single-agent fixture can never drive it. The old id belongs to the old
  // agent's store and would 404 against the new one.
  it("starts a fresh conversation when the user picks a different agent", async () => {
    mockComponents = [
      ...DEFAULT_COMPONENTS,
      { name: "support-agent", displayName: "Support Agent", type: "ai-agent" },
    ];
    mockDeployments = [
      ...DEFAULT_DEPLOYMENTS,
      {
        componentName: "support-agent",
        environment: "development",
        status: "Ready",
        endpointUrl: "https://support-agent.dev.example.com",
      },
    ];
    mockPOST.mockResolvedValueOnce(chat("hello", "c1"));
    render(<TestPage projectName="acme" />);
    await send("hi");
    expect(invokeCall(0).payload).not.toHaveProperty("conversationId");

    fireEvent.click(screen.getByText("Support Agent"));
    expect(screen.queryByText("hello")).not.toBeInTheDocument();

    mockPOST.mockResolvedValueOnce(chat("different agent", "c2"));
    await send("hi again");

    expect(invokeCall(1).payload).not.toHaveProperty("conversationId");
  });
});

describe("TestPage — arriving from a Deployments link", () => {
  it("opens on the agent the link named", () => {
    mockComponents = [
      ...DEFAULT_COMPONENTS,
      { name: "support-agent", displayName: "Support Agent", type: "ai-agent" },
    ];
    mockDeployments = [
      ...DEFAULT_DEPLOYMENTS,
      {
        componentName: "support-agent",
        environment: "development",
        status: "Ready",
        endpointUrl: "https://support-agent.dev.example.com",
      },
    ];

    render(<TestPage projectName="acme" component="support-agent" />);

    // The tester's own header names the agent it is talking to, so it is the
    // honest place to assert which conversation you landed in.
    expect(screen.getByText("support-agent")).toBeInTheDocument();
  });

  // A stale link (the component was renamed or removed) must not leave the page
  // blank or, worse, silently chat with a different agent than the URL named.
  it("falls back to the first agent when the named one is gone", () => {
    render(<TestPage projectName="acme" component="deleted-agent" />);

    expect(screen.getByText("booking-agent")).toBeInTheDocument();
  });
});
