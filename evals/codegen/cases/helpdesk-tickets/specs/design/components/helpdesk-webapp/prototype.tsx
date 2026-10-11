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
  Alert, AppShell, Breadcrumbs, Button, Detail, Dialog, EmptyState, Field, Filters, Form,
  Heading, Screen, Section, Stat, StatGroup, Table, Timeline, ValidationSummary,
  defineApp, useCollection, useDisplayState, useParams, useRole, useToday,
} from "@wso2/prototype-kit";

interface Ticket {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  requesterId: string;
  requesterName: string;
  assigneeId?: string;
  assigneeName?: string;
  slaDueAt: string;
  slaBreached: boolean;
  createdAt: string;
  resolvedAt?: string;
}

interface Comment {
  id: string;
  ticketId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

const tickets: Ticket[] = [
  { id: "ticket.1042", title: "VPN not connecting", description: "Cannot connect to the office VPN from home.", status: "open", priority: "high", requesterId: "ana", requesterName: "Ana Fernando", slaDueAt: "2026-01-15 18:00", slaBreached: false, createdAt: "2026-01-15 08:00" },
  { id: "ticket.1038", title: "Replace keyboard", description: "Several keys have stopped responding.", status: "triaged", priority: "high", requesterId: "ana", requesterName: "Ana Fernando", assigneeId: "sam", assigneeName: "Sam Perera", slaDueAt: "2026-01-14 09:00", slaBreached: false, createdAt: "2026-01-13 09:00" },
  { id: "ticket.1031", title: "Cannot print", description: "The 3rd floor printer is not reachable.", status: "in_progress", priority: "medium", requesterId: "lee", requesterName: "Lee Carvalho", assigneeId: "priya", assigneeName: "Priya Gunasekara", slaDueAt: "2026-01-16 17:00", slaBreached: false, createdAt: "2026-01-12 11:00" },
  { id: "ticket.1020", title: "Email sync failing", description: "Mail stopped syncing on mobile overnight.", status: "resolved", priority: "critical", requesterId: "lee", requesterName: "Lee Carvalho", assigneeId: "sam", assigneeName: "Sam Perera", slaDueAt: "2026-01-10 08:00", slaBreached: false, createdAt: "2026-01-10 04:00", resolvedAt: "2026-01-10 07:30" },
  { id: "ticket.1045", title: "Monitor flickering", description: "External monitor flickers intermittently.", status: "reopened", priority: "low", requesterId: "ana", requesterName: "Ana Fernando", assigneeId: "priya", assigneeName: "Priya Gunasekara", slaDueAt: "2026-01-18 17:00", slaBreached: false, createdAt: "2026-01-12 09:00" },
  { id: "ticket.1050", title: "Password reset needed", description: "Locked out of the HR portal.", status: "open", priority: "critical", requesterId: "lee", requesterName: "Lee Carvalho", slaDueAt: "2026-01-14 06:00", slaBreached: true, createdAt: "2026-01-14 04:00" },
];

const comments: Comment[] = [
  { id: "comment.1", ticketId: "ticket.1042", authorId: "ana", authorName: "Ana Fernando", body: "Still failing after restart.", createdAt: "2026-01-15 08:30" },
  { id: "comment.2", ticketId: "ticket.1038", authorId: "sam", authorName: "Sam Perera", body: "Ordering a replacement keyboard.", createdAt: "2026-01-13 10:00" },
  { id: "comment.3", ticketId: "ticket.1031", authorId: "priya", authorName: "Priya Gunasekara", body: "Checking the printer's network cable now.", createdAt: "2026-01-12 11:30" },
];

const agents = [
  { id: "sam", name: "Sam Perera" },
  { id: "priya", name: "Priya Gunasekara" },
  { id: "ravi", name: "Ravi Jayasuriya" },
];

const currentEmployeeId = "ana";

const users = {
  Employee: { name: "Ana Fernando", email: "ana.fernando@acme.example" },
  "Support Agent": { name: "Sam Perera", email: "sam.perera@acme.example" },
  "Team Lead": { name: "Tara De Silva", email: "tara.desilva@acme.example" },
} as const;

function statusTone(status: string): "default" | "info" | "success" | "warning" | "error" {
  if (status === "resolved") return "success";
  if (status === "in_progress") return "info";
  if (status === "reopened") return "error";
  if (status === "triaged") return "default";
  return "warning";
}

function statusLabel(status: string): string {
  return status.replace("_", " ");
}

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  const nav =
    role === "Employee"
      ? [{ id: "nav.my-tickets", label: "My tickets", to: "screen.my-tickets" }]
      : [{ id: "nav.queue", label: "Queue", to: "screen.queue" }];
  const person = users[role as keyof typeof users];
  return (
    <AppShell
      id="shell"
      user={{ name: person.name, email: person.email, role }}
      nav={nav}
      account="screen.account"
      settings="screen.settings"
      signOut="screen.signed-out"
    >
      {children}
    </AppShell>
  );
}

function MyTickets() {
  const state = useDisplayState();
  const all = useCollection<Ticket>("tickets");
  const today = useToday();
  const [raising, setRaising] = useState(false);
  const mine = state === "state.empty" ? [] : all.items.filter((t) => t.requesterId === currentEmployeeId);
  return (
    <Shell>
      <Heading
        id="heading.my-tickets"
        text="My tickets"
        actions={<Button id="btn.raise" label="Raise ticket" emphasis="primary" onPress={() => setRaising(true)} />}
      />
      <Section id="section.my-tickets" title="My tickets" count={mine.length} subtitle="Tickets you have raised, newest first.">
        <Table
          id="table.my-tickets"
          columns={["Title", "Priority", { label: "Status", kind: "status" }, "SLA due"]}
          rows={mine.map((t) => ({
            id: `row.${t.id}`,
            cells: [t.title, t.priority, t.slaDueAt],
            status: { text: statusLabel(t.status), tone: statusTone(t.status) },
            to: "screen.ticket",
            params: { ticket: t.id },
          }))}
          empty={
            <EmptyState
              id="empty.my-tickets"
              title="No tickets yet"
              text="Raise a ticket to get IT's help."
              actions={<Button id="btn.raise-empty" label="Raise ticket" emphasis="primary" onPress={() => setRaising(true)} />}
            />
          }
        />
      </Section>
      <Dialog id="dialog.raise" title="Raise a ticket" open={raising} onClose={() => setRaising(false)}>
        <Form
          id="form.raise"
          onSubmit={(values) => {
            all.create({
              title: values.title,
              description: values.description,
              status: "open",
              priority: values.priority,
              requesterId: currentEmployeeId,
              requesterName: "Ana Fernando",
              slaDueAt: "2026-01-16 17:00",
              slaBreached: false,
              createdAt: today,
            });
            setRaising(false);
          }}
          actions={<Button id="btn.raise.submit" label="Raise" emphasis="primary" submit />}
        >
          {state === "state.validation-error" && (
            <ValidationSummary id="validation.raise" issues={["Title is required", "Description is required"]} />
          )}
          <Field
            id="field.title"
            name="title"
            label="Title"
            required
            error={state === "state.validation-error" ? "Give the ticket a title" : undefined}
          />
          <Field
            id="field.description"
            name="description"
            label="Description"
            type="textarea"
            required
            error={state === "state.validation-error" ? "Describe the problem" : undefined}
          />
          <Field
            id="field.priority"
            name="priority"
            label="Priority"
            type="select"
            options={["low", "medium", "high", "critical"]}
            defaultValue="medium"
            required
          />
        </Form>
      </Dialog>
    </Shell>
  );
}

function TicketDetail() {
  const { ticket: id } = useParams();
  const state = useDisplayState();
  const all = useCollection<Ticket>("tickets");
  const allComments = useCollection<Comment>("comments");
  const today = useToday();
  const [reopening, setReopening] = useState(false);
  const mine = all.items.filter((t) => t.requesterId === currentEmployeeId);
  const ticket = (id ? all.get(id) : undefined) ?? mine[0]!;
  const thread = allComments.items.filter((c) => c.ticketId === ticket.id);
  return (
    <Shell>
      <Breadcrumbs
        id="breadcrumbs.ticket"
        items={[
          { id: "crumb.my-tickets", label: "My tickets", to: "screen.my-tickets" },
          { id: "crumb.ticket", label: ticket.title },
        ]}
      />
      <Heading id="heading.ticket" text={ticket.title} />
      {state === "state.failed" && (
        <Alert id="alert.ticket-failed" tone="error" title="Couldn't refresh this ticket" text="Showing the last known details." />
      )}
      <Detail
        id="detail.ticket"
        fields={[
          { label: "Description", value: ticket.description },
          { label: "Status", value: statusLabel(ticket.status) },
          { label: "Priority", value: ticket.priority },
          { label: "Assignee", value: ticket.assigneeName ?? "Unassigned" },
          { label: "SLA due", value: ticket.slaDueAt },
        ]}
      />
      {ticket.status === "resolved" && (
        <Button id="btn.reopen" label="Reopen" emphasis="primary" onPress={() => setReopening(true)} />
      )}
      <Dialog id="dialog.reopen" title={`Reopen ${ticket.title}`} open={reopening} onClose={() => setReopening(false)}>
        <Form
          id="form.reopen"
          onSubmit={() => {
            all.update(ticket.id, { status: "reopened" });
            setReopening(false);
          }}
          actions={<Button id="btn.reopen.confirm" label="Reopen" emphasis="primary" submit />}
        >
          <Field id="field.reopen-note" name="note" label="Why does this need more work?" type="textarea" />
        </Form>
      </Dialog>
      <Section
        id="section.comments"
        title="Comments"
        count={thread.length}
        subtitle="Visible to you and whoever works this ticket."
      >
        <Timeline
          id="timeline.comments"
          entries={thread.map((c) => ({ when: c.createdAt, who: c.authorName, text: c.body }))}
        />
        <Form
          id="form.comment"
          onSubmit={(values) => {
            allComments.create({ ticketId: ticket.id, authorId: currentEmployeeId, authorName: "Ana Fernando", body: values.body, createdAt: today });
          }}
          actions={<Button id="btn.comment.submit" label="Add comment" emphasis="primary" submit />}
        >
          <Field
            id="field.comment"
            name="body"
            label="Add a comment"
            type="textarea"
            required
            error={state === "state.validation-error" ? "Say something before posting" : undefined}
          />
        </Form>
      </Section>
    </Shell>
  );
}

function Queue() {
  const state = useDisplayState();
  const all = useCollection<Ticket>("tickets");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [onlyBreached, setOnlyBreached] = useState(false);
  const everything = state === "state.empty" ? [] : all.items;
  const filtered = everything.filter(
    (t) =>
      (status === "all" || t.status === status) &&
      (priority === "all" || t.priority === priority) &&
      (assignee === "all" || t.assigneeName === assignee) &&
      (!onlyBreached || t.slaBreached)
  );
  const breachedCount = everything.filter((t) => t.slaBreached).length;
  return (
    <Shell>
      <Heading id="heading.queue" text="Ticket queue" />
      {state === "state.failed" && (
        <Alert id="alert.queue-failed" tone="error" title="Ticket feed unavailable" text="Refresh in a few minutes; figures may be stale." />
      )}
      <StatGroup>
        <Stat id="stat.open" label="Open" value={String(everything.filter((t) => t.status === "open").length)} hint="awaiting triage" icon="Inbox" tone="warning" />
        <Stat id="stat.breached" label="SLA breaches" value={String(breachedCount)} hint="past their due time" icon="TriangleAlert" tone="error" />
      </StatGroup>
      <Section id="section.queue" title="Tickets" count={filtered.length} subtitle="Every ticket raised across the organization.">
        <Filters id="filters.queue">
          <Field id="field.status" label="Status" type="select" options={["all", "open", "triaged", "in_progress", "resolved", "reopened"]} value={status} onChange={setStatus} />
          <Field id="field.priority" label="Priority" type="select" options={["all", "low", "medium", "high", "critical"]} value={priority} onChange={setPriority} />
          <Field id="field.assignee" label="Assignee" type="select" options={["all", ...agents.map((a) => a.name)]} value={assignee} onChange={setAssignee} />
          <Field id="field.breached" label="SLA breaches only" type="switch" value={onlyBreached ? "on" : "off"} onChange={(v) => setOnlyBreached(v === "on")} />
        </Filters>
        <Table
          id="table.queue"
          columns={["Title", "Priority", { label: "Status", kind: "status" }, "Assignee", "SLA due"]}
          rows={filtered.map((t) => ({
            id: `row.${t.id}`,
            cells: [t.title, t.priority, t.assigneeName ?? "Unassigned", t.slaDueAt],
            status: { text: t.slaBreached ? "Breached" : statusLabel(t.status), tone: t.slaBreached ? "error" : statusTone(t.status) },
            to: "screen.ticket-workspace",
            params: { ticket: t.id },
          }))}
          empty={<EmptyState id="empty.queue" title="Nothing matches these filters" text="Clear a filter to see more tickets." />}
        />
      </Section>
    </Shell>
  );
}

function TicketWorkspace() {
  const { ticket: id } = useParams();
  const state = useDisplayState();
  const role = useRole();
  const all = useCollection<Ticket>("tickets");
  const allComments = useCollection<Comment>("comments");
  const today = useToday();
  const [assigning, setAssigning] = useState(false);
  const ticket = (id ? all.get(id) : undefined) ?? all.items[0]!;
  const thread = allComments.items.filter((c) => c.ticketId === ticket.id);
  const actorName = role === "Support Agent" ? "Sam Perera" : "Tara De Silva";
  const actorId = role === "Support Agent" ? "sam" : "tara";
  return (
    <Shell>
      <Breadcrumbs
        id="breadcrumbs.workspace"
        items={[
          { id: "crumb.queue", label: "Queue", to: "screen.queue" },
          { id: "crumb.workspace", label: ticket.title },
        ]}
      />
      <Heading id="heading.workspace" text={ticket.title} />
      <Detail
        id="detail.workspace"
        fields={[
          { label: "Description", value: ticket.description },
          { label: "Requester", value: ticket.requesterName },
          { label: "Status", value: statusLabel(ticket.status) },
          { label: "Priority", value: ticket.priority },
          { label: "Assignee", value: ticket.assigneeName ?? "Unassigned" },
          { label: "SLA due", value: ticket.slaDueAt },
        ]}
      />
      <Button id="btn.assign" label={ticket.assigneeId ? "Reassign" : "Assign"} onPress={() => setAssigning(true)} />
      {role === "Support Agent" && ticket.status !== "resolved" && (
        <Form
          id="form.triage"
          title="Triage"
          onSubmit={(values) =>
            all.update(ticket.id, {
              priority: values.priority,
              status: ticket.status === "open" || ticket.status === "reopened" ? "triaged" : ticket.status,
            })
          }
          actions={<Button id="btn.triage.submit" label="Save triage" submit />}
        >
          <Field
            id="field.triage-priority"
            name="priority"
            label="Priority"
            type="select"
            options={["low", "medium", "high", "critical"]}
            defaultValue={ticket.priority}
            required
          />
        </Form>
      )}
      {role === "Support Agent" && ticket.status === "triaged" && (
        <Button id="btn.start" label="Start" onPress={() => all.update(ticket.id, { status: "in_progress" })} />
      )}
      {role === "Support Agent" && ticket.status === "in_progress" && (
        <Button id="btn.resolve" label="Resolve" emphasis="primary" onPress={() => all.update(ticket.id, { status: "resolved", resolvedAt: today })} />
      )}
      <Dialog id="dialog.assign" title={`Assign ${ticket.title}`} open={assigning} onClose={() => setAssigning(false)}>
        <Form
          id="form.assign"
          onSubmit={(values) => {
            const agent = agents.find((a) => a.name === values.assignee);
            all.update(ticket.id, { assigneeId: agent?.id, assigneeName: agent?.name });
            setAssigning(false);
          }}
          actions={<Button id="btn.assign.submit" label="Assign" emphasis="primary" submit />}
        >
          <Field
            id="field.assignee"
            name="assignee"
            label="Agent"
            type="select"
            options={agents.map((a) => a.name)}
            defaultValue={ticket.assigneeName ?? agents[0]!.name}
            required
          />
        </Form>
      </Dialog>
      <Section
        id="section.workspace-comments"
        title="Comments"
        count={thread.length}
        subtitle="Visible to the requester and anyone who works this ticket."
      >
        <Timeline id="timeline.workspace-comments" entries={thread.map((c) => ({ when: c.createdAt, who: c.authorName, text: c.body }))} />
        {role === "Support Agent" && (
          <Form
            id="form.workspace-comment"
            onSubmit={(values) =>
              allComments.create({ ticketId: ticket.id, authorId: actorId, authorName: actorName, body: values.body, createdAt: today })
            }
            actions={<Button id="btn.workspace-comment.submit" label="Add comment" emphasis="primary" submit />}
          >
            <Field
              id="field.workspace-comment"
              name="body"
              label="Add a comment"
              type="textarea"
              required
              error={state === "state.validation-error" ? "Say something before posting" : undefined}
            />
          </Form>
        )}
      </Section>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const person = users[role as keyof typeof users];
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail
        id="detail.account"
        fields={[
          { label: "Name", value: person.name },
          { label: "Email", value: person.email },
          { label: "Role", value: role },
        ]}
      />
    </Shell>
  );
}

function Settings() {
  return (
    <Shell>
      <Heading id="heading.settings" text="Settings" />
      <EmptyState
        id="empty.settings"
        title="Nothing to set up"
        text="The help desk sends no email or notifications: open a ticket to see its status and comments."
      />
    </Shell>
  );
}

function SignedOut() {
  const role = useRole();
  const target = role === "Employee" ? "screen.my-tickets" : "screen.queue";
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to={target} />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.my-tickets": MyTickets,
    "screen.ticket": TicketDetail,
    "screen.queue": Queue,
    "screen.ticket-workspace": TicketWorkspace,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { tickets, comments },
});
