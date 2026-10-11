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
  Alert, AppShell, Breadcrumbs, Button, Detail, Dialog, EmptyState, Field, Filters, Form, Heading, Screen, Section,
  Stat, StatGroup, Table, Text, ValidationSummary, defineApp, useCollection, useDisplayState, useNav, useParams,
  useRole, useToday,
} from "@wso2/prototype-kit";

interface Line { date: string; category: string; amount: string; description: string }
interface Claim {
  id: string; employeeId: string; employee: string; managerId: string; status: string;
  submitted: string; reason: string; decidedBy: string; batchId: string; lines: Line[];
}
interface Employee { id: string; name: string; manager: string }
interface Batch { id: string; createdAt: string; createdBy: string; claimIds: string[] }

const categories = ["Meals", "Travel", "Accommodation", "Equipment", "Other"];

const claims: Claim[] = [
  { id: "c.1041", employeeId: "emp.erin", employee: "Erin Okafor", managerId: "emp.maya", status: "Draft", submitted: "", reason: "", decidedBy: "", batchId: "",
    lines: [{ date: "2026-01-12", category: "Meals", amount: "42.50", description: "Team lunch" }] },
  { id: "c.1042", employeeId: "emp.erin", employee: "Erin Okafor", managerId: "emp.maya", status: "Submitted", submitted: "2026-01-13", reason: "", decidedBy: "", batchId: "",
    lines: [{ date: "2026-01-09", category: "Travel", amount: "18.00", description: "Taxi to client" }, { date: "2026-01-09", category: "Meals", amount: "24.00", description: "Client dinner" }] },
  { id: "c.1043", employeeId: "emp.erin", employee: "Erin Okafor", managerId: "emp.maya", status: "Rejected", submitted: "2026-01-05", reason: "Missing detail on lunch", decidedBy: "Maya Fernando", batchId: "",
    lines: [{ date: "2026-01-04", category: "Meals", amount: "55.00", description: "Lunch" }] },
  { id: "c.1044", employeeId: "emp.erin", employee: "Erin Okafor", managerId: "emp.maya", status: "Approved", submitted: "2026-01-03", reason: "", decidedBy: "Maya Fernando", batchId: "",
    lines: [{ date: "2026-01-02", category: "Equipment", amount: "120.00", description: "USB-C dock" }] },
  { id: "c.1045", employeeId: "emp.erin", employee: "Erin Okafor", managerId: "emp.maya", status: "Exported", submitted: "2025-12-20", reason: "", decidedBy: "Maya Fernando", batchId: "b.1",
    lines: [{ date: "2025-12-18", category: "Travel", amount: "210.40", description: "Train to Leeds" }] },
  { id: "c.1050", employeeId: "emp.ravi", employee: "Ravi Perera", managerId: "emp.maya", status: "Submitted", submitted: "2026-01-10", reason: "", decidedBy: "", batchId: "",
    lines: [{ date: "2026-01-08", category: "Accommodation", amount: "148.20", description: "Hotel, one night" }] },
  { id: "c.1051", employeeId: "emp.ana", employee: "Ana Silva", managerId: "emp.maya", status: "Submitted", submitted: "2026-01-12", reason: "", decidedBy: "", batchId: "",
    lines: [{ date: "2026-01-11", category: "Meals", amount: "62.00", description: "Workshop catering" }] },
  { id: "c.1052", employeeId: "emp.ana", employee: "Ana Silva", managerId: "emp.maya", status: "Approved", submitted: "2026-01-06", reason: "", decidedBy: "Maya Fernando", batchId: "",
    lines: [{ date: "2026-01-05", category: "Travel", amount: "310.00", description: "Flight to Dublin" }] },
  { id: "c.1053", employeeId: "emp.ravi", employee: "Ravi Perera", managerId: "emp.maya", status: "Rejected", submitted: "2026-01-02", reason: "Personal expense", decidedBy: "Maya Fernando", batchId: "",
    lines: [{ date: "2026-01-01", category: "Other", amount: "35.00", description: "Gift" }] },
  { id: "c.1060", employeeId: "emp.dan", employee: "Dan Fonseca", managerId: "emp.other", status: "Submitted", submitted: "2026-01-11", reason: "", decidedBy: "", batchId: "",
    lines: [{ date: "2026-01-10", category: "Meals", amount: "30.00", description: "Lunch" }] },
];

const employees: Employee[] = [
  { id: "emp.erin", name: "Erin Okafor", manager: "Maya Fernando" },
  { id: "emp.ravi", name: "Ravi Perera", manager: "Maya Fernando" },
  { id: "emp.ana", name: "Ana Silva", manager: "Maya Fernando" },
  { id: "emp.dan", name: "Dan Fonseca", manager: "Priya Raman" },
  { id: "emp.new", name: "Lee Chen", manager: "" },
];

const batches: Batch[] = [{ id: "b.1", createdAt: "2026-01-02", createdBy: "Fiona Perera", claimIds: ["c.1045"] }];

const users: Record<string, { name: string; email: string; id: string }> = {
  Employee: { name: "Erin Okafor", email: "erin@acme.example", id: "emp.erin" },
  Manager: { name: "Maya Fernando", email: "maya@acme.example", id: "emp.maya" },
  PayrollExporter: { name: "Fiona Perera", email: "fiona@acme.example", id: "emp.fiona" },
};

const total = (c: Claim) => c.lines.reduce((s, l) => s + parseFloat(l.amount), 0).toFixed(2);
const tone = (s: string) =>
  s === "Approved" ? "success" : s === "Rejected" ? "error" : s === "Submitted" ? "warning" : s === "Exported" ? "info" : "default";
const statusOf = (c: Claim) => ({ text: c.status, tone: tone(c.status) as "success" | "error" | "warning" | "info" | "default" });

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  const user = users[role] ?? users.Employee!;
  return (
    <AppShell
      id="shell"
      user={{ name: user.name, email: user.email }}
      nav={[
        { id: "nav.my-claims", label: "My claims", to: "screen.my-claims" },
        { id: "nav.team-queue", label: "Team queue", to: "screen.team-queue" },
        { id: "nav.team-history", label: "Decided claims", to: "screen.team-history" },
        { id: "nav.approved", label: "Approved claims", to: "screen.approved" },
        { id: "nav.batches", label: "Export batches", to: "screen.batches" },
        { id: "nav.employees", label: "Reporting lines", to: "screen.employees" },
      ]}
      account="screen.account"
      signOut="screen.signed-out"
    >
      {children}
    </AppShell>
  );
}

function FailedAlert() {
  return useDisplayState() === "state.failed" ? (
    <Alert id="alert.failed" tone="error" title="Claims unavailable" text="The claims service did not respond. Try again in a few minutes." />
  ) : null;
}

function LinesTable({ id, claim }: { id: string; claim: Claim }) {
  return (
    <Table
      id={id}
      columns={["Date", "Category", "Description", { label: "Amount", kind: "number" }]}
      rows={claim.lines.map((l, i) => ({ id: `${id}.${i}`, cells: [l.date, l.category, l.description, l.amount] }))}
    />
  );
}

function MyClaims() {
  const state = useDisplayState();
  const role = useRole();
  const all = useCollection<Claim>("claims");
  const me = users[role]!.id;
  const mine = state === "state.empty" ? [] : all.items.filter((c) => c.employeeId === me);
  return (
    <Shell>
      <Heading id="heading.my-claims" text="My claims" />
      <FailedAlert />
      <StatGroup>
        <Stat id="stat.drafts" label="Drafts" value={String(mine.filter((c) => c.status === "Draft").length)} hint="not yet submitted" icon="FileText" />
        <Stat id="stat.pending" label="Awaiting decision" value={String(mine.filter((c) => c.status === "Submitted").length)} hint="with your manager" icon="Hourglass" tone="warning" />
        <Stat id="stat.rejected" label="Rejected" value={String(mine.filter((c) => c.status === "Rejected").length)} hint="to fix and resubmit" icon="CircleX" tone="error" />
      </StatGroup>
      <Section id="section.my-claims" title="Claims" count={mine.length} subtitle="Only your own claims."
        actions={<Button id="btn.new-claim" label="New claim" emphasis="primary" to="screen.claim-edit" />}>
        <Table
          id="table.my-claims"
          columns={["Claim", { label: "Total", kind: "number" }, "Submitted", { label: "Status", kind: "status" }]}
          rows={mine.map((c) => ({ id: `claim.${c.id}`, cells: [c.id, total(c), c.submitted || "Not submitted"], status: statusOf(c), to: "screen.claim-detail", params: { claim: c.id } }))}
          empty={<EmptyState id="empty.my-claims" title="No claims yet" text="Create a claim to get reimbursed." />}
        />
      </Section>
    </Shell>
  );
}

function ClaimEdit() {
  const { claim: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const role = useRole();
  const today = useToday();
  const all = useCollection<Claim>("claims");
  const existing = id ? all.get(id) : undefined;
  const [lines, setLines] = useState<Line[]>(existing ? existing.lines : []);
  const me = users[role]!;
  const save = (submit: boolean) => {
    if (lines.length === 0) return;
    const status = submit ? "Submitted" : "Draft";
    const submitted = submit ? today : "";
    let target = existing?.id;
    if (existing) all.update(existing.id, { lines, status, submitted, reason: "" });
    else target = all.create({ employeeId: me.id, employee: me.name, managerId: "emp.maya", status, submitted, reason: "", decidedBy: "", batchId: "", lines });
    navigate.go("screen.claim-detail", target ? { claim: target } : {});
  };
  return (
    <Shell>
      <Breadcrumbs id="crumbs.edit" items={[{ id: "crumb.claims", label: "My claims", to: "screen.my-claims" }, { id: "crumb.edit", label: existing ? `Edit ${existing.id}` : "New claim" }]} />
      <Heading id="heading.edit" text={existing ? `Edit claim ${existing.id}` : "New claim"} />
      <Section id="section.lines" title="Expense lines" count={lines.length} subtitle="Add at least one line. Amounts are in the company currency.">
        {state === "state.validation-error" && (
          <ValidationSummary id="summary.lines" issues={["Add at least one expense line", "Amount must be greater than zero"]} />
        )}
        <Table
          id="table.lines"
          columns={["Date", "Category", "Description", { label: "Amount", kind: "number" }]}
          rows={lines.map((l, i) => ({
            id: `line.${i}`, cells: [l.date, l.category, l.description, l.amount],
            actions: [{ id: `line.${i}.remove`, label: "Remove", emphasis: "danger" as const, onPress: () => setLines(lines.filter((_, j) => j !== i)) }],
          }))}
          empty={<EmptyState id="empty.lines" title="No lines yet" text="Add the first expense below." />}
        />
      </Section>
      <Form
        id="form.line"
        title="Add an expense line"
        onSubmit={(v) => setLines([...lines, { date: v.date ?? "", category: v.category ?? "Meals", amount: v.amount ?? "0", description: v.description ?? "" }])}
        actions={<Button id="btn.add-line" label="Add line" submit />}
      >
        <Field id="field.date" name="date" label="Date" type="date" required defaultValue="2026-01-14" />
        <Field id="field.category" name="category" label="Category" type="select" options={categories} defaultValue="Meals" />
        <Field id="field.amount" name="amount" label="Amount" type="number" required
          error={state === "state.validation-error" ? "Enter an amount greater than zero" : undefined} />
        <Field id="field.description" name="description" label="Description" required />
      </Form>
      <Section id="section.actions" title="Finish">
        <Button id="btn.save-draft" label="Save draft" onPress={() => save(false)} />
        <Button id="btn.submit" label="Submit for approval" emphasis="primary" onPress={() => save(true)} />
      </Section>
    </Shell>
  );
}

function ClaimDetail() {
  const { claim: id } = useParams();
  const role = useRole();
  const today = useToday();
  const all = useCollection<Claim>("claims");
  const me = users[role]!.id;
  const claim = (id ? all.get(id) : undefined) ?? all.items.find((c) => c.employeeId === me) ?? all.items[0]!;
  return (
    <Shell>
      <Breadcrumbs id="crumbs.detail" items={[{ id: "crumb.claims", label: "My claims", to: "screen.my-claims" }, { id: "crumb.detail", label: claim.id }]} />
      <Heading id="heading.detail" text={`Claim ${claim.id}`} />
      {claim.status === "Rejected" && (
        <Alert id="alert.rejected" tone="error" title="Rejected" text={`Reason: ${claim.reason}`} />
      )}
      <Detail id="detail.claim" fields={[
        { label: "Status", value: claim.status },
        { label: "Total", value: total(claim) },
        { label: "Submitted", value: claim.submitted || "Not submitted" },
        { label: "Decided by", value: claim.decidedBy || "Not decided" },
      ]} />
      <LinesTable id="table.detail-lines" claim={claim} />
      {(claim.status === "Draft" || claim.status === "Rejected") && (
        <>
          <Button id="btn.edit" label={claim.status === "Rejected" ? "Edit and resubmit" : "Edit draft"} to="screen.claim-edit" params={{ claim: claim.id }} />
          <Button id="btn.submit" label="Submit for approval" emphasis="primary" onPress={() => all.update(claim.id, { status: "Submitted", submitted: today, reason: "" })} />
        </>
      )}
      {claim.status === "Submitted" && (
        <Button id="btn.withdraw" label="Withdraw claim" emphasis="danger" onPress={() => all.update(claim.id, { status: "Draft", submitted: "" })} />
      )}
    </Shell>
  );
}

function TeamQueue() {
  const state = useDisplayState();
  const all = useCollection<Claim>("claims");
  const waiting = state === "state.empty" ? [] : all.items.filter((c) => c.managerId === "emp.maya" && c.status === "Submitted");
  return (
    <Shell>
      <Heading id="heading.queue" text="Team queue" />
      <FailedAlert />
      <StatGroup>
        <Stat id="stat.waiting" label="Awaiting you" value={String(waiting.length)} hint="claims to decide" icon="Inbox" tone="warning" />
      </StatGroup>
      <Section id="section.queue" title="Submitted claims" count={waiting.length} subtitle="Direct reports only, oldest first.">
        <Table
          id="table.queue"
          columns={["Employee", "Claim", { label: "Total", kind: "number" }, "Submitted", { label: "Status", kind: "status" }]}
          rows={waiting.map((c) => ({
            id: `team.${c.id}`, cells: [c.employee, c.id, total(c), c.submitted], status: statusOf(c),
            to: "screen.team-claim", params: { claim: c.id },
            actions: [{ id: `team.${c.id}.approve`, label: "Approve", onPress: () => all.update(c.id, { status: "Approved", decidedBy: "Maya Fernando" }) }],
          }))}
          empty={<EmptyState id="empty.queue" title="Nothing to decide" text="Submitted claims from your team appear here." />}
        />
      </Section>
    </Shell>
  );
}

function TeamClaim() {
  const { claim: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<Claim>("claims");
  const [rejecting, setRejecting] = useState(false);
  const claim = (id ? all.get(id) : undefined) ?? all.items.find((c) => c.managerId === "emp.maya" && c.status === "Submitted") ?? all.items[0]!;
  const open = claim.status === "Submitted";
  const decide = (patch: Partial<Omit<Claim, "id">>) => {
    all.update(claim.id, { ...patch, decidedBy: "Maya Fernando" });
    navigate.go("screen.team-queue");
  };
  return (
    <Shell>
      <Breadcrumbs id="crumbs.team" items={[{ id: "crumb.queue", label: "Team queue", to: "screen.team-queue" }, { id: "crumb.claim", label: claim.id }]} />
      <Heading id="heading.team-claim" text={`Claim ${claim.id} from ${claim.employee}`} />
      <Detail id="detail.team-claim" fields={[
        { label: "Submitter", value: claim.employee },
        { label: "Total", value: total(claim) },
        { label: "Submitted", value: claim.submitted || "Not submitted" },
        { label: "Status", value: claim.status },
      ]} />
      <LinesTable id="table.team-lines" claim={claim} />
      <Button id="btn.approve" label="Approve" emphasis="primary" disabled={!open} onPress={() => decide({ status: "Approved" })} />
      <Button id="btn.reject" label="Reject" emphasis="danger" disabled={!open} onPress={() => setRejecting(true)} />
      <Dialog id="dialog.reject" title={`Reject claim ${claim.id}`} open={rejecting} onClose={() => setRejecting(false)}>
        <Form id="form.reject" onSubmit={(v) => decide({ status: "Rejected", reason: v.reason ?? "" })}
          actions={<Button id="btn.reject-confirm" label="Reject claim" emphasis="danger" submit />}>
          <Field id="field.reason" name="reason" label="Reason" type="textarea" required
            error={state === "state.validation-error" ? "Give the employee a reason" : undefined} />
        </Form>
      </Dialog>
    </Shell>
  );
}

function TeamHistory() {
  const state = useDisplayState();
  const all = useCollection<Claim>("claims");
  const decided = state === "state.empty" ? [] : all.items.filter((c) => c.decidedBy === "Maya Fernando" && (c.status === "Approved" || c.status === "Rejected"));
  return (
    <Shell>
      <Heading id="heading.history" text="Decided claims" />
      <Section id="section.history" title="Your decisions" count={decided.length}>
        <Table
          id="table.history"
          columns={["Employee", "Claim", { label: "Total", kind: "number" }, "Reason", { label: "Decision", kind: "status" }]}
          rows={decided.map((c) => ({ id: `done.${c.id}`, cells: [c.employee, c.id, total(c), c.reason || "-"], status: statusOf(c), to: "screen.team-claim", params: { claim: c.id } }))}
          empty={<EmptyState id="empty.history" title="No decisions yet" text="Claims you approve or reject appear here." />}
        />
      </Section>
    </Shell>
  );
}

function Approved() {
  const state = useDisplayState();
  const navigate = useNav();
  const today = useToday();
  const all = useCollection<Claim>("claims");
  const made = useCollection<Batch>("batches");
  const [picked, setPicked] = useState<string[]>([]);
  const ready = state === "state.empty" ? [] : all.items.filter((c) => c.status === "Approved");
  const exportPicked = () => {
    if (picked.length === 0) return;
    const batch = made.create({ createdAt: today, createdBy: "Fiona Perera", claimIds: picked });
    picked.forEach((cid) => all.update(cid, { status: "Exported", batchId: batch }));
    setPicked([]);
    navigate.go("screen.batch-detail", { batch });
  };
  return (
    <Shell>
      <Heading id="heading.approved" text="Approved claims" />
      <FailedAlert />
      <StatGroup>
        <Stat id="stat.ready" label="Ready to export" value={String(ready.length)} hint="approved, not exported" icon="Wallet" tone="info" />
        <Stat id="stat.picked" label="Selected" value={String(picked.length)} hint="for the next batch" icon="ListChecks" />
      </StatGroup>
      <Section id="section.approved" title="Approved, not yet exported" count={ready.length} subtitle="Select claims, then export them as one batch."
        actions={<Button id="btn.export" label="Export selected" emphasis="primary" disabled={picked.length === 0} onPress={exportPicked} />}>
        <Table
          id="table.approved"
          columns={["Employee", "Claim", { label: "Total", kind: "number" }, { label: "Selection", kind: "status" }]}
          rows={ready.map((c) => {
            const on = picked.includes(c.id);
            return {
              id: `ready.${c.id}`, cells: [c.employee, c.id, total(c)],
              status: { text: on ? "Selected" : "Not selected", tone: on ? ("info" as const) : ("default" as const) },
              actions: [{ id: `ready.${c.id}.toggle`, label: on ? "Unselect" : "Select", onPress: () => setPicked(on ? picked.filter((p) => p !== c.id) : [...picked, c.id]) }],
            };
          })}
          empty={<EmptyState id="empty.approved" title="Nothing to export" text="Approved claims appear here." />}
        />
      </Section>
    </Shell>
  );
}

function Batches() {
  const state = useDisplayState();
  const made = useCollection<Batch>("batches");
  const [downloaded, setDownloaded] = useState("");
  const list = state === "state.empty" ? [] : made.items;
  return (
    <Shell>
      <Heading id="heading.batches" text="Export batches" />
      {state === "state.failed" && <Alert id="alert.csv-failed" tone="error" title="Export unavailable" text="The CSV could not be generated. Try again shortly." />}
      {downloaded !== "" && <Alert id="alert.downloaded" tone="success" text={`CSV for batch ${downloaded} downloaded.`} />}
      <Section id="section.batches" title="Past batches" count={list.length}>
        <Table
          id="table.batches"
          columns={["Batch", "Exported", "Exported by", { label: "Claims", kind: "number" }]}
          rows={list.map((b) => ({
            id: `batch.${b.id}`, cells: [b.id, b.createdAt, b.createdBy, String(b.claimIds.length)],
            to: "screen.batch-detail", params: { batch: b.id },
            actions: [{ id: `batch.${b.id}.download`, label: "Download CSV", onPress: () => setDownloaded(b.id) }],
          }))}
          empty={<EmptyState id="empty.batches" title="No batches yet" text="Exported batches appear here." />}
        />
      </Section>
    </Shell>
  );
}

function BatchDetail() {
  const { batch: id } = useParams();
  const made = useCollection<Batch>("batches");
  const all = useCollection<Claim>("claims");
  const [done, setDone] = useState(false);
  const batch = (id ? made.get(id) : undefined) ?? made.items[0]!;
  const rows = all.items.filter((c) => batch.claimIds.includes(c.id));
  return (
    <Shell>
      <Breadcrumbs id="crumbs.batch" items={[{ id: "crumb.batches", label: "Export batches", to: "screen.batches" }, { id: "crumb.batch", label: batch.id }]} />
      <Heading id="heading.batch" text={`Batch ${batch.id}`}
        actions={<Button id="btn.download" label="Download CSV" emphasis="primary" onPress={() => setDone(true)} />} />
      {done && <Alert id="alert.done" tone="success" text="CSV downloaded: one row per claim." />}
      <Detail id="detail.batch" fields={[{ label: "Exported", value: batch.createdAt }, { label: "Exported by", value: batch.createdBy }, { label: "Claims", value: String(rows.length) }]} />
      <Table
        id="table.batch-claims"
        columns={["Employee", "Claim", { label: "Total", kind: "number" }, "Approved by"]}
        rows={rows.map((c) => ({ id: `bc.${c.id}`, cells: [c.employee, c.id, total(c), c.decidedBy] }))}
      />
    </Shell>
  );
}

function Employees() {
  const state = useDisplayState();
  const people = useCollection<Employee>("employees");
  const [editing, setEditing] = useState("");
  const list = state === "state.empty" ? [] : people.items;
  const target = people.get(editing);
  const managers = people.items.map((p) => p.name);
  return (
    <Shell>
      <Heading id="heading.employees" text="Reporting lines" />
      <Alert id="alert.assumed" tone="info" text="People appear here once they have opened the app. Finance sets each person's manager; it is not taken from the sign-in directory." />
      <Section id="section.employees" title="Employees" count={list.length}>
        <Filters id="filters.employees">
          <Field id="field.search" label="Search" placeholder="Name" />
        </Filters>
        <Table
          id="table.employees"
          columns={["Employee", "Manager"]}
          rows={list.map((e) => ({
            id: `emp.${e.id}`, cells: [e.name, e.manager || "Not set"],
            actions: [{ id: `emp.${e.id}.change`, label: "Set manager", onPress: () => setEditing(e.id) }],
          }))}
          empty={<EmptyState id="empty.employees" title="No employees" text="Employees appear after they first sign in." />}
        />
      </Section>
      <Dialog id="dialog.manager" title={target ? `Manager for ${target.name}` : "Manager"} open={editing !== ""} onClose={() => setEditing("")}>
        <Form id="form.manager" onSubmit={(v) => { people.update(editing, { manager: v.manager ?? "" }); setEditing(""); }}
          actions={<Button id="btn.save-manager" label="Save" emphasis="primary" submit />}>
          <Field id="field.manager" name="manager" label="Manager" type="select" options={managers} required
            error={state === "state.validation-error" ? "Choose a manager" : undefined} />
        </Form>
      </Dialog>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const user = users[role]!;
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail id="detail.account" fields={[{ label: "Name", value: user.name }, { label: "Email", value: user.email }, { label: "Role", value: role }]} />
      <Text id="text.signin" text="You sign in through your organisation's single sign-on." />
    </Shell>
  );
}


function SignedOut() {
  const role = useRole();
  const home = role === "PayrollExporter" ? "screen.approved" : "screen.my-claims";
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to={home} />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.my-claims": MyClaims,
    "screen.claim-edit": ClaimEdit,
    "screen.claim-detail": ClaimDetail,
    "screen.team-queue": TeamQueue,
    "screen.team-claim": TeamClaim,
    "screen.team-history": TeamHistory,
    "screen.approved": Approved,
    "screen.batches": Batches,
    "screen.batch-detail": BatchDetail,
    "screen.employees": Employees,
    "screen.account": Account,
    "screen.signed-out": SignedOut,
  },
  data: { claims, employees, batches },
});
