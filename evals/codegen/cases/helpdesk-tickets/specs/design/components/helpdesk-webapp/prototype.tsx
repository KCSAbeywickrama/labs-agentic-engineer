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
  Alert, AppShell, Badge, Breadcrumbs, Button, Detail, EmptyState, Field, Filters, Form, Heading, Screen,
  Section, Stack, Stat, StatGroup, Table, Timeline, ValidationSummary, defineApp, useCollection,
  useDisplayState, useNav, useParams, useRole, type Tone,
} from "@wso2/prototype-kit";

interface Ticket {
  id: string; title: string; description: string; status: string; priority: string;
  requester: string; assignee: string; slaDue: string; slaBreached: string;
}
interface Comment { id: string; ticketId: string; author: string; body: string; when: string }

const tickets: Ticket[] = [
  { id: "1042", title: "VPN not connecting", description: "Cannot connect to the VPN from home since this morning.", status: "In progress", priority: "High", requester: "Ana Diaz", assignee: "Sam Ortiz", slaDue: "Jan 15, 17:00", slaBreached: "no" },
  { id: "1040", title: "Cannot print", description: "The third-floor printer rejects every job.", status: "Reopened", priority: "Medium", requester: "Omar Reyes", assignee: "Priya Nair", slaDue: "Jan 14, 11:00", slaBreached: "yes" },
  { id: "1037", title: "Reset email password", description: "Locked out of my mailbox after the password policy change.", status: "Resolved", priority: "Medium", requester: "Ana Diaz", assignee: "Sam Ortiz", slaDue: "Jan 13, 16:00", slaBreached: "no" },
  { id: "1036", title: "Request monitor stand", description: "Need an adjustable stand for my second monitor.", status: "Triaged", priority: "Low", requester: "Ana Diaz", assignee: "", slaDue: "Jan 18, 09:00", slaBreached: "no" },
  { id: "1035", title: "Laptop battery swelling", description: "The battery is bulging and the trackpad lifts.", status: "Open", priority: "Critical", requester: "Lee Chan", assignee: "", slaDue: "Jan 15, 10:00", slaBreached: "yes" },
  { id: "1034", title: "Replace keyboard", description: "Several keys no longer register.", status: "Open", priority: "Low", requester: "Lee Chan", assignee: "", slaDue: "Jan 18, 09:00", slaBreached: "no" },
];

const comments: Comment[] = [
  { id: "c1", ticketId: "1042", author: "Ana Diaz", body: "Cannot connect to the VPN.", when: "Jan 15, 08:40" },
  { id: "c2", ticketId: "1042", author: "Sam Ortiz", body: "Please restart the client.", when: "Jan 15, 09:05" },
  { id: "c3", ticketId: "1042", author: "Ana Diaz", body: "Done, still failing.", when: "Jan 15, 09:30" },
  { id: "c4", ticketId: "1040", author: "Omar Reyes", body: "Still not printing.", when: "Jan 14, 15:00" },
  { id: "c5", ticketId: "1040", author: "Priya Nair", body: "Looking at it again.", when: "Jan 14, 15:20" },
];

const agents = ["Sam Ortiz", "Priya Nair", "Tara Boyd"];
const priorities = ["Low", "Medium", "High", "Critical"];
const statuses = ["Open", "Triaged", "In progress", "Resolved", "Reopened"];

const users: Record<string, { name: string; email: string }> = {
  Employee: { name: "Ana Diaz", email: "ana.diaz@acme.example" },
  "Support Agent": { name: "Sam Ortiz", email: "sam.ortiz@acme.example" },
  "Team Lead": { name: "Tara Boyd", email: "tara.boyd@acme.example" },
};

function statusTone(s: string): Tone {
  if (s === "Resolved") return "success";
  if (s === "In progress" || s === "Triaged") return "info";
  if (s === "Reopened") return "warning";
  return "default";
}
function priorityTone(p: string): Tone {
  if (p === "Critical") return "error";
  if (p === "High") return "warning";
  return "default";
}
function pick(items: readonly Ticket[], id: string | undefined, fallback: readonly Ticket[]): Ticket {
  return (id ? items.find((t) => t.id === id) : undefined) ?? fallback[0] ?? items[0]!;
}

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  const user = users[role] ?? users["Employee"]!;
  return (
    <AppShell
      id="shell"
      user={user}
      nav={[
        { id: "nav.my-tickets", label: "My tickets", to: "screen.my-tickets" },
        { id: "nav.new-ticket", label: "New ticket", to: "screen.new-ticket" },
        { id: "nav.queue", label: "Queue", to: "screen.queue" },
        { id: "nav.team-queue", label: "Team queue", to: "screen.team-queue" },
      ]}
      account="screen.account"
      settings="screen.settings"
      signOut="screen.signed-out"
    >
      {children}
    </AppShell>
  );
}

function CommentsSection({ ticketId, author, canComment }: { ticketId: string; author: string; canComment: boolean }) {
  const all = useCollection<Comment>("comments");
  const state = useDisplayState();
  const thread = state === "state.empty" ? [] : all.items.filter((c) => c.ticketId === ticketId);
  return (
    <Section id="section.comments" title="Comments" count={thread.length} subtitle="Visible to the requester and the support team.">
      {thread.length === 0 ? (
        <EmptyState id="empty.comments" title="No comments yet" text="Comments on this ticket appear here." />
      ) : (
        <Timeline id="timeline.comments" entries={[...thread].reverse().map((c) => ({ when: c.when, who: c.author, text: c.body }))} />
      )}
      {canComment && (
        <Form
          id="form.comment"
          onSubmit={(values) => {
            all.create({ ticketId, author, body: values["body"] ?? "", when: "Jan 15, 10:15" });
          }}
          actions={<Button id="btn.add-comment" label="Add comment" emphasis="primary" submit />}
        >
          <Field id="field.comment" name="body" label="Write a comment" type="textarea" required />
        </Form>
      )}
    </Section>
  );
}

function TicketSummary({ ticket }: { ticket: Ticket }) {
  return (
    <Section id="section.ticket" title="Ticket">
      <Stack direction="row">
        <Badge id="badge.status" label={ticket.status} tone={statusTone(ticket.status)} />
        <Badge id="badge.priority" label={ticket.priority} tone={priorityTone(ticket.priority)} />
        {ticket.slaBreached === "yes" && <Badge id="badge.breached" label="SLA breached" tone="error" />}
      </Stack>
      <Detail
        id="detail.ticket"
        fields={[
          { label: "Requester", value: ticket.requester },
          { label: "Assignee", value: ticket.assignee || "Unassigned" },
          { label: "SLA due", value: ticket.slaDue },
          { label: "Description", value: ticket.description },
        ]}
      />
    </Section>
  );
}

function MyTickets() {
  const state = useDisplayState();
  const all = useCollection<Ticket>("tickets");
  const mine = state === "state.empty" ? [] : all.items.filter((t) => t.requester === "Ana Diaz");
  const active = mine.filter((t) => t.status !== "Resolved").length;
  return (
    <Shell>
      <Heading id="heading.my-tickets" text="My tickets" />
      {state === "state.failed" && (
        <Alert id="alert.failed" tone="error" title="Tickets unavailable" text="We could not load your tickets. Try again in a few minutes." />
      )}
      <StatGroup>
        <Stat id="stat.active" label="Active" value={String(active)} hint="tickets being handled" icon="Inbox" tone="warning" />
        <Stat id="stat.resolved" label="Resolved" value={String(mine.length - active)} hint="you can reopen these" icon="CircleCheck" tone="success" />
      </StatGroup>
      <Section
        id="section.tickets"
        title="Your tickets"
        count={mine.length}
        subtitle="Status and SLA due time for each request."
        actions={<Button id="btn.new-ticket" label="New ticket" emphasis="primary" to="screen.new-ticket" />}
      >
        <Table
          id="table.tickets"
          columns={["Title", { label: "Status", kind: "status" }, "Priority", "SLA due"]}
          rows={mine.map((t) => ({
            id: `ticket.${t.id}`,
            cells: [t.title, t.priority, t.slaDue],
            status: { text: t.status, tone: statusTone(t.status) },
            to: "screen.my-ticket",
            params: { ticket: t.id },
          }))}
          empty={<EmptyState id="empty.tickets" title="No tickets yet" text="Raise a ticket and it will appear here." />}
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
      <Heading id="heading.new-ticket" text="New ticket" />
      {state === "state.failed" && (
        <Alert id="alert.failed" tone="error" title="Ticket not saved" text="The help desk could not save your ticket. Try submitting again." />
      )}
      {invalid && <ValidationSummary id="summary.new-ticket" issues={["Enter a title", "Describe the problem"]} />}
      <Form
        id="form.new-ticket"
        title="Describe your problem"
        onSubmit={(values) => {
          const id = all.create({
            title: values["title"] ?? "",
            description: values["description"] ?? "",
            status: "Open",
            priority: values["priority"] ?? "Medium",
            requester: "Ana Diaz",
            assignee: "",
            slaDue: "Jan 18, 09:00",
            slaBreached: "no",
          });
          navigate.go("screen.my-ticket", { ticket: id });
        }}
        actions={
          <Stack direction="row">
            <Button id="btn.cancel" label="Cancel" to="screen.my-tickets" />
            <Button id="btn.submit-ticket" label="Submit ticket" emphasis="primary" submit />
          </Stack>
        }
      >
        <Field id="field.title" name="title" label="Title" required error={invalid ? "Enter a title" : undefined} />
        <Field id="field.description" name="description" label="Describe the problem" type="textarea" required error={invalid ? "Describe the problem" : undefined} />
        <Field id="field.priority" name="priority" label="Priority" type="select" options={priorities} defaultValue="Medium" />
      </Form>
    </Shell>
  );
}

function MyTicket() {
  const { ticket: id } = useParams();
  const state = useDisplayState();
  const all = useCollection<Ticket>("tickets");
  const mine = all.items.filter((t) => t.requester === "Ana Diaz");
  const ticket = pick(mine, id, mine);
  return (
    <Shell>
      <Breadcrumbs
        id="crumbs.my-ticket"
        items={[
          { id: "crumb.list", label: "My tickets", to: "screen.my-tickets" },
          { id: "crumb.current", label: ticket.title },
        ]}
      />
      <Heading
        id="heading.my-ticket"
        text={ticket.title}
        actions={
          <Button
            id="btn.reopen"
            label="Reopen ticket"
            disabled={ticket.status !== "Resolved"}
            onPress={() => all.update(ticket.id, { status: "Reopened" })}
          />
        }
      />
      {state === "state.failed" && (
        <Alert id="alert.failed" tone="error" title="Ticket unavailable" text="We could not refresh this ticket. Try again shortly." />
      )}
      <TicketSummary ticket={ticket} />
      <CommentsSection ticketId={ticket.id} author="Ana Diaz" canComment />
    </Shell>
  );
}

function QueueBody({ detail, title }: { detail: string; title: string }) {
  const state = useDisplayState();
  const all = useCollection<Ticket>("tickets");
  const [status, setStatus] = useState("All");
  const [priority, setPriority] = useState("All");
  const [assignee, setAssignee] = useState("All");
  const [breachedOnly, setBreachedOnly] = useState("off");
  const base = state === "state.empty" ? [] : all.items;
  const rows = base.filter(
    (t) =>
      (status === "All" || t.status === status) &&
      (priority === "All" || t.priority === priority) &&
      (assignee === "All" || (assignee === "Unassigned" ? t.assignee === "" : t.assignee === assignee)) &&
      (breachedOnly === "off" || t.slaBreached === "yes"),
  );
  return (
    <>
      <Heading id="heading.queue" text={title} />
      {state === "state.failed" && (
        <Alert id="alert.failed" tone="error" title="Queue unavailable" text="The ticket list could not be loaded. Figures may be stale; try again in a few minutes." />
      )}
      <StatGroup>
        <Stat id="stat.open" label="Open" value={String(base.filter((t) => t.status === "Open").length)} hint="tickets waiting" icon="Inbox" />
        <Stat id="stat.in-progress" label="In progress" value={String(base.filter((t) => t.status === "In progress").length)} hint="being worked" icon="Hourglass" tone="warning" />
        <Stat id="stat.breached" label="SLA breached" value={String(base.filter((t) => t.slaBreached === "yes").length)} hint="need attention" icon="TriangleAlert" tone="error" />
      </StatGroup>
      <Section id="section.queue" title="Tickets" count={rows.length} subtitle="Filter by status, priority, assignee or SLA breach.">
        <Filters id="filters.queue">
          <Field id="field.filter-status" label="Status" type="select" options={["All", ...statuses]} value={status} onChange={setStatus} />
          <Field id="field.filter-priority" label="Priority" type="select" options={["All", ...priorities]} value={priority} onChange={setPriority} />
          <Field id="field.filter-assignee" label="Assignee" type="select" options={["All", "Unassigned", ...agents]} value={assignee} onChange={setAssignee} />
          <Field id="field.filter-breached" label="SLA breached only" type="switch" value={breachedOnly} onChange={setBreachedOnly} />
        </Filters>
        <Table
          id="table.queue"
          columns={["Title", "Requester", { label: "Status", kind: "status" }, "Priority", "Assignee", "SLA due"]}
          rows={rows.map((t) => ({
            id: `ticket.${t.id}`,
            cells: [t.title, t.requester, t.priority, t.assignee || "Unassigned", t.slaBreached === "yes" ? `${t.slaDue} (overdue)` : t.slaDue],
            status: { text: t.status, tone: statusTone(t.status) },
            to: detail,
            params: { ticket: t.id },
          }))}
          empty={<EmptyState id="empty.queue" title="No tickets match" text="Change the filters or check back later." />}
        />
      </Section>
    </>
  );
}

function Queue() {
  return (
    <Shell>
      <QueueBody detail="screen.ticket-work" title="Ticket queue" />
    </Shell>
  );
}

function TicketWork() {
  const { ticket: id } = useParams();
  const state = useDisplayState();
  const all = useCollection<Ticket>("tickets");
  const ticket = pick(all.items, id, all.items);
  const [priority, setPriority] = useState(ticket.priority);
  const canTriage = ticket.status === "Open" || ticket.status === "Reopened";
  return (
    <Shell>
      <Breadcrumbs
        id="crumbs.ticket-work"
        items={[
          { id: "crumb.queue", label: "Queue", to: "screen.queue" },
          { id: "crumb.current", label: ticket.title },
        ]}
      />
      <Heading
        id="heading.ticket-work"
        text={ticket.title}
        actions={<Button id="btn.assign" label="Assign" emphasis="primary" to="screen.assign" params={{ ticket: ticket.id }} />}
      />
      {state === "state.failed" && (
        <Alert id="alert.failed" tone="error" title="Update failed" text="The change was not saved. Reload the ticket and try again." />
      )}
      <TicketSummary ticket={ticket} />
      <Section id="section.work" title="Work" subtitle="Triage, then start work and resolve.">
        <Field id="field.priority" label="Priority" type="select" options={priorities} value={priority} onChange={setPriority} />
        <Stack direction="row">
          <Button id="btn.triage" label="Triage" disabled={!canTriage} onPress={() => all.update(ticket.id, { priority, status: "Triaged" })} />
          <Button id="btn.start" label="Start work" disabled={ticket.status !== "Triaged" && ticket.status !== "Reopened"} onPress={() => all.update(ticket.id, { status: "In progress" })} />
          <Button id="btn.resolve" label="Resolve" disabled={ticket.status !== "In progress"} onPress={() => all.update(ticket.id, { status: "Resolved", slaBreached: "no" })} />
        </Stack>
      </Section>
      <CommentsSection ticketId={ticket.id} author="Sam Ortiz" canComment />
    </Shell>
  );
}

function AssignBody({ back, title }: { back: string; title: string }) {
  const { ticket: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<Ticket>("tickets");
  const ticket = pick(all.items, id, all.items);
  const invalid = state === "state.validation-error";
  return (
    <>
      <Heading id="heading.assign" text={title} />
      {state === "state.failed" && (
        <Alert id="alert.failed" tone="error" title="Agents unavailable" text="The list of agents could not be loaded. Try again shortly." />
      )}
      {invalid && <ValidationSummary id="summary.assign" issues={["Choose an agent"]} />}
      <Form
        id="form.assign"
        title={ticket.title}
        onSubmit={(values) => {
          all.update(ticket.id, { assignee: values["agent"] ?? "" });
          navigate.go(back, { ticket: ticket.id });
        }}
        actions={
          <Stack direction="row">
            <Button id="btn.cancel" label="Cancel" to={back} params={{ ticket: ticket.id }} />
            <Button id="btn.confirm-assign" label="Assign" emphasis="primary" submit />
          </Stack>
        }
      >
        <Field id="field.agent" name="agent" label="Support agent" type="select" options={agents} defaultValue={ticket.assignee || agents[0]} required error={invalid ? "Choose an agent" : undefined} />
      </Form>
    </>
  );
}

function Assign() {
  return (
    <Shell>
      <AssignBody back="screen.ticket-work" title="Assign ticket" />
    </Shell>
  );
}

function TeamQueue() {
  return (
    <Shell>
      <QueueBody detail="screen.lead-ticket" title="Team queue" />
    </Shell>
  );
}

function LeadTicket() {
  const { ticket: id } = useParams();
  const all = useCollection<Ticket>("tickets");
  const ticket = pick(all.items, id, all.items);
  return (
    <Shell>
      <Breadcrumbs
        id="crumbs.lead-ticket"
        items={[
          { id: "crumb.queue", label: "Team queue", to: "screen.team-queue" },
          { id: "crumb.current", label: ticket.title },
        ]}
      />
      <Heading
        id="heading.lead-ticket"
        text={ticket.title}
        actions={<Button id="btn.reassign" label="Reassign" emphasis="primary" to="screen.reassign" params={{ ticket: ticket.id }} />}
      />
      <TicketSummary ticket={ticket} />
      <CommentsSection ticketId={ticket.id} author="Tara Boyd" canComment={false} />
    </Shell>
  );
}

function Reassign() {
  return (
    <Shell>
      <AssignBody back="screen.lead-ticket" title="Reassign ticket" />
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const user = users[role] ?? users["Employee"]!;
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail id="detail.account" fields={[{ label: "Name", value: user.name }, { label: "Email", value: user.email }, { label: "Role", value: role }]} />
    </Shell>
  );
}

function Settings() {
  const navigate = useNav();
  return (
    <Shell>
      <Heading id="heading.settings" text="Settings" />
      <Form
        id="form.settings"
        onSubmit={() => navigate.go("screen.account")}
        actions={<Button id="btn.save-settings" label="Save settings" emphasis="primary" submit />}
      >
        <Field id="field.compact" label="Compact tables" type="switch" defaultValue="off" />
      </Form>
    </Shell>
  );
}

function SignedOut() {
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to="screen.account" />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.my-tickets": MyTickets,
    "screen.new-ticket": NewTicket,
    "screen.my-ticket": MyTicket,
    "screen.queue": Queue,
    "screen.ticket-work": TicketWork,
    "screen.assign": Assign,
    "screen.team-queue": TeamQueue,
    "screen.lead-ticket": LeadTicket,
    "screen.reassign": Reassign,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { tickets, comments },
});
