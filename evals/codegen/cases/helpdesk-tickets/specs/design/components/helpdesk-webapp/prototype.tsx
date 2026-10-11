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

import { useState, type ReactNode } from "react";
import {
  Alert, AppShell, Breadcrumbs, Button, Detail, Dialog, EmptyState, Field, Filters, Form, Heading, Screen,
  Section, Stat, StatGroup, Table, Text, ValidationSummary, defineApp, useCollection, useDisplayState,
  useNav, useParams, useRole,
} from "@wso2/prototype-kit";

interface Ticket {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  requesterName: string;
  assigneeId: string;
  assigneeName: string;
  assigneeUsername?: string;
  slaDueAt: string;
  createdAt: string;
}

interface Comment { id: string; ticketId: string; authorName: string; body: string; createdAt: string }
interface Agent { id: string; displayName: string }

const NOW = "2026-01-15 12:00";
const PRIORITIES = ["low", "medium", "high", "critical"];
const CATEGORIES = ["hardware", "software", "access", "network", "other"];
const STATUSES = ["open", "triaged", "in-progress", "resolved", "reopened"];
const DUE: Record<string, string> = {
  critical: "2026-01-15 16:00",
  high: "2026-01-15 20:00",
  medium: "2026-01-16 12:00",
  low: "2026-01-18 12:00",
};

const ERIN = "Erin Wijesinghe";
const SAM: Agent = { id: "agent.sam", displayName: "Sam Fernando" };
const TARA = "Tara Silva";

const tickets: Ticket[] = [
  { id: "T-1044", title: "Outlook crashes on launch", description: "Outlook closes a few seconds after opening since the last update.", category: "software", priority: "critical", status: "open", requesterName: "Maya Fernando", assigneeId: "", assigneeName: "", slaDueAt: "2026-01-15 13:00", createdAt: "2026-01-15 09:00" },
  { id: "T-1042", title: "Laptop will not boot", description: "The laptop shows a black screen after the vendor logo.", category: "hardware", priority: "high", status: "in-progress", requesterName: ERIN, assigneeId: SAM.id, assigneeName: SAM.displayName, slaDueAt: "2026-01-15 16:00", createdAt: "2026-01-15 08:00" },
  { id: "T-1040", title: "VPN drops every hour", description: "The VPN disconnects roughly once an hour while working from home.", category: "network", priority: "medium", status: "triaged", requesterName: "Dan Perera", assigneeId: "agent.priya", assigneeName: "Priya Nair", slaDueAt: "2026-01-15 10:00", createdAt: "2026-01-14 10:00" },
  { id: "T-1038", title: "Need access to the finance share", description: "I moved to the finance team and need read access to the shared drive.", category: "access", priority: "low", status: "open", requesterName: ERIN, assigneeId: "", assigneeName: "", slaDueAt: "2026-01-17 09:00", createdAt: "2026-01-14 09:00" },
  { id: "T-1035", title: "Printer jam on floor 3", description: "The floor 3 printer reports a paper jam that cannot be cleared.", category: "hardware", priority: "low", status: "resolved", requesterName: ERIN, assigneeId: SAM.id, assigneeName: SAM.displayName, slaDueAt: "2026-01-13 12:00", createdAt: "2026-01-10 12:00" },
  { id: "T-1031", title: "Reset my SSO password", description: "The reset link from the portal says it has expired.", category: "access", priority: "high", status: "reopened", requesterName: "Dan Perera", assigneeId: SAM.id, assigneeName: SAM.displayName, slaDueAt: "2026-01-14 18:00", createdAt: "2026-01-14 10:00" },
];

const comments: Comment[] = [
  { id: "C-1", ticketId: "T-1042", authorName: ERIN, body: "It still shows a black screen after holding the power button.", createdAt: "2026-01-15 08:20" },
  { id: "C-2", ticketId: "T-1042", authorName: SAM.displayName, body: "Please send the asset tag from the bottom of the laptop.", createdAt: "2026-01-15 09:05" },
  { id: "C-3", ticketId: "T-1040", authorName: "Dan Perera", body: "It happens mostly during video calls.", createdAt: "2026-01-14 11:30" },
  { id: "C-4", ticketId: "T-1035", authorName: SAM.displayName, body: "Cleared the jam and replaced the roller.", createdAt: "2026-01-12 15:10" },
];

const agents: Agent[] = [SAM, { id: "agent.priya", displayName: "Priya Nair" }];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const label = (s: string) => cap(s.replace("-", " "));
const breached = (t: Ticket) => t.status !== "resolved" && t.slaDueAt < NOW;
const statusTone = (s: string): "default" | "info" | "success" | "warning" | "error" =>
  s === "resolved" ? "success" : s === "in-progress" ? "warning" : s === "reopened" ? "error" : "info";
const slaText = (t: Ticket) => (t.status === "resolved" ? "Met" : breached(t) ? "Breached" : "On track");
const who = (t: Ticket) => t.assigneeName || (t.assigneeUsername ? `${t.assigneeUsername} (not signed in yet)` : "Unassigned");
const unassigned = (t: Ticket) => t.assigneeId === "" && !t.assigneeUsername;

function useUser() {
  const role = useRole();
  if (role === "Employee") return { name: ERIN, email: "erin.wijesinghe@acme.example" };
  if (role === "Support Agent") return { name: SAM.displayName, email: "sam.fernando@acme.example" };
  return { name: TARA, email: "tara.silva@acme.example" };
}

function Shell({ children }: { children: ReactNode }) {
  const user = useUser();
  return (
    <AppShell
      id="shell"
      user={user}
      nav={[
        { id: "nav.my-tickets", label: "My tickets", to: "screen.my-tickets" },
        { id: "nav.new-ticket", label: "Raise a ticket", to: "screen.new-ticket" },
        { id: "nav.queue", label: "Queue", to: "screen.queue" },
      ]}
      account="screen.account"
      signOut="screen.signed-out"
    >
      {children}
    </AppShell>
  );
}

function FailedAlert() {
  const state = useDisplayState();
  if (state !== "state.failed") return null;
  return <Alert id="alert.failed" tone="error" title="Help desk unavailable" text="Tickets could not be loaded. Try again in a few minutes." />;
}

function CommentsSection({ ticketId, authorName }: { ticketId: string; authorName: string }) {
  const all = useCollection<Comment>("comments");
  const thread = all.items.filter((c) => c.ticketId === ticketId);
  return (
    <Section id="section.comments" title="Comments" count={thread.length} subtitle="Oldest first. Comments cannot be edited once posted.">
      <Table
        id="table.comments"
        columns={["Author", "Comment", "Posted"]}
        rows={thread.map((c) => ({ id: `comment.${c.id}`, cells: [c.authorName, c.body, c.createdAt] }))}
        empty={<EmptyState id="empty.comments" title="No comments yet" text="Start the conversation below." />}
      />
      <Form
        id="form.comment"
        title="Add a comment"
        onSubmit={(values) => {
          const body = values["body"];
          if (body) all.create({ ticketId, authorName, body, createdAt: NOW });
        }}
        actions={<Button id="btn.comment" label="Post comment" emphasis="primary" submit />}
      >
        <Field id="field.comment" name="body" label="Comment" type="textarea" required />
      </Form>
    </Section>
  );
}

function ticketRows(list: Ticket[], to: string, withRequester: boolean) {
  return list.map((t) => ({
    id: `ticket.${t.id}`,
    cells: withRequester
      ? [t.title, t.requesterName, cap(t.priority), who(t), t.slaDueAt, slaText(t)]
      : [t.title, cap(t.priority), who(t), t.slaDueAt, slaText(t)],
    status: { text: label(t.status), tone: statusTone(t.status) },
    to,
    params: { ticket: t.id },
  }));
}

function MyTickets() {
  const state = useDisplayState();
  const all = useCollection<Ticket>("tickets");
  const mine = state === "state.empty" ? [] : all.items.filter((t) => t.requesterName === ERIN);
  const active = mine.filter((t) => t.status !== "resolved").length;
  return (
    <Shell>
      <Heading id="heading.my-tickets" text="My tickets" />
      <FailedAlert />
      <StatGroup>
        <Stat id="stat.active" label="Active" value={String(active)} hint="tickets being worked on" icon="Ticket" tone="warning" />
        <Stat id="stat.resolved" label="Resolved" value={String(mine.length - active)} hint="tickets you can reopen" icon="CircleCheck" tone="success" />
      </StatGroup>
      <Section
        id="section.my-tickets"
        title="Your tickets"
        count={mine.length}
        subtitle="Only tickets you raised are listed."
        actions={<Button id="btn.raise" label="Raise a ticket" emphasis="primary" to="screen.new-ticket" />}
      >
        <Table
          id="table.my-tickets"
          columns={["Title", "Priority", "Assignee", "SLA due", "SLA", { label: "Status", kind: "status" }]}
          rows={ticketRows(mine, "screen.my-ticket", false)}
          empty={<EmptyState id="empty.my-tickets" title="No tickets yet" text="Raise a ticket when you need IT help." />}
        />
      </Section>
    </Shell>
  );
}

function NewTicket() {
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<Ticket>("tickets");
  const invalid = state === "state.validation-error";
  return (
    <Shell>
      <Heading id="heading.new-ticket" text="Raise a ticket" />
      <FailedAlert />
      <Breadcrumbs
        id="crumbs.new-ticket"
        items={[{ id: "crumb.my-tickets", label: "My tickets", to: "screen.my-tickets" }, { id: "crumb.new", label: "Raise a ticket" }]}
      />
      {invalid && <ValidationSummary id="summary.new-ticket" issues={["Enter a title for the ticket"]} />}
      <Form
        id="form.new-ticket"
        title="Ticket details"
        onSubmit={(values) => {
          const priority = values["priority"] ?? "medium";
          all.create({
            title: values["title"] ?? "",
            description: values["description"] ?? "",
            category: values["category"] ?? "other",
            priority,
            status: "open",
            requesterName: ERIN,
            assigneeId: "",
            assigneeName: "",
            slaDueAt: DUE[priority] ?? DUE["medium"]!,
            createdAt: NOW,
          });
          navigate.go("screen.my-tickets");
        }}
        actions={<Button id="btn.create-ticket" label="Raise ticket" emphasis="primary" submit />}
      >
        <Field id="field.title" name="title" label="Title" required error={invalid ? "Enter a title for the ticket" : undefined} />
        <Field id="field.description" name="description" label="Description" type="textarea" required />
        <Field id="field.category" name="category" label="Category" type="select" options={CATEGORIES} defaultValue="software" />
        <Field id="field.priority" name="priority" label="Priority" type="select" options={PRIORITIES} defaultValue="medium" />
      </Form>
      <Text id="text.sla-note" text="The SLA due time is calculated from the priority when you raise the ticket." />
    </Shell>
  );
}

function MyTicket() {
  const { ticket: id } = useParams();
  const state = useDisplayState();
  const all = useCollection<Ticket>("tickets");
  const mine = all.items.filter((t) => t.requesterName === ERIN);
  const ticket = (id ? all.get(id) : undefined) ?? mine[0]!;
  const [editing, setEditing] = useState(false);
  const invalid = state === "state.validation-error";
  return (
    <Shell>
      <Heading
        id="heading.my-ticket"
        text={`${ticket.id} ${ticket.title}`}
        actions={
          <>
            {ticket.status === "open" && <Button id="btn.edit" label="Edit ticket" onPress={() => setEditing(true)} />}
            {ticket.status === "resolved" && (
              <Button id="btn.reopen" label="Reopen ticket" emphasis="primary" onPress={() => all.update(ticket.id, { status: "reopened" })} />
            )}
          </>
        }
      />
      <FailedAlert />
      <Breadcrumbs
        id="crumbs.my-ticket"
        items={[{ id: "crumb.my-tickets", label: "My tickets", to: "screen.my-tickets" }, { id: "crumb.ticket", label: ticket.id }]}
      />
      {ticket.status !== "open" && ticket.status !== "resolved" && (
        <Alert id="alert.locked" tone="info" text="This ticket has been triaged, so it can no longer be edited. Add a comment to share more detail." />
      )}
      <Detail
        id="detail.my-ticket"
        fields={[
          { label: "Status", value: label(ticket.status) },
          { label: "Priority", value: cap(ticket.priority) },
          { label: "Category", value: cap(ticket.category) },
          { label: "Assignee", value: ticket.assigneeName || ticket.assigneeUsername || "Not assigned yet" },
          { label: "SLA due", value: ticket.slaDueAt },
          { label: "Raised", value: ticket.createdAt },
          { label: "Description", value: ticket.description },
        ]}
      />
      <Dialog id="dialog.edit" title={`Edit ${ticket.id}`} open={editing} onClose={() => setEditing(false)}>
        <Form
          id="form.edit"
          onSubmit={(values) => {
            const priority = values["priority"] ?? ticket.priority;
            all.update(ticket.id, {
              title: values["title"] ?? ticket.title,
              description: values["description"] ?? ticket.description,
              priority,
              slaDueAt: DUE[priority] ?? ticket.slaDueAt,
            });
            setEditing(false);
          }}
          actions={<Button id="btn.save-edit" label="Save changes" emphasis="primary" submit />}
        >
          <Field id="field.edit-title" name="title" label="Title" required defaultValue={ticket.title} error={invalid ? "Enter a title for the ticket" : undefined} />
          <Field id="field.edit-description" name="description" label="Description" type="textarea" defaultValue={ticket.description} />
          <Field id="field.edit-priority" name="priority" label="Priority" type="select" options={PRIORITIES} defaultValue={ticket.priority} />
        </Form>
      </Dialog>
      <CommentsSection ticketId={ticket.id} authorName={ERIN} />
    </Shell>
  );
}

function Queue() {
  const state = useDisplayState();
  const role = useRole();
  const all = useCollection<Ticket>("tickets");
  const [status, setStatus] = useState("All statuses");
  const [priority, setPriority] = useState("All priorities");
  const [assignee, setAssignee] = useState("Anyone");
  const [sla, setSla] = useState("All tickets");
  const pool = state === "state.empty" ? [] : all.items;
  const shown = pool
    .filter((t) => status === "All statuses" || t.status === status)
    .filter((t) => priority === "All priorities" || t.priority === priority)
    .filter((t) => assignee === "Anyone" || (assignee === "Unassigned" ? unassigned(t) : t.assigneeName === assignee))
    .filter((t) => sla === "All tickets" || breached(t))
    .sort((a, b) => (a.slaDueAt < b.slaDueAt ? -1 : 1));
  const isAgent = role === "Support Agent";
  return (
    <Shell>
      <Heading id="heading.queue" text="Queue" />
      <FailedAlert />
      <StatGroup>
        <Stat id="stat.breached" label="Breached SLA" value={String(pool.filter(breached).length)} hint="unresolved and overdue" icon="TriangleAlert" tone="error" />
        <Stat id="stat.unassigned" label="Unassigned" value={String(pool.filter(unassigned).length)} hint="tickets waiting for an owner" icon="Inbox" tone="warning" />
        <Stat id="stat.open" label="Not resolved" value={String(pool.filter((t) => t.status !== "resolved").length)} hint="tickets in the queue" icon="Ticket" />
      </StatGroup>
      <Section id="section.queue" title="All tickets" count={shown.length} subtitle="Soonest SLA due time first.">
        <Filters id="filters.queue">
          <Field id="field.filter-status" label="Status" type="select" options={["All statuses", ...STATUSES]} value={status} onChange={setStatus} />
          <Field id="field.filter-priority" label="Priority" type="select" options={["All priorities", ...PRIORITIES]} value={priority} onChange={setPriority} />
          <Field id="field.filter-assignee" label="Assignee" type="select" options={["Anyone", "Unassigned", ...agents.map((a) => a.displayName)]} value={assignee} onChange={setAssignee} />
          <Field id="field.filter-sla" label="SLA" type="select" options={["All tickets", "Breached only"]} value={sla} onChange={setSla} />
        </Filters>
        <Table
          id="table.queue"
          columns={["Title", "Requester", "Priority", "Assignee", "SLA due", "SLA", { label: "Status", kind: "status" }]}
          rows={shown.map((t) => ({
            ...ticketRows([t], "screen.ticket", true)[0]!,
            actions: isAgent && t.assigneeId !== SAM.id
              ? [{ id: `ticket.${t.id}.claim`, label: "Assign to me", onPress: () => all.update(t.id, { assigneeId: SAM.id, assigneeName: SAM.displayName, assigneeUsername: "" }) }]
              : [],
          }))}
          empty={<EmptyState id="empty.queue" title="No tickets match" text="Change the filters or wait for new tickets." />}
        />
      </Section>
    </Shell>
  );
}

function TicketDetail() {
  const { ticket: id } = useParams();
  const role = useRole();
  const state = useDisplayState();
  const all = useCollection<Ticket>("tickets");
  const ticket = (id ? all.get(id) : undefined) ?? all.items[0]!;
  const [triaging, setTriaging] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const isAgent = role === "Support Agent";
  const mine = ticket.assigneeId === SAM.id;
  const invalid = state === "state.validation-error";
  return (
    <Shell>
      <Heading
        id="heading.ticket"
        text={`${ticket.id} ${ticket.title}`}
        actions={
          <>
            {isAgent && ticket.status === "open" && <Button id="btn.triage" label="Triage" emphasis="primary" onPress={() => setTriaging(true)} />}
            {isAgent && mine && (ticket.status === "triaged" || ticket.status === "reopened") && (
              <Button id="btn.start" label="Start work" emphasis="primary" onPress={() => all.update(ticket.id, { status: "in-progress" })} />
            )}
            {isAgent && mine && ticket.status === "in-progress" && (
              <Button id="btn.resolve" label="Resolve" emphasis="primary" onPress={() => all.update(ticket.id, { status: "resolved" })} />
            )}
            {isAgent && !mine && (
              <Button id="btn.claim" label="Assign to me" onPress={() => all.update(ticket.id, { assigneeId: SAM.id, assigneeName: SAM.displayName, assigneeUsername: "" })} />
            )}
            {!isAgent && <Button id="btn.assign" label="Assign to an agent" emphasis="primary" onPress={() => setAssigning(true)} />}
          </>
        }
      />
      <FailedAlert />
      <Breadcrumbs
        id="crumbs.ticket"
        items={[{ id: "crumb.queue", label: "Queue", to: "screen.queue" }, { id: "crumb.ticket", label: ticket.id }]}
      />
      {breached(ticket) && <Alert id="alert.breached" tone="error" title="SLA breached" text={`This ticket was due ${ticket.slaDueAt} and is not resolved.`} />}
      <Detail
        id="detail.ticket"
        fields={[
          { label: "Status", value: label(ticket.status) },
          { label: "Priority", value: cap(ticket.priority) },
          { label: "Category", value: cap(ticket.category) },
          { label: "Requester", value: ticket.requesterName },
          { label: "Assignee", value: who(ticket) },
          { label: "SLA due", value: ticket.slaDueAt },
          { label: "SLA", value: slaText(ticket) },
          { label: "Description", value: ticket.description },
        ]}
      />
      <Dialog id="dialog.triage" title={`Triage ${ticket.id}`} open={triaging} onClose={() => setTriaging(false)}>
        <Form
          id="form.triage"
          onSubmit={(values) => {
            const priority = values["priority"] ?? ticket.priority;
            all.update(ticket.id, { status: "triaged", priority, slaDueAt: DUE[priority] ?? ticket.slaDueAt });
            setTriaging(false);
          }}
          actions={<Button id="btn.confirm-triage" label="Confirm triage" emphasis="primary" submit />}
        >
          <Field id="field.triage-priority" name="priority" label="Priority" type="select" options={PRIORITIES} defaultValue={ticket.priority} />
          <Text id="text.triage-note" text="Changing the priority recalculates the SLA due time." />
        </Form>
      </Dialog>
      <Dialog id="dialog.assign" title={`Assign ${ticket.id}`} open={assigning} onClose={() => setAssigning(false)}>
        <Form
          id="form.assign"
          onSubmit={(values) => {
            const typed = (values["username"] ?? "").trim();
            const agent = agents.find((a) => a.displayName === values["agent"]);
            if (typed) all.update(ticket.id, { assigneeId: "", assigneeName: "", assigneeUsername: typed });
            else if (agent) all.update(ticket.id, { assigneeId: agent.id, assigneeName: agent.displayName, assigneeUsername: "" });
            else return;
            setAssigning(false);
          }}
          actions={<Button id="btn.confirm-assign" label="Assign" emphasis="primary" submit />}
        >
          <Field
            id="field.agent"
            name="agent"
            label="Known support agent"
            type="select"
            options={["Pick a known agent", ...agents.map((a) => a.displayName)]}
            defaultValue="Pick a known agent"
          />
          <Field
            id="field.username"
            name="username"
            label="Or type a username"
            placeholder="priya.nair"
            error={invalid ? "Pick an agent or type a username" : undefined}
          />
          <Text id="text.assign-note" text="A username the help desk has not seen yet is accepted and binds to that person on their first sign-in." />
        </Form>
      </Dialog>
      <CommentsSection ticketId={ticket.id} authorName={isAgent ? SAM.displayName : TARA} />
    </Shell>
  );
}

function Account() {
  const user = useUser();
  const role = useRole();
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail id="detail.account" fields={[{ label: "Name", value: user.name }, { label: "Email", value: user.email }, { label: "Role", value: role }]} />
    </Shell>
  );
}


function SignedOut() {
  const role = useRole();
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to={role === "Employee" ? "screen.my-tickets" : "screen.queue"} />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.my-tickets": MyTickets,
    "screen.new-ticket": NewTicket,
    "screen.my-ticket": MyTicket,
    "screen.queue": Queue,
    "screen.ticket": TicketDetail,
    "screen.account": Account,
    "screen.signed-out": SignedOut,
  },
  data: { tickets, comments, agents },
});
