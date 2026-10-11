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
  Section, Stat, StatGroup, Table, Text, ValidationSummary, defineApp, useCollection, useDisplayState, useNav,
  useParams, useRole, useToday,
} from "@wso2/prototype-kit";

interface Onboarding { id: string; newHireName: string; role: string; startDate: string; status: string }
interface Task {
  id: string; onboardingId: string; newHireName: string; title: string; description: string;
  department: string; dueDate: string; status: string; completedOn: string;
}
interface Note { id: string; taskId: string; text: string; author: string }

const onboardings: Onboarding[] = [
  { id: "o1", newHireName: "Maya Perera", role: "Support Engineer", startDate: "2026-01-05", status: "active" },
  { id: "o2", newHireName: "Kasun Silva", role: "Accountant", startDate: "2026-01-12", status: "active" },
  { id: "o3", newHireName: "Nadia Fernando", role: "Designer", startDate: "2026-02-02", status: "active" },
];

const tasks: Task[] = [
  { id: "t1", onboardingId: "o1", newHireName: "Maya Perera", title: "Set up laptop", description: "Image and hand over", department: "IT", dueDate: "2026-01-05", status: "done", completedOn: "2026-01-05" },
  { id: "t2", onboardingId: "o1", newHireName: "Maya Perera", title: "Create email and SSO accounts", description: "Standard accounts", department: "IT", dueDate: "2026-01-07", status: "open", completedOn: "" },
  { id: "t3", onboardingId: "o1", newHireName: "Maya Perera", title: "Collect signed contract", description: "Signed copy on file", department: "HR", dueDate: "2026-01-06", status: "open", completedOn: "" },
  { id: "t4", onboardingId: "o1", newHireName: "Maya Perera", title: "Issue access badge", description: "Main entrance and floor 3", department: "Facilities", dueDate: "2026-01-09", status: "open", completedOn: "" },
  { id: "t5", onboardingId: "o2", newHireName: "Kasun Silva", title: "Set up laptop", description: "Image and hand over", department: "IT", dueDate: "2026-01-12", status: "open", completedOn: "" },
  { id: "t6", onboardingId: "o2", newHireName: "Kasun Silva", title: "Orientation session", description: "Book the Friday session", department: "HR", dueDate: "2026-01-16", status: "open", completedOn: "" },
  { id: "t7", onboardingId: "o2", newHireName: "Kasun Silva", title: "Assign desk", description: "Finance area", department: "Facilities", dueDate: "2026-01-17", status: "open", completedOn: "" },
  { id: "t8", onboardingId: "o2", newHireName: "Kasun Silva", title: "Enrol in payroll", description: "Bank details form", department: "HR", dueDate: "2026-01-20", status: "open", completedOn: "" },
  { id: "t9", onboardingId: "o3", newHireName: "Nadia Fernando", title: "Order laptop", description: "Design spec machine", department: "IT", dueDate: "2026-01-28", status: "open", completedOn: "" },
  { id: "t10", onboardingId: "o3", newHireName: "Nadia Fernando", title: "Reserve parking", description: "Visitor bay until badge", department: "Facilities", dueDate: "2026-01-30", status: "open", completedOn: "" },
];

const notes: Note[] = [
  { id: "n1", taskId: "t2", text: "Waiting on HR to confirm the start date", author: "Ian Mendis" },
];

const users: Record<string, { name: string; email: string; department: string }> = {
  HRCoordinator: { name: "Hana Jayasuriya", email: "hana@acme.example", department: "HR" },
  ITTeamMember: { name: "Ian Mendis", email: "ian@acme.example", department: "IT" },
  HRTeamMember: { name: "Helen Abeysekara", email: "helen@acme.example", department: "HR" },
  FacilitiesTeamMember: { name: "Fiona Rodrigo", email: "fiona@acme.example", department: "Facilities" },
};

const departments = ["IT", "HR", "Facilities"];

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y!, m! - 1, d!) / 86400000);
}
function addDays(iso: string, n: number): string {
  return new Date((dayNumber(iso) + n) * 86400000).toISOString().slice(0, 10);
}
function daysOverdue(t: Task, today: string): number {
  return t.status === "open" ? Math.max(0, dayNumber(today) - dayNumber(t.dueDate)) : 0;
}
function isDueSoon(t: Task, today: string): boolean {
  const diff = dayNumber(t.dueDate) - dayNumber(today);
  return t.status === "open" && diff >= 0 && diff <= 2;
}
function taskStatus(t: Task, today: string): { text: string; tone: "error" | "warning" | "default" | "success" } {
  if (t.status === "done") return { text: "Done", tone: "success" };
  const od = daysOverdue(t, today);
  if (od > 0) return { text: `Overdue ${od}d`, tone: "error" };
  if (isDueSoon(t, today)) return { text: "Due soon", tone: "warning" };
  return { text: "Open", tone: "default" };
}

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  const user = users[role] ?? users["HRCoordinator"]!;
  return (
    <AppShell
      id="shell"
      user={{ name: user.name, email: user.email }}
      nav={[
        { id: "nav.home", label: "Home", to: "screen.home" },
        { id: "nav.tasks", label: "All tasks", to: "screen.tasks" },
        { id: "nav.overdue", label: "Overdue", to: "screen.overdue" },
      ]}
      account="screen.account"
      settings="screen.settings"
      signOut="screen.signed-out"
    >
      {children}
    </AppShell>
  );
}

function CoordinatorHome() {
  const state = useDisplayState();
  const today = useToday();
  const ob = useCollection<Onboarding>("onboardings");
  const tk = useCollection<Task>("tasks");
  const list = state === "state.empty" ? [] : ob.items;
  const overdueFor = (id: string) => tk.items.filter((t) => t.onboardingId === id && daysOverdue(t, today) > 0).length;
  const openFor = (id: string) => tk.items.filter((t) => t.onboardingId === id && t.status === "open").length;
  const totalOverdue = state === "state.empty" ? 0 : tk.items.filter((t) => daysOverdue(t, today) > 0).length;
  return (
    <Shell>
      <Heading id="heading.onboardings" text="Onboardings" />
      {state === "state.failed" && (
        <Alert id="alert.failed" tone="error" title="Onboardings unavailable" text="The list could not be loaded. Try again in a few minutes." />
      )}
      <StatGroup>
        <Stat id="stat.active" label="Active onboardings" value={String(list.filter((o) => o.status === "active").length)} hint="new hires in progress" icon="Users" />
        <Stat id="stat.overdue" label="Overdue tasks" value={String(totalOverdue)} hint="across all departments" icon="TriangleAlert" tone={totalOverdue > 0 ? "error" : "success"} />
      </StatGroup>
      <Section
        id="section.onboardings"
        title="All onboardings"
        count={list.length}
        subtitle="Start date, progress and overdue tasks per new hire."
        actions={<Button id="btn.new-onboarding" label="New onboarding" emphasis="primary" to="screen.onboarding-new" />}
      >
        <Table
          id="table.onboardings"
          columns={["New hire", "Role", "Start date", { label: "Open tasks", kind: "number" }, { label: "Overdue", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={list.map((o) => ({
            id: `onboarding.${o.id}`,
            cells: [o.newHireName, o.role, o.startDate, String(openFor(o.id)), String(overdueFor(o.id))],
            status: { text: o.status === "active" ? "Active" : o.status === "closed" ? "Closed" : "Cancelled", tone: o.status === "active" ? "info" : "default" },
            to: "screen.onboarding-detail",
            params: { onboarding: o.id },
          }))}
          empty={<EmptyState id="empty.onboardings" title="No onboardings yet" text="Start one when a new hire is confirmed." />}
        />
      </Section>
    </Shell>
  );
}

function TeamHome() {
  const role = useRole();
  const state = useDisplayState();
  const today = useToday();
  const dept = (users[role] ?? users["ITTeamMember"]!).department;
  const tk = useCollection<Task>("tasks");
  const nt = useCollection<Note>("notes");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const mine = state === "state.empty" ? [] : tk.items.filter((t) => t.department === dept);
  const open = mine.filter((t) => t.status === "open").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const done = mine.filter((t) => t.status === "done");
  const overdueCount = open.filter((t) => daysOverdue(t, today) > 0).length;
  const soonCount = open.filter((t) => isDueSoon(t, today)).length;
  const noteTask = noteFor ? tk.get(noteFor) : undefined;
  return (
    <Shell>
      <Heading id="heading.my-tasks" text={`${dept} tasks`} />
      {state === "state.failed" && (
        <Alert id="alert.failed" tone="error" title="Tasks unavailable" text="Your department's tasks could not be loaded. Try again in a few minutes." />
      )}
      {overdueCount > 0 && (
        <Alert id="alert.overdue" tone="warning" title={`${overdueCount} overdue`} text="Overdue tasks are highlighted below. Mark them done to clear the reminder." />
      )}
      <StatGroup>
        <Stat id="stat.overdue" label="Overdue" value={String(overdueCount)} hint="past their due date" icon="TriangleAlert" tone={overdueCount > 0 ? "error" : "success"} />
        <Stat id="stat.soon" label="Due soon" value={String(soonCount)} hint="within 2 days" icon="Clock" tone="warning" />
        <Stat id="stat.open" label="Open" value={String(open.length)} hint="tasks for your team" icon="ListChecks" />
      </StatGroup>
      <Section id="section.open" title="Open tasks" count={open.length} subtitle="Soonest due first.">
        <Table
          id="table.open"
          columns={["Task", "New hire", "Due", { label: "Days overdue", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={open.map((t) => ({
            id: `task.${t.id}`,
            cells: [t.title, t.newHireName, t.dueDate, String(daysOverdue(t, today))],
            status: taskStatus(t, today),
            actions: [
              { id: `task.${t.id}.done`, label: "Mark done", onPress: () => tk.update(t.id, { status: "done", completedOn: today }) },
              { id: `task.${t.id}.note`, label: "Notes", onPress: () => setNoteFor(t.id) },
            ],
          }))}
          empty={<EmptyState id="empty.open" title="Nothing open" text="Tasks for your team appear here when an onboarding starts." />}
        />
      </Section>
      <Section id="section.done" title="Completed" count={done.length} subtitle="Reopen a task marked done by mistake.">
        <Table
          id="table.done"
          columns={["Task", "New hire", "Completed", { label: "Status", kind: "status" }]}
          rows={done.map((t) => ({
            id: `task.${t.id}`,
            cells: [t.title, t.newHireName, t.completedOn],
            status: taskStatus(t, today),
            actions: [{ id: `task.${t.id}.reopen`, label: "Reopen", onPress: () => tk.update(t.id, { status: "open", completedOn: "" }) }],
          }))}
          empty={<EmptyState id="empty.done" title="Nothing completed yet" text="Completed tasks are listed here." />}
        />
      </Section>
      <Dialog id="dialog.notes" title={noteTask ? `Notes: ${noteTask.title}` : "Notes"} open={noteFor !== null} onClose={() => setNoteFor(null)}>
        {noteTask && nt.items.filter((n) => n.taskId === noteTask.id).map((n) => (
          <Text key={n.id} id={`text.note.${n.id}`} text={`${n.author}: ${n.text}`} />
        ))}
        <Form
          id="form.note"
          onSubmit={(v) => {
            if (noteTask && v["text"]) nt.create({ taskId: noteTask.id, text: v["text"], author: (users[role] ?? users["ITTeamMember"]!).name });
          }}
          actions={<Button id="btn.note.add" label="Add note" emphasis="primary" submit />}
        >
          <Field id="field.note" name="text" label="Note" type="textarea" required />
        </Form>
      </Dialog>
    </Shell>
  );
}

function Home() {
  const role = useRole();
  return role === "HRCoordinator" ? <CoordinatorHome /> : <TeamHome />;
}

function OnboardingNew() {
  const state = useDisplayState();
  const today = useToday();
  const navigate = useNav();
  const ob = useCollection<Onboarding>("onboardings");
  const tk = useCollection<Task>("tasks");
  const bad = state === "state.validation-error";
  return (
    <Shell>
      <Breadcrumbs id="crumbs.new" items={[{ id: "crumb.home", label: "Onboardings", to: "screen.home" }, { id: "crumb.new", label: "New onboarding" }]} />
      <Heading id="heading.new" text="Start an onboarding" />
      {bad && <ValidationSummary id="summary.new" issues={["New hire name is required", "Start date is required"]} />}
      <Form
        id="form.new"
        title="New hire"
        onSubmit={(v) => {
          const start = v["startDate"] || today;
          const name = v["newHireName"] || "New hire";
          const id = ob.create({ newHireName: name, role: v["role"] || "", startDate: start, status: "active" });
          const seed = [
            { title: "Set up laptop and accounts", department: "IT", offset: 0 },
            { title: "Collect signed contract and orientation", department: "HR", offset: 1 },
            { title: "Assign desk and issue badge", department: "Facilities", offset: 0 },
          ];
          seed.forEach((s) => tk.create({ onboardingId: id, newHireName: name, title: s.title, description: "Default task", department: s.department, dueDate: addDays(start, s.offset), status: "open", completedOn: "" }));
          navigate.go("screen.onboarding-detail", { onboarding: id });
        }}
        actions={<Button id="btn.create" label="Start onboarding" emphasis="primary" submit />}
      >
        <Field id="field.name" name="newHireName" label="New hire name" required error={bad ? "Enter the new hire's name" : undefined} />
        <Field id="field.role" name="role" label="Role" />
        <Field id="field.start" name="startDate" label="Start date" type="date" required error={bad ? "Pick a start date" : undefined} />
      </Form>
      <Text id="text.defaults" text="The default IT, HR and Facilities tasks are added automatically; due dates are offsets from the start date. *assumed*" />
    </Shell>
  );
}

function OnboardingDetail() {
  const { onboarding: id } = useParams();
  const today = useToday();
  const state = useDisplayState();
  const navigate = useNav();
  const ob = useCollection<Onboarding>("onboardings");
  const tk = useCollection<Task>("tasks");
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const o = (id ? ob.get(id) : undefined) ?? ob.items[0]!;
  const mine = state === "state.empty" ? [] : tk.items.filter((t) => t.onboardingId === o.id);
  const editTask = editing ? tk.get(editing) : undefined;
  const bad = state === "state.validation-error";
  const close = () => { setOpen(false); setEditing(null); };
  return (
    <Shell>
      <Breadcrumbs id="crumbs.detail" items={[{ id: "crumb.home", label: "Onboardings", to: "screen.home" }, { id: "crumb.current", label: o.newHireName }]} />
      <Heading
        id="heading.detail"
        text={o.newHireName}
        actions={
          <>
            <Button id="btn.close" label="Close onboarding" onPress={() => { ob.update(o.id, { status: "closed" }); navigate.go("screen.home"); }} />
            <Button id="btn.cancel" label="Cancel onboarding" emphasis="danger" onPress={() => { ob.update(o.id, { status: "cancelled" }); navigate.go("screen.home"); }} />
          </>
        }
      />
      <Detail id="detail.onboarding" fields={[{ label: "Role", value: o.role }, { label: "Start date", value: o.startDate }, { label: "Status", value: o.status }]} />
      <Section id="section.departments" title="Progress by department">
        <Table
          id="table.departments"
          columns={["Department", { label: "Open", kind: "number" }, { label: "Done", kind: "number" }]}
          rows={departments.map((d) => ({
            id: `dept.${d}`,
            cells: [d, String(mine.filter((t) => t.department === d && t.status === "open").length), String(mine.filter((t) => t.department === d && t.status === "done").length)],
          }))}
        />
      </Section>
      <Section
        id="section.tasks"
        title="Tasks"
        count={mine.length}
        actions={<Button id="btn.add-task" label="Add task" emphasis="primary" onPress={() => setOpen(true)} />}
      >
        <Table
          id="table.tasks"
          columns={["Task", "Department", "Due", { label: "Status", kind: "status" }]}
          rows={mine.map((t) => ({
            id: `task.${t.id}`,
            cells: [t.title, t.department, t.dueDate],
            status: taskStatus(t, today),
            actions: [
              { id: `task.${t.id}.edit`, label: "Edit", onPress: () => { setEditing(t.id); setOpen(true); } },
              { id: `task.${t.id}.remove`, label: "Remove", emphasis: "danger", onPress: () => tk.remove(t.id) },
            ],
          }))}
          empty={<EmptyState id="empty.tasks" title="No tasks" text="Add a task for IT, HR or Facilities." />}
        />
      </Section>
      <Dialog id="dialog.task" title={editTask ? "Edit task" : "Add task"} open={open} onClose={close}>
        <Form
          id="form.task"
          key={editing ?? "new"}
          onSubmit={(v) => {
            const patch = { title: v["title"] || "Untitled task", description: v["description"] || "", department: v["department"] || "IT", dueDate: v["dueDate"] || today };
            if (editTask) tk.update(editTask.id, patch);
            else tk.create({ ...patch, onboardingId: o.id, newHireName: o.newHireName, status: "open", completedOn: "" });
            close();
          }}
          actions={<Button id="btn.task.save" label="Save task" emphasis="primary" submit />}
        >
          <Field id="field.title" name="title" label="Title" required defaultValue={editTask?.title} error={bad ? "A title is required" : undefined} />
          <Field id="field.department" name="department" label="Department" type="select" options={departments} defaultValue={editTask?.department ?? "IT"} />
          <Field id="field.due" name="dueDate" label="Due date" type="date" required defaultValue={editTask?.dueDate} error={bad ? "A due date is required" : undefined} />
          <Field id="field.description" name="description" label="Description" type="textarea" defaultValue={editTask?.description} />
        </Form>
      </Dialog>
    </Shell>
  );
}

function AllTasks() {
  const today = useToday();
  const state = useDisplayState();
  const tk = useCollection<Task>("tasks");
  const ob = useCollection<Onboarding>("onboardings");
  const [dept, setDept] = useState("All");
  const [status, setStatus] = useState("All");
  const [hire, setHire] = useState("All");
  const list = (state === "state.empty" ? [] : tk.items)
    .filter((t) => dept === "All" || t.department === dept)
    .filter((t) => status === "All" || t.status === status.toLowerCase())
    .filter((t) => hire === "All" || t.newHireName === hire)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return (
    <Shell>
      <Heading id="heading.tasks" text="All tasks" />
      <Section id="section.all-tasks" title="Tasks" count={list.length} subtitle="Filter by department, status and new hire.">
        <Filters id="filters.tasks">
          <Field id="filter.department" label="Department" type="select" options={["All", ...departments]} value={dept} onChange={setDept} />
          <Field id="filter.status" label="Status" type="select" options={["All", "Open", "Done"]} value={status} onChange={setStatus} />
          <Field id="filter.hire" label="New hire" type="select" options={["All", ...ob.items.map((o) => o.newHireName)]} value={hire} onChange={setHire} />
        </Filters>
        <Table
          id="table.all-tasks"
          columns={["Task", "New hire", "Department", "Due", { label: "Status", kind: "status" }]}
          rows={list.map((t) => ({
            id: `task.${t.id}`,
            cells: [t.title, t.newHireName, t.department, t.dueDate],
            status: taskStatus(t, today),
            actions: t.status === "open" ? [{ id: `task.${t.id}.done`, label: "Mark done", onPress: () => tk.update(t.id, { status: "done", completedOn: today }) }] : [],
          }))}
          empty={<EmptyState id="empty.all-tasks" title="No matching tasks" text="Change the filters to see more." />}
        />
      </Section>
    </Shell>
  );
}

function Overdue() {
  const today = useToday();
  const state = useDisplayState();
  const tk = useCollection<Task>("tasks");
  const list = (state === "state.empty" ? [] : tk.items)
    .filter((t) => daysOverdue(t, today) > 0)
    .sort((a, b) => daysOverdue(b, today) - daysOverdue(a, today));
  return (
    <Shell>
      <Heading id="heading.overdue" text="Overdue tasks" />
      {state === "state.failed" && (
        <Alert id="alert.failed" tone="error" title="Overdue list unavailable" text="Try again in a few minutes." />
      )}
      <Section id="section.overdue" title="Past due" count={list.length} subtitle="Most overdue first, across all departments.">
        <Table
          id="table.overdue"
          columns={["Task", "New hire", "Department", "Due", { label: "Days overdue", kind: "number" }]}
          rows={list.map((t) => ({
            id: `task.${t.id}`,
            cells: [t.title, t.newHireName, t.department, t.dueDate, String(daysOverdue(t, today))],
            to: "screen.onboarding-detail",
            params: { onboarding: t.onboardingId },
            actions: [{ id: `task.${t.id}.done`, label: "Mark done", onPress: () => tk.update(t.id, { status: "done", completedOn: today }) }],
          }))}
          empty={<EmptyState id="empty.overdue" title="Nothing overdue" text="Every open task is on schedule." />}
        />
      </Section>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const user = users[role] ?? users["HRCoordinator"]!;
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail id="detail.account" fields={[{ label: "Name", value: user.name }, { label: "Email", value: user.email }, { label: "Department", value: user.department }]} />
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
        onSubmit={() => navigate.go("screen.home")}
        actions={<Button id="btn.save-settings" label="Save settings" emphasis="primary" submit />}
      >
        <Field id="field.compact" label="Compact task lists" type="switch" defaultValue="off" />
      </Form>
    </Shell>
  );
}

function SignedOut() {
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to="screen.home" />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.home": Home,
    "screen.onboarding-new": OnboardingNew,
    "screen.onboarding-detail": OnboardingDetail,
    "screen.tasks": AllTasks,
    "screen.overdue": Overdue,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { onboardings, tasks, notes },
});
