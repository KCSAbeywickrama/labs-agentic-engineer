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

// A design agent's /address-comments run (playground acme-address-pass6): a
// comment renamed `Claim.totalAmountCents` to `totalCents`, the agent renamed
// it by separate edits, and one use survived in MyClaims. It transpiles and
// draws (the stale read is `undefined`, shown as "$NaN"); only its types are wrong.

import { useState, type ReactNode } from "react";
import {
  Alert, AppShell, Badge, Button, Detail, Dialog, EmptyState, Field, Form, Heading, Screen, Section,
  Stat, StatGroup, Table, Timeline, ValidationSummary, defineApp, useCollection, useDisplayState,
  useNav, useParams, useRole, useToday,
} from "@wso2/prototype-kit";

interface Employee {
  id: string; name: string; email: string;
  managerId: string | null; deputyId: string | null; onLeave: boolean;
}
interface Claim {
  id: string; employeeId: string; status: "draft" | "submitted" | "manager_approved" | "finance_approved" | "rejected" | "paid";
  submittedAt: string; totalCents: number;
}
interface Expense {
  id: string; claimId: string; category: "meals" | "travel" | "supplies";
  amountCents: number; date: string; description: string;
  startLocation?: string; endLocation?: string; distanceMiles?: number;
  receiptId?: string;
}
interface Receipt {
  id: string; expenseId: string; imageUrl: string;
  extractedAmountCents: number | null; extractedDate: string | null;
}
interface Approval {
  id: string; claimId: string; approverId: string; level: "manager" | "finance";
  action: "approved" | "rejected"; reason: string | null; decidedAt: string;
}

const employees: Employee[] = [
  { id: "emp-maya", name: "Maya Fernando", email: "maya@acme.example", managerId: "emp-ravi", deputyId: null, onLeave: false },
  { id: "emp-tom", name: "Tom Bandara", email: "tom@acme.example", managerId: "emp-ravi", deputyId: null, onLeave: false },
  { id: "emp-ravi", name: "Ravi Perera", email: "ravi@acme.example", managerId: "emp-priya", deputyId: "emp-dinesh", onLeave: false },
  { id: "emp-dinesh", name: "Dinesh Kumar", email: "dinesh@acme.example", managerId: "emp-priya", deputyId: null, onLeave: false },
  { id: "emp-priya", name: "Priya Nair", email: "priya@acme.example", managerId: null, deputyId: null, onLeave: false },
  { id: "emp-ana", name: "Ana Silva", email: "ana@acme.example", managerId: null, deputyId: null, onLeave: false },
];

const claims: Claim[] = [
  { id: "claim-1042", employeeId: "emp-maya", status: "submitted", submittedAt: "2026-01-08", totalCents: 14820 },
  { id: "claim-1039", employeeId: "emp-maya", status: "paid", submittedAt: "2026-01-02", totalCents: 6200 },
  { id: "claim-1031", employeeId: "emp-tom", status: "manager_approved", submittedAt: "2026-01-06", totalCents: 120000 },
  { id: "claim-1050", employeeId: "emp-ravi", status: "draft", submittedAt: "", totalCents: 4500 },
];

const expenses: Expense[] = [
  { id: "exp-1", claimId: "claim-1042", category: "travel", amountCents: 670, date: "2026-01-08", description: "Client site visit", startLocation: "Acme HQ", endLocation: "Riverside Client Office", distanceMiles: 10 },
  { id: "exp-2", claimId: "claim-1042", category: "meals", amountCents: 4200, date: "2026-01-08", description: "Lunch with client", receiptId: "receipt-2" },
  { id: "exp-3", claimId: "claim-1042", category: "supplies", amountCents: 9950, date: "2026-01-07", description: "Printer paper and pens", receiptId: "receipt-3" },
  { id: "exp-4", claimId: "claim-1039", category: "meals", amountCents: 6200, date: "2026-01-02", description: "Team lunch", receiptId: "receipt-4" },
  { id: "exp-5", claimId: "claim-1031", category: "travel", amountCents: 120000, date: "2026-01-06", description: "Flight to supplier conference", receiptId: "receipt-5" },
  { id: "exp-6", claimId: "claim-1050", category: "supplies", amountCents: 4500, date: "2026-01-12", description: "Replacement laptop charger" },
];

const receipts: Receipt[] = [
  { id: "receipt-2", expenseId: "exp-2", imageUrl: "receipt-1042-2.jpg", extractedAmountCents: 4200, extractedDate: "2026-01-08" },
  { id: "receipt-3", expenseId: "exp-3", imageUrl: "receipt-1042-3.jpg", extractedAmountCents: 9950, extractedDate: "2026-01-07" },
  { id: "receipt-4", expenseId: "exp-4", imageUrl: "receipt-1039-4.jpg", extractedAmountCents: 6200, extractedDate: "2026-01-02" },
  { id: "receipt-5", expenseId: "exp-5", imageUrl: "receipt-1031-5.jpg", extractedAmountCents: null, extractedDate: null },
];

const approvals: Approval[] = [
  { id: "approval-1", claimId: "claim-1031", approverId: "emp-ravi", level: "manager", action: "approved", reason: null, decidedAt: "2026-01-07" },
  { id: "approval-2", claimId: "claim-1039", approverId: "emp-ravi", level: "manager", action: "approved", reason: null, decidedAt: "2026-01-03" },
];

const MEAL_CAP_CENTS = 5000;
const RECEIPT_REQUIRED_OVER_CENTS = 2500;

const roleUser: Record<string, { employeeId: string; name: string; email: string }> = {
  Employee: { employeeId: "emp-maya", name: "Maya Fernando", email: "maya@acme.example" },
  Manager: { employeeId: "emp-ravi", name: "Ravi Perera", email: "ravi@acme.example" },
  Finance: { employeeId: "emp-ana", name: "Ana Silva", email: "ana@acme.example" },
};

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function statusTone(status: Claim["status"]): "default" | "info" | "success" | "warning" | "error" {
  if (status === "paid" || status === "finance_approved" || status === "manager_approved") return "success";
  if (status === "rejected") return "error";
  if (status === "submitted") return "warning";
  return "default";
}

function statusLabel(status: Claim["status"]): string {
  return { draft: "Draft", submitted: "Awaiting manager", manager_approved: "Awaiting finance", finance_approved: "Approved", rejected: "Rejected", paid: "Paid" }[status];
}

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  const user = roleUser[role] ?? roleUser.Employee;
  const nav = [
    { id: "nav.my-claims", label: "My claims", to: "screen.my-claims" },
    ...(role === "Manager" ? [{ id: "nav.team-queue", label: "Team approvals", to: "screen.team-queue" }] : []),
    ...(role === "Finance" ? [{ id: "nav.finance-queue", label: "Finance approvals", to: "screen.finance-queue" }] : []),
    ...(role === "Finance" ? [{ id: "nav.people", label: "People", to: "screen.people" }] : []),
  ];
  return (
    <AppShell id="shell" user={{ name: user.name, email: user.email, role }} nav={nav}
      account="screen.account" settings="screen.settings" signOut="screen.signed-out">
      {children}
    </AppShell>
  );
}

function MyClaims() {
  const state = useDisplayState();
  const role = useRole();
  const me = roleUser[role]?.employeeId ?? "emp-maya";
  const all = useCollection<Claim>("claims");
  const mine = state === "state.empty" ? [] : all.items.filter((c) => c.employeeId === me);
  return (
    <Shell>
      <Heading id="heading.my-claims" text="My claims"
        actions={<Button id="btn.new-claim" label="New expense" emphasis="primary" to="screen.new-claim" />} />
      <Section id="section.my-claims" title="Claims" count={mine.length} subtitle="Drafts, submitted claims and their decisions.">
        <Table
          id="table.my-claims"
          columns={["Submitted", { label: "Amount", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={mine.map((c) => ({
            id: `claim.${c.id}`,
            cells: [c.submittedAt || "Not yet submitted", money(c.totalAmountCents)],
            status: { text: statusLabel(c.status), tone: statusTone(c.status) },
            to: "screen.claim-detail",
            params: { claim: c.id },
          }))}
          empty={<EmptyState id="empty.my-claims" title="No claims yet" text="Start a new expense to build your first claim." actions={<Button id="btn.empty-new-claim" label="New expense" to="screen.new-claim" />} />}
        />
      </Section>
    </Shell>
  );
}

function NewClaim() {
  const state = useDisplayState();
  const role = useRole();
  const me = roleUser[role]?.employeeId ?? "emp-maya";
  const navigate = useNav();
  const claimsCol = useCollection<Claim>("claims");
  const expensesCol = useCollection<Expense>("expenses");
  const today = useToday();
  const [isMileage, setIsMileage] = useState(false);

  const draft = claimsCol.items.find((c) => c.employeeId === me && c.status === "draft");

  return (
    <Shell>
      <Heading id="heading.new-claim" text="New expense" />
      {state === "state.failed" && (
        <Alert id="alert.scan-failed" tone="error" title="Receipt scan failed" text="We could not read the amount or date. Fill them in yourself." />
      )}
      <Section id="section.new-expense" title="Expense details" subtitle="Receipts over $25 must have a photo attached. Meals are capped at $50 a day.">
        <Form
          id="form.new-expense"
          onSubmit={(values) => {
            const claimId = draft ? draft.id : claimsCol.create({ employeeId: me, status: "draft", submittedAt: "", totalCents: 0 });
            expensesCol.create({
              claimId,
              category: (values.category as Expense["category"]) ?? "meals",
              amountCents: Math.round(Number(values.amount || "0") * 100),
              date: values.date || today,
              description: values.description ?? "",
              ...(isMileage ? { startLocation: values.startLocation, endLocation: values.endLocation, distanceMiles: Number(values.distance || "0") } : {}),
            });
            navigate.go("screen.claim-detail", { claim: claimId });
          }}
          actions={<Button id="btn.save-expense" label="Save expense" emphasis="primary" submit />}
        >
          <Field id="field.category" label="Category" name="category" type="select" options={["meals", "travel", "supplies"]} defaultValue="meals" required />
          <Field id="field.description" label="Description" name="description" required placeholder="What was this for?" />
          <Field id="field.amount" label="Amount (USD)" name="amount" type="number" required />
          <Field id="field.date" label="Date" name="date" type="date" defaultValue={today} required />
          <Field id="field.receipt" label="Receipt photo" name="receipt" placeholder="receipt-photo.jpg"
            error={state === "state.validation-error" ? "A receipt is required for expenses over $25" : undefined} />
          <Field id="field.mileage-toggle" label="This is a mileage expense" type="switch"
            onChange={(v) => setIsMileage(v === "on")} />
          {isMileage && (
            <>
              <Field id="field.start-location" label="Start location" name="startLocation" />
              <Field id="field.end-location" label="End location" name="endLocation" />
              <Field id="field.distance" label="Distance (miles)" name="distance" type="number" />
            </>
          )}
          {state === "state.validation-error" && (
            <ValidationSummary id="summary.new-expense" issues={["A receipt is required for expenses over $25"]} />
          )}
        </Form>
      </Section>
    </Shell>
  );
}

function ClaimDetail() {
  const { claim: paramId } = useParams();
  const claimsCol = useCollection<Claim>("claims");
  const expensesCol = useCollection<Expense>("expenses");
  const approvalsCol = useCollection<Approval>("approvals");
  const employeesCol = useCollection<Employee>("employees");
  const navigate = useNav();
  const claim = (paramId ? claimsCol.get(paramId) : undefined) ?? claimsCol.items[0]!;
  const employee = employeesCol.get(claim.employeeId);
  const items = expensesCol.items.filter((e) => e.claimId === claim.id);
  const history = approvalsCol.items.filter((a) => a.claimId === claim.id);
  const mealsToday = items.filter((e) => e.category === "meals").reduce((sum, e) => sum + e.amountCents, 0);

  return (
    <Shell>
      <Heading id="heading.claim-detail" text={`Claim ${claim.id.replace("claim-", "")}`} />
      <Detail
        id="detail.claim"
        fields={[
          { label: "Employee", value: employee?.name ?? "Unknown" },
          { label: "Status", value: statusLabel(claim.status) },
          { label: "Total", value: money(claim.totalCents) },
        ]}
      />
      {mealsToday > MEAL_CAP_CENTS && (
        <Alert id="alert.meal-cap" tone="warning" title="Over the daily meal cap" text="Meals on this claim total more than $50 for one day; the approver will see this flagged." />
      )}
      <Section id="section.expenses" title="Expenses" count={items.length}>
        <Table
          id="table.expenses"
          columns={["Description", "Category", { label: "Amount", kind: "number" }]}
          rows={items.map((e) => ({
            id: `expense.${e.id}`,
            cells: [e.description, e.category, money(e.amountCents)],
          }))}
          empty={<EmptyState id="empty.expenses" title="No expenses yet" text="Add an expense to this claim." />}
        />
      </Section>
      {claim.status === "draft" && (
        <Button id="btn.submit-claim" label="Submit claim" emphasis="primary"
          onPress={() => { claimsCol.update(claim.id, { status: "submitted", submittedAt: "2026-01-15" }); navigate.go("screen.my-claims"); }} />
      )}
      {history.length > 0 && (
        <Timeline id="timeline.approvals" title="Approval history"
          entries={history.map((a) => ({ when: a.decidedAt, who: employeesCol.get(a.approverId)?.name ?? a.approverId, text: `${a.level === "finance" ? "Finance" : "Manager"} ${a.action}${a.reason ? `: ${a.reason}` : ""}` }))} />
      )}
    </Shell>
  );
}

function TeamQueue() {
  const state = useDisplayState();
  const claimsCol = useCollection<Claim>("claims");
  const employeesCol = useCollection<Employee>("employees");
  const expensesCol = useCollection<Expense>("expenses");
  const manager = employeesCol.get("emp-ravi")!;
  const team = employeesCol.items.filter((e) => e.managerId === manager.id || (manager.onLeave && e.managerId && employeesCol.get(e.managerId)?.deputyId === manager.id));
  const pending = state === "state.empty" ? [] : claimsCol.items.filter((c) => c.status === "submitted" && team.some((e) => e.id === c.employeeId));
  return (
    <Shell>
      <Heading id="heading.team-queue" text="Team approvals" />
      <StatGroup>
        <Stat id="stat.pending" label="Awaiting you" value={String(pending.length)} hint="claims to decide" icon="Inbox" tone="warning" />
      </StatGroup>
      <Section id="section.team-queue" title="Submitted claims" count={pending.length} subtitle="Oldest first.">
        <Table
          id="table.team-queue"
          columns={["Employee", { label: "Expenses", kind: "number" }, { label: "Amount", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={pending.map((c) => ({
            id: `claim.${c.id}`,
            cells: [
              employeesCol.get(c.employeeId)?.name ?? "Unknown",
              String(expensesCol.items.filter((e) => e.claimId === c.id).length),
              money(c.totalCents),
            ],
            status: { text: statusLabel(c.status), tone: statusTone(c.status) },
            to: "screen.team-claim-detail",
            params: { claim: c.id },
          }))}
          empty={<EmptyState id="empty.team-queue" title="Nothing to approve" text="New submitted claims appear here." />}
        />
      </Section>
    </Shell>
  );
}

function TeamClaimDetail() {
  const { claim: paramId } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const claimsCol = useCollection<Claim>("claims");
  const expensesCol = useCollection<Expense>("expenses");
  const employeesCol = useCollection<Employee>("employees");
  const approvalsCol = useCollection<Approval>("approvals");
  const [rejecting, setRejecting] = useState(false);
  const claim = (paramId ? claimsCol.get(paramId) : undefined) ?? claimsCol.items.find((c) => c.status === "submitted")!;
  const employee = employeesCol.get(claim.employeeId);
  const items = expensesCol.items.filter((e) => e.claimId === claim.id);

  const decide = (action: "approved" | "rejected", reason?: string) => {
    approvalsCol.create({ claimId: claim.id, approverId: "emp-ravi", level: "manager", action, reason: reason ?? null, decidedAt: "2026-01-15" });
    claimsCol.update(claim.id, { status: action === "approved" ? "manager_approved" : "rejected" });
    navigate.go("screen.team-queue");
  };

  return (
    <Shell>
      <Heading id="heading.team-claim-detail" text={`Review claim — ${employee?.name ?? "Unknown"}`} />
      <Detail id="detail.team-claim" fields={[{ label: "Employee", value: employee?.name ?? "Unknown" }, { label: "Total", value: money(claim.totalCents) }]} />
      <Section id="section.team-expenses" title="Expenses" count={items.length}>
        <Table
          id="table.team-expenses"
          columns={["Description", "Category", { label: "Amount", kind: "number" }]}
          rows={items.map((e) => ({ id: `expense.${e.id}`, cells: [e.description, e.category, money(e.amountCents)] }))}
        />
      </Section>
      {items.filter((e) => e.startLocation).map((e) => (
        <Detail key={e.id} id={`detail.mileage.${e.id}`} title="Mileage detail"
          fields={[{ label: "From", value: e.startLocation ?? "" }, { label: "To", value: e.endLocation ?? "" }, { label: "Distance", value: `${e.distanceMiles ?? 0} miles` }]} />
      ))}
      <Button id="btn.approve" label="Approve" emphasis="primary" onPress={() => decide("approved")} />
      <Button id="btn.reject" label="Reject" emphasis="danger" onPress={() => setRejecting(true)} />
      <Dialog id="dialog.reject" title="Reject this claim" open={rejecting} onClose={() => setRejecting(false)}>
        <Form id="form.reject" onSubmit={(values) => decide("rejected", values.reason)}
          actions={<Button id="btn.reject.confirm" label="Reject" emphasis="danger" submit />}>
          <Field id="field.reject-reason" label="Reason" name="reason" type="textarea" required
            error={state === "state.validation-error" ? "Give the employee a reason" : undefined} />
        </Form>
      </Dialog>
    </Shell>
  );
}

function FinanceQueue() {
  const state = useDisplayState();
  const claimsCol = useCollection<Claim>("claims");
  const employeesCol = useCollection<Employee>("employees");
  const pending = state === "state.empty" ? [] : claimsCol.items.filter((c) => c.status === "manager_approved" && c.totalCents > 100000);
  return (
    <Shell>
      <Heading id="heading.finance-queue" text="Finance approvals" />
      <Section id="section.finance-queue" title="Claims over $1,000" count={pending.length} subtitle="Already approved by a manager; awaiting your second approval.">
        <Table
          id="table.finance-queue"
          columns={["Employee", { label: "Amount", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={pending.map((c) => ({
            id: `claim.${c.id}`,
            cells: [employeesCol.get(c.employeeId)?.name ?? "Unknown", money(c.totalCents)],
            status: { text: statusLabel(c.status), tone: statusTone(c.status) },
            to: "screen.finance-claim-detail",
            params: { claim: c.id },
          }))}
          empty={<EmptyState id="empty.finance-queue" title="Nothing awaiting finance" text="Claims over $1,000 appear here once their manager approves them." />}
        />
      </Section>
    </Shell>
  );
}

function FinanceClaimDetail() {
  const { claim: paramId } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const claimsCol = useCollection<Claim>("claims");
  const expensesCol = useCollection<Expense>("expenses");
  const employeesCol = useCollection<Employee>("employees");
  const approvalsCol = useCollection<Approval>("approvals");
  const [rejecting, setRejecting] = useState(false);
  const claim = (paramId ? claimsCol.get(paramId) : undefined) ?? claimsCol.items.find((c) => c.status === "manager_approved")!;
  const employee = employeesCol.get(claim.employeeId);
  const items = expensesCol.items.filter((e) => e.claimId === claim.id);

  const decide = (action: "approved" | "rejected", reason?: string) => {
    approvalsCol.create({ claimId: claim.id, approverId: "emp-ana", level: "finance", action, reason: reason ?? null, decidedAt: "2026-01-15" });
    claimsCol.update(claim.id, { status: action === "approved" ? "finance_approved" : "rejected" });
    navigate.go("screen.finance-queue");
  };

  return (
    <Shell>
      <Heading id="heading.finance-claim-detail" text={`Review claim — ${employee?.name ?? "Unknown"}`} />
      <Detail id="detail.finance-claim" fields={[{ label: "Employee", value: employee?.name ?? "Unknown" }, { label: "Total", value: money(claim.totalCents) }]} />
      <Section id="section.finance-expenses" title="Expenses" count={items.length}>
        <Table
          id="table.finance-expenses"
          columns={["Description", "Category", { label: "Amount", kind: "number" }]}
          rows={items.map((e) => ({ id: `expense.${e.id}`, cells: [e.description, e.category, money(e.amountCents)] }))}
        />
      </Section>
      <Button id="btn.finance-approve" label="Give second approval" emphasis="primary" onPress={() => decide("approved")} />
      <Button id="btn.finance-reject" label="Reject" emphasis="danger" onPress={() => setRejecting(true)} />
      <Dialog id="dialog.finance-reject" title="Reject this claim" open={rejecting} onClose={() => setRejecting(false)}>
        <Form id="form.finance-reject" onSubmit={(values) => decide("rejected", values.reason)}
          actions={<Button id="btn.finance-reject.confirm" label="Reject" emphasis="danger" submit />}>
          <Field id="field.finance-reject-reason" label="Reason" name="reason" type="textarea" required
            error={state === "state.validation-error" ? "Give the employee a reason" : undefined} />
        </Form>
      </Dialog>
    </Shell>
  );
}

function People() {
  const employeesCol = useCollection<Employee>("employees");
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId ? employeesCol.get(editingId) : undefined;
  return (
    <Shell>
      <Heading id="heading.people" text="People" />
      <Section id="section.people" title="Employees" count={employeesCol.items.length} subtitle="Who reports to whom, and each manager's deputy while on leave.">
        <Table
          id="table.people"
          columns={["Name", "Manager", "Deputy", { label: "On leave", kind: "status" }]}
          rows={employeesCol.items.map((e) => ({
            id: `employee.${e.id}`,
            cells: [e.name, employeesCol.get(e.managerId ?? "")?.name ?? "—", employeesCol.get(e.deputyId ?? "")?.name ?? "—"],
            status: { text: e.onLeave ? "On leave" : "Active", tone: e.onLeave ? "warning" : "success" },
            actions: [{ id: `employee.${e.id}.edit`, label: "Edit", onPress: () => setEditingId(e.id) }],
          }))}
        />
      </Section>
      <Dialog id="dialog.edit-person" title={`Edit ${editing?.name ?? ""}`} open={!!editing} onClose={() => setEditingId(null)}>
        {editing && (
          <Form id="form.edit-person"
            onSubmit={(values) => {
              employeesCol.update(editing.id, {
                managerId: values.manager || null,
                deputyId: values.deputy || null,
                onLeave: values.onLeave === "on",
              });
              setEditingId(null);
            }}
            actions={<Button id="btn.save-person" label="Save" emphasis="primary" submit />}
          >
            <Field id="field.manager" label="Manager" name="manager" type="select"
              options={employeesCol.items.filter((e) => e.id !== editing.id).map((e) => e.id)}
              defaultValue={editing.managerId ?? ""} />
            <Field id="field.deputy" label="Deputy" name="deputy" type="select"
              options={employeesCol.items.filter((e) => e.id !== editing.id).map((e) => e.id)}
              defaultValue={editing.deputyId ?? ""} />
            <Field id="field.on-leave" label="On leave" name="onLeave" type="switch" defaultValue={editing.onLeave ? "on" : "off"} />
          </Form>
        )}
      </Dialog>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const user = roleUser[role] ?? roleUser.Employee;
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
      <Form id="form.settings" onSubmit={() => navigate.go("screen.my-claims")}
        actions={<Button id="btn.save-settings" label="Save settings" emphasis="primary" submit />}>
        <Field id="field.digest" label="Email me when a claim is decided" type="switch" defaultValue="on" />
      </Form>
    </Shell>
  );
}

function SignedOut() {
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to="screen.my-claims" />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.my-claims": MyClaims,
    "screen.new-claim": NewClaim,
    "screen.claim-detail": ClaimDetail,
    "screen.team-queue": TeamQueue,
    "screen.team-claim-detail": TeamClaimDetail,
    "screen.finance-queue": FinanceQueue,
    "screen.finance-claim-detail": FinanceClaimDetail,
    "screen.people": People,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { employees, claims, expenses, receipts, approvals },
});
