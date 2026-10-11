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
  Alert, AppShell, Breadcrumbs, Button, Detail, Dialog, EmptyState, Field, Filters, Form, Heading,
  Screen, Section, Stat, StatGroup, Table, Tabs, defineApp, useCollection, useDisplayState, useNav,
  useParams, useRole, useToday,
} from "@wso2/prototype-kit";

type Department = "it" | "hr" | "facilities";

interface OnboardingRecord {
  id: string;
  newHireName: string;
  startDate: string;
  status: string;
  createdAt: string;
  itTasksComplete: number;
  itTasksTotal: number;
  hrTasksComplete: number;
  hrTasksTotal: number;
  facilitiesTasksComplete: number;
  facilitiesTasksTotal: number;
  hasOverdueTasks: boolean;
}

interface Task {
  id: string;
  onboardingRecordId: string;
  department: Department;
  name: string;
  status: string;
  dueDate: string;
  notes: string;
  overdue: boolean;
}

interface TaskTemplate {
  id: string;
  department: Department;
  name: string;
  defaultDueOffsetDays: number;
}

const onboardingRecords: OnboardingRecord[] = [
  { id: "1001", newHireName: "Maya Fernando", startDate: "2026-01-20", status: "in-progress", createdAt: "2026-01-10T09:00:00Z", itTasksComplete: 1, itTasksTotal: 3, hrTasksComplete: 2, hrTasksTotal: 3, facilitiesTasksComplete: 0, facilitiesTasksTotal: 2, hasOverdueTasks: true },
  { id: "1002", newHireName: "Ravi Perera", startDate: "2026-01-22", status: "in-progress", createdAt: "2026-01-12T09:00:00Z", itTasksComplete: 2, itTasksTotal: 2, hrTasksComplete: 1, hrTasksTotal: 3, facilitiesTasksComplete: 1, facilitiesTasksTotal: 1, hasOverdueTasks: false },
  { id: "1003", newHireName: "Ana Silva", startDate: "2025-12-15", status: "complete", createdAt: "2025-12-01T09:00:00Z", itTasksComplete: 3, itTasksTotal: 3, hrTasksComplete: 3, hrTasksTotal: 3, facilitiesTasksComplete: 2, facilitiesTasksTotal: 2, hasOverdueTasks: false },
  { id: "1004", newHireName: "Daniel Wong", startDate: "2026-02-01", status: "in-progress", createdAt: "2026-01-14T09:00:00Z", itTasksComplete: 0, itTasksTotal: 2, hrTasksComplete: 0, hrTasksTotal: 2, facilitiesTasksComplete: 0, facilitiesTasksTotal: 1, hasOverdueTasks: false },
];

const tasks: Task[] = [
  { id: "it-1", onboardingRecordId: "1001", department: "it", name: "Provision laptop", status: "complete", dueDate: "2026-01-18", notes: "", overdue: false },
  { id: "it-2", onboardingRecordId: "1001", department: "it", name: "Create email account", status: "in-progress", dueDate: "2026-01-12", notes: "", overdue: true },
  { id: "it-3", onboardingRecordId: "1001", department: "it", name: "Set up VPN access", status: "pending", dueDate: "2026-01-25", notes: "", overdue: false },
  { id: "hr-1", onboardingRecordId: "1001", department: "hr", name: "Send offer letter", status: "complete", dueDate: "2026-01-05", notes: "", overdue: false },
  { id: "hr-2", onboardingRecordId: "1001", department: "hr", name: "Collect tax forms", status: "complete", dueDate: "2026-01-14", notes: "", overdue: false },
  { id: "hr-3", onboardingRecordId: "1001", department: "hr", name: "Schedule orientation", status: "pending", dueDate: "2026-01-19", notes: "", overdue: false },
  { id: "fac-1", onboardingRecordId: "1001", department: "facilities", name: "Assign desk", status: "pending", dueDate: "2026-01-13", notes: "", overdue: true },
  { id: "fac-2", onboardingRecordId: "1001", department: "facilities", name: "Issue badge", status: "pending", dueDate: "2026-01-19", notes: "", overdue: false },

  { id: "it-4", onboardingRecordId: "1002", department: "it", name: "Provision laptop", status: "complete", dueDate: "2026-01-20", notes: "", overdue: false },
  { id: "it-5", onboardingRecordId: "1002", department: "it", name: "Create email account", status: "complete", dueDate: "2026-01-20", notes: "", overdue: false },
  { id: "hr-4", onboardingRecordId: "1002", department: "hr", name: "Send offer letter", status: "complete", dueDate: "2026-01-10", notes: "", overdue: false },
  { id: "hr-5", onboardingRecordId: "1002", department: "hr", name: "Collect tax forms", status: "pending", dueDate: "2026-01-21", notes: "", overdue: false },
  { id: "hr-6", onboardingRecordId: "1002", department: "hr", name: "Schedule orientation", status: "pending", dueDate: "2026-01-21", notes: "", overdue: false },
  { id: "fac-3", onboardingRecordId: "1002", department: "facilities", name: "Assign desk", status: "complete", dueDate: "2026-01-21", notes: "", overdue: false },

  { id: "it-6", onboardingRecordId: "1003", department: "it", name: "Provision laptop", status: "complete", dueDate: "2025-12-10", notes: "", overdue: false },
  { id: "it-7", onboardingRecordId: "1003", department: "it", name: "Create email account", status: "complete", dueDate: "2025-12-10", notes: "", overdue: false },
  { id: "it-8", onboardingRecordId: "1003", department: "it", name: "Set up VPN access", status: "complete", dueDate: "2025-12-12", notes: "", overdue: false },
  { id: "hr-9", onboardingRecordId: "1003", department: "hr", name: "Send offer letter", status: "complete", dueDate: "2025-12-05", notes: "", overdue: false },
  { id: "hr-10", onboardingRecordId: "1003", department: "hr", name: "Collect tax forms", status: "complete", dueDate: "2025-12-14", notes: "", overdue: false },
  { id: "hr-11", onboardingRecordId: "1003", department: "hr", name: "Schedule orientation", status: "complete", dueDate: "2025-12-14", notes: "", overdue: false },
  { id: "fac-4", onboardingRecordId: "1003", department: "facilities", name: "Assign desk", status: "complete", dueDate: "2025-12-13", notes: "", overdue: false },
  { id: "fac-5", onboardingRecordId: "1003", department: "facilities", name: "Issue badge", status: "complete", dueDate: "2025-12-14", notes: "", overdue: false },

  { id: "it-9", onboardingRecordId: "1004", department: "it", name: "Provision laptop", status: "pending", dueDate: "2026-01-30", notes: "", overdue: false },
  { id: "it-10", onboardingRecordId: "1004", department: "it", name: "Create email account", status: "pending", dueDate: "2026-01-31", notes: "", overdue: false },
  { id: "hr-12", onboardingRecordId: "1004", department: "hr", name: "Send offer letter", status: "pending", dueDate: "2026-01-28", notes: "", overdue: false },
  { id: "hr-13", onboardingRecordId: "1004", department: "hr", name: "Collect tax forms", status: "pending", dueDate: "2026-01-29", notes: "", overdue: false },
  { id: "fac-6", onboardingRecordId: "1004", department: "facilities", name: "Assign desk", status: "pending", dueDate: "2026-01-30", notes: "", overdue: false },
];

const taskTemplates: TaskTemplate[] = [
  { id: "tpl-it-1", department: "it", name: "Provision laptop", defaultDueOffsetDays: -2 },
  { id: "tpl-it-2", department: "it", name: "Create email account", defaultDueOffsetDays: -3 },
  { id: "tpl-it-3", department: "it", name: "Set up VPN access", defaultDueOffsetDays: 5 },
  { id: "tpl-hr-1", department: "hr", name: "Send offer letter", defaultDueOffsetDays: -10 },
  { id: "tpl-hr-2", department: "hr", name: "Collect tax forms", defaultDueOffsetDays: -1 },
  { id: "tpl-hr-3", department: "hr", name: "Schedule orientation", defaultDueOffsetDays: 2 },
  { id: "tpl-fac-1", department: "facilities", name: "Assign desk", defaultDueOffsetDays: -2 },
  { id: "tpl-fac-2", department: "facilities", name: "Issue badge", defaultDueOffsetDays: 2 },
];

const userNames: Record<string, string> = {
  HRCoordinator: "Priya Nair",
  ITStaff: "Sam Okafor",
  FacilitiesStaff: "Jordan Lee",
  Admin: "Taylor Brooks",
};
const userEmails: Record<string, string> = {
  HRCoordinator: "priya.nair@acme.example",
  ITStaff: "sam.okafor@acme.example",
  FacilitiesStaff: "jordan.lee@acme.example",
  Admin: "taylor.brooks@acme.example",
};
const userLabels: Record<string, string> = {
  HRCoordinator: "HR Coordinator",
  ITStaff: "IT Staff",
  FacilitiesStaff: "Facilities Staff",
  Admin: "Admin",
};
const homeScreen: Record<string, string> = {
  HRCoordinator: "screen.dashboard",
  ITStaff: "screen.it-queue",
  FacilitiesStaff: "screen.facilities-queue",
  Admin: "screen.templates",
};

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  const navByRole: Record<string, { id: string; label: string; to: string }[]> = {
    HRCoordinator: [{ id: "nav.dashboard", label: "Dashboard", to: "screen.dashboard" }],
    ITStaff: [{ id: "nav.it-queue", label: "IT tasks", to: "screen.it-queue" }],
    FacilitiesStaff: [{ id: "nav.facilities-queue", label: "Facilities tasks", to: "screen.facilities-queue" }],
    Admin: [{ id: "nav.templates", label: "Task templates", to: "screen.templates" }],
  };
  return (
    <AppShell
      id="shell"
      user={{ name: userNames[role] ?? "User", email: userEmails[role], role: userLabels[role] }}
      nav={navByRole[role] ?? []}
      account="screen.account"
      settings="screen.settings"
      signOut="screen.signed-out"
    >
      {children}
    </AppShell>
  );
}

function statusTone(task: Task): "error" | "success" | "default" {
  if (task.overdue) return "error";
  if (task.status === "complete") return "success";
  return "default";
}

function statusText(task: Task): string {
  if (task.overdue) return "Overdue";
  if (task.status === "complete") return "Complete";
  if (task.status === "in-progress") return "In progress";
  return "Pending";
}

function Dashboard() {
  const state = useDisplayState();
  const records = useCollection<OnboardingRecord>("onboardingRecords");
  const rows = state === "state.empty" ? [] : records.items;
  const active = rows.filter((r) => r.status === "in-progress").length;
  const overdue = rows.filter((r) => r.hasOverdueTasks).length;
  return (
    <Shell>
      <Heading
        id="heading.dashboard"
        text="Onboarding dashboard"
        actions={<Button id="btn.new-onboarding" label="New onboarding" emphasis="primary" to="screen.new-onboarding" />}
      />
      {state === "state.failed" && (
        <Alert id="alert.dashboard-failed" tone="error" title="Could not load onboarding records" text="Try again in a few minutes." />
      )}
      <StatGroup>
        <Stat id="stat.active" label="Active onboardings" value={String(active)} hint="in progress" icon="Users" tone="default" />
        <Stat id="stat.overdue" label="Overdue tasks" value={String(overdue)} hint="new hires with an overdue task" icon="TriangleAlert" tone="warning" />
      </StatGroup>
      <Section id="section.new-hires" title="New hires" count={rows.length} subtitle="Open a new hire to manage their tasks.">
        <Table
          id="table.new-hires"
          columns={["New hire", "Start date", "IT", "HR", "Facilities", "Overdue", { label: "Status", kind: "status" }]}
          rows={rows.map((r) => ({
            id: `record.${r.id}`,
            cells: [
              r.newHireName,
              r.startDate,
              `${r.itTasksComplete}/${r.itTasksTotal}`,
              `${r.hrTasksComplete}/${r.hrTasksTotal}`,
              `${r.facilitiesTasksComplete}/${r.facilitiesTasksTotal}`,
              r.hasOverdueTasks ? "Yes" : "No",
            ],
            status: { text: r.status === "complete" ? "Complete" : "In progress", tone: r.status === "complete" ? "success" : "info" },
            to: "screen.onboarding-detail",
            params: { record: r.id },
          }))}
          empty={
            <EmptyState
              id="empty.new-hires"
              title="No onboarding records yet"
              text="Start a new hire's onboarding to see it here."
              actions={<Button id="btn.empty-new-onboarding" label="New onboarding" emphasis="primary" to="screen.new-onboarding" />}
            />
          }
        />
      </Section>
    </Shell>
  );
}

function NewOnboarding() {
  const state = useDisplayState();
  const navigate = useNav();
  const records = useCollection<OnboardingRecord>("onboardingRecords");
  const taskList = useCollection<Task>("tasks");
  const templates = useCollection<TaskTemplate>("taskTemplates");
  const today = useToday();
  const submit = (values: Record<string, string>) => {
    const id = records.create({
      newHireName: values.newHireName,
      startDate: values.startDate,
      status: "in-progress",
      createdAt: `${today}T09:00:00Z`,
      itTasksComplete: 0,
      itTasksTotal: templates.items.filter((t) => t.department === "it").length,
      hrTasksComplete: 0,
      hrTasksTotal: templates.items.filter((t) => t.department === "hr").length,
      facilitiesTasksComplete: 0,
      facilitiesTasksTotal: templates.items.filter((t) => t.department === "facilities").length,
      hasOverdueTasks: false,
    });
    templates.items.forEach((t) => {
      taskList.create({
        onboardingRecordId: id,
        department: t.department,
        name: t.name,
        status: "pending",
        dueDate: values.startDate,
        notes: "",
        overdue: false,
      });
    });
    navigate.go("screen.onboarding-detail", { record: id });
  };
  return (
    <Shell>
      <Breadcrumbs
        id="breadcrumbs.new-onboarding"
        items={[{ id: "crumb.dashboard", label: "Dashboard", to: "screen.dashboard" }, { id: "crumb.new", label: "New onboarding" }]}
      />
      <Heading id="heading.new-onboarding" text="Start a new onboarding" />
      <Section id="section.new-onboarding-form" title="New hire" subtitle="Tasks are pre-populated from the standard department templates.">
        <Form
          id="form.new-onboarding"
          onSubmit={submit}
          actions={<Button id="btn.create-onboarding" label="Create onboarding" emphasis="primary" submit />}
        >
          <Field
            id="field.new-hire-name"
            label="New hire name"
            name="newHireName"
            required
            error={state === "state.validation-error" ? "Enter the new hire's name" : undefined}
          />
          <Field
            id="field.start-date"
            label="Start date"
            name="startDate"
            type="date"
            required
            defaultValue={today}
            error={state === "state.validation-error" ? "Choose a start date" : undefined}
          />
        </Form>
      </Section>
    </Shell>
  );
}

function OnboardingDetail() {
  const { record: recordId } = useParams();
  const state = useDisplayState();
  const records = useCollection<OnboardingRecord>("onboardingRecords");
  const taskList = useCollection<Task>("tasks");
  const today = useToday();
  const record = (recordId ? records.get(recordId) : undefined) ?? records.items[0]!;
  const recordTasks = taskList.items.filter((t) => t.onboardingRecordId === record.id);
  const [activeTab, setActiveTab] = useState("tab.it");
  const [addingTask, setAddingTask] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const departments: { id: string; label: string; key: Department }[] = [
    { id: "tab.it", label: "IT", key: "it" },
    { id: "tab.hr", label: "HR", key: "hr" },
    { id: "tab.facilities", label: "Facilities", key: "facilities" },
  ];

  const allComplete = recordTasks.length > 0 && recordTasks.every((t) => t.status === "complete");

  const renderDeptTable = (dept: Department) => {
    const deptTasks = state === "state.empty" ? [] : recordTasks.filter((t) => t.department === dept);
    return (
      <Table
        id={`table.tasks.${dept}`}
        columns={["Task", "Due date", { label: "Status", kind: "status" }]}
        rows={deptTasks.map((t) => ({
          id: `task.${t.id}`,
          cells: [t.name, t.dueDate],
          status: { text: statusText(t), tone: statusTone(t) },
          actions: [
            { id: `task.${t.id}.edit`, label: "Edit", onPress: () => setEditingTask(t) },
            { id: `task.${t.id}.remove`, label: "Remove", emphasis: "danger" as const, onPress: () => taskList.remove(t.id) },
          ],
        }))}
        empty={<EmptyState id={`empty.tasks.${dept}`} title="No tasks" text="Add a task for this department." />}
      />
    );
  };

  return (
    <Shell>
      <Breadcrumbs
        id="breadcrumbs.detail"
        items={[{ id: "crumb.dashboard2", label: "Dashboard", to: "screen.dashboard" }, { id: "crumb.record", label: record.newHireName }]}
      />
      <Heading
        id="heading.detail"
        text={record.newHireName}
        actions={
          <Button
            id="btn.mark-complete"
            label="Mark onboarding complete"
            emphasis="primary"
            disabled={!allComplete || record.status === "complete"}
            onPress={() => records.update(record.id, { status: "complete" })}
          />
        }
      />
      {state === "state.failed" && (
        <Alert id="alert.detail-failed" tone="error" title="Could not save changes" text="Try the action again in a few minutes." />
      )}
      <Detail
        id="detail.record"
        fields={[
          { label: "Start date", value: record.startDate },
          { label: "Status", value: record.status === "complete" ? "Complete" : "In progress" },
          { label: "Created", value: record.createdAt },
        ]}
      />
      <Section
        id="section.tasks"
        title="Tasks"
        subtitle="Tasks seeded from the standard templates; add, edit or remove exceptions here."
        actions={<Button id="btn.add-task" label="Add task" onPress={() => setAddingTask(true)} />}
      >
        <Tabs
          id="tabs.departments"
          tabs={departments.map((d) => ({ id: d.id, label: d.label, content: renderDeptTable(d.key) }))}
          active={activeTab}
          onChange={setActiveTab}
        />
      </Section>
      <Dialog id="dialog.add-task" title="Add a task" open={addingTask} onClose={() => setAddingTask(false)}>
        <Form
          id="form.add-task"
          onSubmit={(values) => {
            taskList.create({
              onboardingRecordId: record.id,
              department: values.department as Department,
              name: values.name,
              status: "pending",
              dueDate: values.dueDate,
              notes: values.notes ?? "",
              overdue: false,
            });
            setAddingTask(false);
          }}
          actions={<Button id="btn.add-task.confirm" label="Add task" emphasis="primary" submit />}
        >
          <Field id="field.add-task.department" label="Department" name="department" type="select" options={["it", "hr", "facilities"]} required defaultValue="it" />
          <Field
            id="field.add-task.name"
            label="Task name"
            name="name"
            required
            error={state === "state.validation-error" ? "Enter a task name" : undefined}
          />
          <Field id="field.add-task.due-date" label="Due date" name="dueDate" type="date" required defaultValue={today} />
          <Field id="field.add-task.notes" label="Notes" name="notes" type="textarea" />
        </Form>
      </Dialog>
      <Dialog
        id="dialog.edit-task"
        title={editingTask ? `Edit ${editingTask.name}` : "Edit task"}
        open={editingTask !== null}
        onClose={() => setEditingTask(null)}
      >
        {editingTask && (
          <Form
            id="form.edit-task"
            onSubmit={(values) => {
              taskList.update(editingTask.id, { name: values.name, dueDate: values.dueDate, notes: values.notes, status: values.status });
              setEditingTask(null);
            }}
            actions={<Button id="btn.edit-task.confirm" label="Save" emphasis="primary" submit />}
          >
            <Field id="field.edit-task.name" label="Task name" name="name" required defaultValue={editingTask.name} />
            <Field id="field.edit-task.due-date" label="Due date" name="dueDate" type="date" required defaultValue={editingTask.dueDate} />
            <Field id="field.edit-task.status" label="Status" name="status" type="select" options={["pending", "in-progress", "complete"]} defaultValue={editingTask.status} />
            <Field id="field.edit-task.notes" label="Notes" name="notes" type="textarea" defaultValue={editingTask.notes} />
          </Form>
        )}
      </Dialog>
    </Shell>
  );
}

function ItQueue() {
  const state = useDisplayState();
  const taskList = useCollection<Task>("tasks");
  const records = useCollection<OnboardingRecord>("onboardingRecords");
  const [statusFilter, setStatusFilter] = useState("all");
  const itTasks = state === "state.empty"
    ? []
    : taskList.items.filter((t) => t.department === "it" && (statusFilter === "all" || t.status === statusFilter));
  const overdueCount = taskList.items.filter((t) => t.department === "it" && t.overdue).length;
  const newHireName = (id: string) => records.get(id)?.newHireName ?? "Unknown";
  return (
    <Shell>
      <Heading id="heading.it-queue" text="IT tasks" />
      {state === "state.failed" && (
        <Alert id="alert.it-failed" tone="error" title="Could not load IT tasks" text="Try again in a few minutes." />
      )}
      <StatGroup>
        <Stat id="stat.it-overdue" label="Overdue" value={String(overdueCount)} hint="IT tasks past due" icon="TriangleAlert" tone="warning" />
      </StatGroup>
      <Section id="section.it-tasks" title="IT tasks" count={itTasks.length} subtitle="Tasks across every new hire.">
        <Filters id="filters.it-tasks">
          <Field id="field.it-status-filter" label="Status" type="select" options={["all", "pending", "in-progress", "complete"]} value={statusFilter} onChange={setStatusFilter} />
        </Filters>
        <Table
          id="table.it-tasks"
          columns={["New hire", "Task", "Due date", { label: "Status", kind: "status" }]}
          rows={itTasks.map((t) => ({
            id: `it-task.${t.id}`,
            cells: [newHireName(t.onboardingRecordId), t.name, t.dueDate],
            status: { text: statusText(t), tone: statusTone(t) },
            actions: t.status === "complete" ? [] : [
              { id: `it-task.${t.id}.start`, label: "Mark in-progress", onPress: () => taskList.update(t.id, { status: "in-progress" }) },
              { id: `it-task.${t.id}.complete`, label: "Mark complete", onPress: () => taskList.update(t.id, { status: "complete", overdue: false }) },
            ],
          }))}
          empty={<EmptyState id="empty.it-tasks" title="No IT tasks" text="Tasks appear here once a new onboarding starts." />}
        />
      </Section>
    </Shell>
  );
}

function FacilitiesQueue() {
  const state = useDisplayState();
  const taskList = useCollection<Task>("tasks");
  const records = useCollection<OnboardingRecord>("onboardingRecords");
  const [statusFilter, setStatusFilter] = useState("all");
  const facTasks = state === "state.empty"
    ? []
    : taskList.items.filter((t) => t.department === "facilities" && (statusFilter === "all" || t.status === statusFilter));
  const overdueCount = taskList.items.filter((t) => t.department === "facilities" && t.overdue).length;
  const newHireName = (id: string) => records.get(id)?.newHireName ?? "Unknown";
  return (
    <Shell>
      <Heading id="heading.facilities-queue" text="Facilities tasks" />
      {state === "state.failed" && (
        <Alert id="alert.facilities-failed" tone="error" title="Could not load Facilities tasks" text="Try again in a few minutes." />
      )}
      <StatGroup>
        <Stat id="stat.facilities-overdue" label="Overdue" value={String(overdueCount)} hint="Facilities tasks past due" icon="TriangleAlert" tone="warning" />
      </StatGroup>
      <Section id="section.facilities-tasks" title="Facilities tasks" count={facTasks.length} subtitle="Tasks across every new hire.">
        <Filters id="filters.facilities-tasks">
          <Field id="field.facilities-status-filter" label="Status" type="select" options={["all", "pending", "in-progress", "complete"]} value={statusFilter} onChange={setStatusFilter} />
        </Filters>
        <Table
          id="table.facilities-tasks"
          columns={["New hire", "Task", "Due date", { label: "Status", kind: "status" }]}
          rows={facTasks.map((t) => ({
            id: `facilities-task.${t.id}`,
            cells: [newHireName(t.onboardingRecordId), t.name, t.dueDate],
            status: { text: statusText(t), tone: statusTone(t) },
            actions: t.status === "complete" ? [] : [
              { id: `facilities-task.${t.id}.start`, label: "Mark in-progress", onPress: () => taskList.update(t.id, { status: "in-progress" }) },
              { id: `facilities-task.${t.id}.complete`, label: "Mark complete", onPress: () => taskList.update(t.id, { status: "complete", overdue: false }) },
            ],
          }))}
          empty={<EmptyState id="empty.facilities-tasks" title="No Facilities tasks" text="Tasks appear here once a new onboarding starts." />}
        />
      </Section>
    </Shell>
  );
}

function Templates() {
  const state = useDisplayState();
  const templates = useCollection<TaskTemplate>("taskTemplates");
  const [addingTemplate, setAddingTemplate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(null);
  const rows = state === "state.empty" ? [] : templates.items;
  return (
    <Shell>
      <Heading
        id="heading.templates"
        text="Task templates"
        actions={<Button id="btn.new-template" label="New template" emphasis="primary" onPress={() => setAddingTemplate(true)} />}
      />
      {state === "state.failed" && (
        <Alert id="alert.templates-failed" tone="error" title="Could not save template" text="Try again in a few minutes." />
      )}
      <Section id="section.templates" title="Standard tasks" count={rows.length} subtitle="Applied automatically when a new onboarding record is created.">
        <Table
          id="table.templates"
          columns={["Department", "Task", { label: "Default due offset (days)", kind: "number" }]}
          rows={rows.map((t) => ({
            id: `template.${t.id}`,
            cells: [t.department, t.name, String(t.defaultDueOffsetDays)],
            actions: [
              { id: `template.${t.id}.edit`, label: "Edit", onPress: () => setEditingTemplate(t) },
              { id: `template.${t.id}.remove`, label: "Remove", emphasis: "danger" as const, onPress: () => templates.remove(t.id) },
            ],
          }))}
          empty={
            <EmptyState
              id="empty.templates"
              title="No task templates"
              text="New onboarding records start with an empty checklist."
              actions={<Button id="btn.empty-new-template" label="New template" emphasis="primary" onPress={() => setAddingTemplate(true)} />}
            />
          }
        />
      </Section>
      <Dialog id="dialog.add-template" title="New task template" open={addingTemplate} onClose={() => setAddingTemplate(false)}>
        <Form
          id="form.add-template"
          onSubmit={(values) => {
            templates.create({ department: values.department as Department, name: values.name, defaultDueOffsetDays: Number(values.defaultDueOffsetDays) });
            setAddingTemplate(false);
          }}
          actions={<Button id="btn.add-template.confirm" label="Create template" emphasis="primary" submit />}
        >
          <Field id="field.add-template.department" label="Department" name="department" type="select" options={["it", "hr", "facilities"]} required defaultValue="it" />
          <Field
            id="field.add-template.name"
            label="Task name"
            name="name"
            required
            error={state === "state.validation-error" ? "Enter a task name" : undefined}
          />
          <Field id="field.add-template.offset" label="Default due offset (days)" name="defaultDueOffsetDays" type="number" required defaultValue="0" />
        </Form>
      </Dialog>
      <Dialog
        id="dialog.edit-template"
        title={editingTemplate ? `Edit ${editingTemplate.name}` : "Edit template"}
        open={editingTemplate !== null}
        onClose={() => setEditingTemplate(null)}
      >
        {editingTemplate && (
          <Form
            id="form.edit-template"
            onSubmit={(values) => {
              templates.update(editingTemplate.id, { name: values.name, defaultDueOffsetDays: Number(values.defaultDueOffsetDays) });
              setEditingTemplate(null);
            }}
            actions={<Button id="btn.edit-template.confirm" label="Save" emphasis="primary" submit />}
          >
            <Field id="field.edit-template.name" label="Task name" name="name" required defaultValue={editingTemplate.name} />
            <Field id="field.edit-template.offset" label="Default due offset (days)" name="defaultDueOffsetDays" type="number" required defaultValue={String(editingTemplate.defaultDueOffsetDays)} />
          </Form>
        )}
      </Dialog>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail
        id="detail.account"
        fields={[
          { label: "Name", value: userNames[role] ?? "" },
          { label: "Email", value: userEmails[role] ?? "" },
          { label: "Role", value: userLabels[role] ?? "" },
        ]}
      />
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
        onSubmit={() => navigate.go(homeScreen[role] ?? "screen.dashboard")}
        actions={<Button id="btn.save-settings" label="Save settings" emphasis="primary" submit />}
      >
        <Field id="field.compact-view" label="Use compact task lists" type="switch" defaultValue="off" />
      </Form>
    </Shell>
  );
}

function SignedOut() {
  const role = useRole();
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to={homeScreen[role] ?? "screen.dashboard"} />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.dashboard": Dashboard,
    "screen.new-onboarding": NewOnboarding,
    "screen.onboarding-detail": OnboardingDetail,
    "screen.it-queue": ItQueue,
    "screen.facilities-queue": FacilitiesQueue,
    "screen.templates": Templates,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { onboardingRecords, tasks, taskTemplates },
});
