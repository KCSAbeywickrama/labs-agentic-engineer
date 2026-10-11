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
  Section, Stat, StatGroup, Table, Text, ValidationSummary, defineApp, useCollection, useDisplayState,
  useNav, useParams, useRole, useToday,
} from "@wso2/prototype-kit";

interface Onboarding { id: string; newHireName: string; startDate: string; status: string }
interface Task { id: string; recordId: string; department: string; name: string; status: string; dueDate: string; notes: string }
interface Template { id: string; department: string; name: string; offset: string }

const onboardings: Onboarding[] = [
  { id: "ob-1", newHireName: "Jane Doe", startDate: "2026-01-19", status: "In progress" },
  { id: "ob-2", newHireName: "Sam Lee", startDate: "2026-01-26", status: "In progress" },
  { id: "ob-3", newHireName: "Priya Nair", startDate: "2026-01-05", status: "Complete" },
];

const tasks: Task[] = [
  { id: "t-1", recordId: "ob-1", department: "IT", name: "Provision laptop", status: "Pending", dueDate: "2026-01-12", notes: "" },
  { id: "t-2", recordId: "ob-1", department: "IT", name: "Create email account", status: "Complete", dueDate: "2026-01-10", notes: "" },
  { id: "t-3", recordId: "ob-1", department: "HR", name: "Send benefits packet", status: "In progress", dueDate: "2026-01-20", notes: "" },
  { id: "t-4", recordId: "ob-1", department: "Facilities", name: "Assign desk", status: "Complete", dueDate: "2026-01-09", notes: "" },
  { id: "t-5", recordId: "ob-2", department: "IT", name: "Create accounts", status: "Pending", dueDate: "2026-01-23", notes: "" },
  { id: "t-6", recordId: "ob-2", department: "HR", name: "Schedule orientation", status: "Pending", dueDate: "2026-01-24", notes: "" },
  { id: "t-7", recordId: "ob-2", department: "Facilities", name: "Issue badge", status: "Pending", dueDate: "2026-01-25", notes: "" },
  { id: "t-8", recordId: "ob-3", department: "IT", name: "Provision laptop", status: "Complete", dueDate: "2026-01-02", notes: "" },
  { id: "t-9", recordId: "ob-3", department: "HR", name: "Send benefits packet", status: "Complete", dueDate: "2026-01-03", notes: "" },
  { id: "t-10", recordId: "ob-3", department: "Facilities", name: "Assign desk", status: "Complete", dueDate: "2026-01-02", notes: "" },
];

const templates: Template[] = [
  { id: "tpl-1", department: "IT", name: "Provision laptop", offset: "3" },
  { id: "tpl-2", department: "IT", name: "Create email account", offset: "5" },
  { id: "tpl-3", department: "HR", name: "Send benefits packet", offset: "2" },
  { id: "tpl-4", department: "Facilities", name: "Assign desk", offset: "3" },
];

const users: Record<string, { name: string; email: string }> = {
  HRCoordinator: { name: "Maya Fernando", email: "maya@acme.example" },
  ITStaff: { name: "Ravi Perera", email: "ravi@acme.example" },
  FacilitiesStaff: { name: "Ana Silva", email: "ana@acme.example" },
  Admin: { name: "Kasun Jayasuriya", email: "kasun@acme.example" },
};

const homes: Record<string, string> = {
  HRCoordinator: "screen.dashboard",
  ITStaff: "screen.it-tasks",
  FacilitiesStaff: "screen.facilities-tasks",
  Admin: "screen.templates",
};

function isOverdue(t: Task, today: string) {
  return t.status !== "Complete" && t.dueDate < today;
}

function taskTone(t: Task, today: string) {
  if (isOverdue(t, today)) return "error" as const;
  if (t.status === "Complete") return "success" as const;
  if (t.status === "In progress") return "warning" as const;
  return "default" as const;
}

function taskLabel(t: Task, today: string) {
  return isOverdue(t, today) ? "Overdue" : t.status;
}

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  return (
    <AppShell
      id="shell"
      user={users[role] ?? users.HRCoordinator!}
      nav={[
        { id: "nav.dashboard", label: "Dashboard", to: "screen.dashboard" },
        { id: "nav.new-onboarding", label: "New Onboarding", to: "screen.new-onboarding" },
        { id: "nav.hr-tasks", label: "HR Tasks", to: "screen.hr-tasks" },
        { id: "nav.it-tasks", label: "IT Tasks", to: "screen.it-tasks" },
        { id: "nav.facilities-tasks", label: "Facilities Tasks", to: "screen.facilities-tasks" },
        { id: "nav.templates", label: "Task Templates", to: "screen.templates" },
      ]}
      account="screen.account"
      settings="screen.settings"
      signOut="screen.signed-out"
    >
      {children}
    </AppShell>
  );
}

function FailedAlert() {
  const state = useDisplayState();
  if (state !== "state.failed") return null;
  return (
    <Alert id="alert.failed" tone="error" title="Onboarding service unavailable" text="Showing the last data we have. Try again in a few minutes." />
  );
}

function Dashboard() {
  const state = useDisplayState();
  const today = useToday();
  const recs = useCollection<Onboarding>("onboardings");
  const all = useCollection<Task>("tasks");
  const list = state === "state.empty" ? [] : recs.items;
  const progress = (id: string, dept: string) => {
    const ts = all.items.filter((t) => t.recordId === id && t.department === dept);
    return `${ts.filter((t) => t.status === "Complete").length}/${ts.length}`;
  };
  const overdueFor = (id: string) => all.items.some((t) => t.recordId === id && isOverdue(t, today));
  const active = list.filter((r) => r.status === "In progress");
  const overdueCount = active.filter((r) => overdueFor(r.id)).length;
  return (
    <Shell>
      <Heading id="heading.dashboard" text="Active Onboardings" />
      <FailedAlert />
      <StatGroup>
        <Stat id="stat.active" label="Active onboardings" value={String(active.length)} hint="in progress" icon="Users" />
        <Stat id="stat.overdue" label="With overdue tasks" value={String(overdueCount)} hint="need attention" icon="TriangleAlert" tone="error" />
        <Stat id="stat.complete" label="Completed" value={String(list.filter((r) => r.status === "Complete").length)} hint="closed out" icon="CircleCheck" tone="success" />
      </StatGroup>
      <Section
        id="section.onboardings"
        title="Onboardings"
        count={list.length}
        subtitle="Every new hire with per-department task completion."
        actions={<Button id="btn.new-onboarding" label="New Onboarding" emphasis="primary" to="screen.new-onboarding" />}
      >
        <Table
          id="table.onboardings"
          columns={["New hire", "Start date", "IT", "HR", "Facilities", "Overdue", { label: "Status", kind: "status" }]}
          rows={list.map((r) => ({
            id: `onboarding.${r.id}`,
            cells: [r.newHireName, r.startDate, progress(r.id, "IT"), progress(r.id, "HR"), progress(r.id, "Facilities"), overdueFor(r.id) ? "Yes" : "No"],
            status: { text: r.status, tone: r.status === "Complete" ? "success" : "warning" },
            to: "screen.onboarding-detail",
            params: { record: r.id },
          }))}
          empty={<EmptyState id="empty.onboardings" title="No onboardings yet" text="Start one for a new hire." />}
        />
      </Section>
    </Shell>
  );
}

function NewOnboarding() {
  const state = useDisplayState();
  const navigate = useNav();
  const recs = useCollection<Onboarding>("onboardings");
  const all = useCollection<Task>("tasks");
  const tpls = useCollection<Template>("templates");
  const invalid = state === "state.validation-error";
  const create = (v: Record<string, string>) => {
    const id = recs.create({ newHireName: v.newHireName ?? "", startDate: v.startDate ?? "", status: "In progress" });
    tpls.items.forEach((t) =>
      all.create({ recordId: id, department: t.department, name: t.name, status: "Pending", dueDate: v.startDate ?? "", notes: "" }),
    );
    navigate.go("screen.onboarding-detail", { record: id });
  };
  return (
    <Shell>
      <Breadcrumbs id="crumbs.new" items={[{ id: "crumb.dashboard", label: "Active Onboardings", to: "screen.dashboard" }, { id: "crumb.new", label: "New Onboarding" }]} />
      <Heading id="heading.new" text="New Onboarding" />
      <FailedAlert />
      {invalid && <ValidationSummary id="summary.new" issues={["New hire name is required", "Start date is required"]} />}
      <Form
        id="form.new"
        onSubmit={create}
        actions={
          <>
            <Button id="btn.cancel" label="Cancel" to="screen.dashboard" />
            <Button id="btn.create" label="Create" emphasis="primary" submit />
          </>
        }
      >
        <Field id="field.name" name="newHireName" label="New hire name" required error={invalid ? "New hire name is required" : undefined} />
        <Field id="field.start" name="startDate" label="Start date" type="date" required error={invalid ? "Start date is required" : undefined} />
        <Text id="text.seed" text="Tasks are seeded automatically from the standard IT, HR and Facilities templates." />
      </Form>
    </Shell>
  );
}

function OnboardingDetail() {
  const { record: id } = useParams();
  const state = useDisplayState();
  const today = useToday();
  const recs = useCollection<Onboarding>("onboardings");
  const all = useCollection<Task>("tasks");
  const rec = (id ? recs.get(id) : undefined) ?? recs.items[0]!;
  const ts = state === "state.empty" ? [] : all.items.filter((t) => t.recordId === rec.id);
  const allDone = all.items.filter((t) => t.recordId === rec.id).every((t) => t.status === "Complete");
  return (
    <Shell>
      <Breadcrumbs id="crumbs.detail" items={[{ id: "crumb.dashboard", label: "Active Onboardings", to: "screen.dashboard" }, { id: "crumb.detail", label: rec.newHireName }]} />
      <Heading
        id="heading.detail"
        text={rec.newHireName}
        actions={<Button id="btn.complete" label="Mark Complete" emphasis="primary" disabled={!allDone || rec.status === "Complete"} onPress={() => recs.update(rec.id, { status: "Complete" })} />}
      />
      <FailedAlert />
      {!allDone && <Alert id="alert.incomplete" tone="info" text="Every task across all departments must be complete before this onboarding can be closed." />}
      <Detail id="detail.record" fields={[{ label: "Start date", value: rec.startDate }, { label: "Status", value: rec.status }]} />
      <Badge id="badge.status" label={rec.status} tone={rec.status === "Complete" ? "success" : "warning"} />
      <Section
        id="section.tasks"
        title="Tasks"
        count={ts.length}
        subtitle="Grouped by department; overdue tasks are flagged."
        actions={<Button id="btn.add-task" label="Add Task" to="screen.add-task" params={{ record: rec.id }} />}
      >
        <Table
          id="table.tasks"
          columns={["Department", "Task", "Due date", { label: "Status", kind: "status" }]}
          rows={ts.map((t) => ({
            id: `task.${t.id}`,
            cells: [t.department, t.name, t.dueDate],
            status: { text: taskLabel(t, today), tone: taskTone(t, today) },
            actions: [{ id: `task.${t.id}.remove`, label: "Remove", emphasis: "danger" as const, onPress: () => all.remove(t.id) }],
          }))}
          empty={<EmptyState id="empty.tasks" title="No tasks" text="Add a task for this new hire." />}
        />
      </Section>
    </Shell>
  );
}

function AddTask() {
  const { record: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const recs = useCollection<Onboarding>("onboardings");
  const all = useCollection<Task>("tasks");
  const rec = (id ? recs.get(id) : undefined) ?? recs.items[0]!;
  const invalid = state === "state.validation-error";
  return (
    <Shell>
      <Breadcrumbs id="crumbs.add" items={[{ id: "crumb.dashboard", label: "Active Onboardings", to: "screen.dashboard" }, { id: "crumb.detail", label: rec.newHireName, to: "screen.onboarding-detail", params: { record: rec.id } }, { id: "crumb.add", label: "Add Task" }]} />
      <Heading id="heading.add" text="Add Task" />
      <FailedAlert />
      {invalid && <ValidationSummary id="summary.add" issues={["Task name is required", "Due date is required"]} />}
      <Form
        id="form.add"
        onSubmit={(v) => {
          all.create({ recordId: rec.id, department: v.department ?? "IT", name: v.name ?? "", status: "Pending", dueDate: v.dueDate ?? "", notes: v.notes ?? "" });
          navigate.go("screen.onboarding-detail", { record: rec.id });
        }}
        actions={
          <>
            <Button id="btn.cancel" label="Cancel" to="screen.onboarding-detail" params={{ record: rec.id }} />
            <Button id="btn.save" label="Save" emphasis="primary" submit />
          </>
        }
      >
        <Field id="field.department" name="department" label="Department" type="select" options={["IT", "HR", "Facilities"]} defaultValue="IT" />
        <Field id="field.task" name="name" label="Task name" required error={invalid ? "Task name is required" : undefined} />
        <Field id="field.due" name="dueDate" label="Due date" type="date" required error={invalid ? "Due date is required" : undefined} />
        <Field id="field.notes" name="notes" label="Notes" type="textarea" />
      </Form>
    </Shell>
  );
}

function Queue({ dept, prefix, title }: { dept: string; prefix: string; title: string }) {
  const state = useDisplayState();
  const today = useToday();
  const all = useCollection<Task>("tasks");
  const recs = useCollection<Onboarding>("onboardings");
  const [filter, setFilter] = useState("All");
  const mine = state === "state.empty" ? [] : all.items.filter((t) => t.department === dept && (filter === "All" || t.status === filter));
  const hire = (id: string) => recs.get(id)?.newHireName ?? "Unknown";
  const total = all.items.filter((t) => t.department === dept);
  return (
    <Shell>
      <Heading id={`heading.${prefix}`} text={title} />
      <FailedAlert />
      <StatGroup>
        <Stat id={`stat.${prefix}.open`} label="Open tasks" value={String(total.filter((t) => t.status !== "Complete").length)} hint="across all new hires" icon="ClipboardList" />
        <Stat id={`stat.${prefix}.overdue`} label="Overdue" value={String(total.filter((t) => isOverdue(t, today)).length)} hint="past due date" icon="TriangleAlert" tone="error" />
      </StatGroup>
      <Section id={`section.${prefix}`} title={title} count={mine.length} subtitle="Update a task as you work through it.">
        <Filters id={`filters.${prefix}`}>
          <Field id={`field.${prefix}.status`} label="Status" type="select" options={["All", "Pending", "In progress", "Complete"]} value={filter} onChange={setFilter} />
        </Filters>
        <Table
          id={`table.${prefix}`}
          columns={["New hire", "Task", "Due date", { label: "Status", kind: "status" }]}
          rows={mine.map((t) => ({
            id: `task.${t.id}`,
            cells: [hire(t.recordId), t.name, t.dueDate],
            status: { text: taskLabel(t, today), tone: taskTone(t, today) },
            actions: [
              { id: `task.${t.id}.start`, label: "Mark in progress", onPress: () => all.update(t.id, { status: "In progress" }) },
              { id: `task.${t.id}.done`, label: "Mark complete", onPress: () => all.update(t.id, { status: "Complete" }) },
            ],
          }))}
          empty={<EmptyState id={`empty.${prefix}`} title="No tasks" text="Tasks for new hires appear here." />}
        />
      </Section>
    </Shell>
  );
}

function HrTasks() {
  return <Queue dept="HR" prefix="hr" title="HR Tasks" />;
}
function ItTasks() {
  return <Queue dept="IT" prefix="it" title="IT Tasks" />;
}
function FacilitiesTasks() {
  return <Queue dept="Facilities" prefix="fac" title="Facilities Tasks" />;
}

function Templates() {
  const state = useDisplayState();
  const tpls = useCollection<Template>("templates");
  const list = state === "state.empty" ? [] : tpls.items;
  return (
    <Shell>
      <Heading id="heading.templates" text="Task Templates" />
      <FailedAlert />
      <Section
        id="section.templates"
        title="Standard checklist"
        count={list.length}
        subtitle="Seeded into every new onboarding record."
        actions={<Button id="btn.new-template" label="New Template" emphasis="primary" to="screen.edit-template" />}
      >
        <Table
          id="table.templates"
          columns={["Department", "Task name", { label: "Due (days before start)", kind: "number" }]}
          rows={list.map((t) => ({
            id: `template.${t.id}`,
            cells: [t.department, t.name, t.offset],
            to: "screen.edit-template",
            params: { template: t.id },
            actions: [{ id: `template.${t.id}.remove`, label: "Remove", emphasis: "danger" as const, onPress: () => tpls.remove(t.id) }],
          }))}
          empty={<EmptyState id="empty.templates" title="No templates" text="New onboardings will start with no tasks." />}
        />
      </Section>
    </Shell>
  );
}

function EditTemplate() {
  const { template: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const tpls = useCollection<Template>("templates");
  const existing = id ? tpls.get(id) : undefined;
  const invalid = state === "state.validation-error";
  return (
    <Shell>
      <Breadcrumbs id="crumbs.tpl" items={[{ id: "crumb.templates", label: "Task Templates", to: "screen.templates" }, { id: "crumb.tpl", label: existing ? existing.name : "New template" }]} />
      <Heading id="heading.tpl" text="Task Template" />
      <FailedAlert />
      {invalid && <ValidationSummary id="summary.tpl" issues={["Task name is required", "Default due offset is required"]} />}
      <Form
        id="form.tpl"
        onSubmit={(v) => {
          const rec = { department: v.department ?? "IT", name: v.name ?? "", offset: v.offset ?? "0" };
          if (existing) tpls.update(existing.id, rec);
          else tpls.create(rec);
          navigate.go("screen.templates");
        }}
        actions={
          <>
            <Button id="btn.cancel" label="Cancel" to="screen.templates" />
            <Button id="btn.save" label="Save" emphasis="primary" submit />
          </>
        }
      >
        <Field id="field.department" name="department" label="Department" type="select" options={["IT", "HR", "Facilities"]} defaultValue={existing?.department ?? "IT"} />
        <Field id="field.name" name="name" label="Task name" required defaultValue={existing?.name} error={invalid ? "Task name is required" : undefined} />
        <Field id="field.offset" name="offset" label="Default due offset (days before start)" type="number" required defaultValue={existing?.offset} error={invalid ? "Default due offset is required" : undefined} />
      </Form>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const u = users[role] ?? users.HRCoordinator!;
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail id="detail.account" fields={[{ label: "Name", value: u.name }, { label: "Email", value: u.email }]} />
    </Shell>
  );
}

function Settings() {
  const navigate = useNav();
  const role = useRole();
  return (
    <Shell>
      <Heading id="heading.settings" text="Settings" />
      <Form
        id="form.settings"
        onSubmit={() => navigate.go(homes[role] ?? "screen.account")}
        actions={<Button id="btn.save-settings" label="Save settings" emphasis="primary" submit />}
      >
        <Field id="field.compact" label="Compact tables" type="switch" defaultValue="off" />
      </Form>
    </Shell>
  );
}

function SignedOut() {
  const navigate = useNav();
  const role = useRole();
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" onPress={() => navigate.go(homes[role] ?? "screen.account")} />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.dashboard": Dashboard,
    "screen.new-onboarding": NewOnboarding,
    "screen.onboarding-detail": OnboardingDetail,
    "screen.add-task": AddTask,
    "screen.hr-tasks": HrTasks,
    "screen.it-tasks": ItTasks,
    "screen.facilities-tasks": FacilitiesTasks,
    "screen.templates": Templates,
    "screen.edit-template": EditTemplate,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { onboardings, tasks, templates },
});
