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
  Alert, AppShell, Breadcrumbs, Button, Detail, Dialog, EmptyState, Field, Form, Heading, Screen,
  Section, Stat, StatGroup, Table, ValidationSummary, defineApp, useCollection, useDisplayState,
  useNav, useParams, useRole, useToday,
} from "@wso2/prototype-kit";

interface Claim {
  id: string;
  employeeId: string;
  employeeName: string;
  amount: string;
  expenseDate: string;
  category: string;
  description: string;
  status: string;
  rejectionReason: string | null;
  submittedAt: string;
  decidedAt: string | null;
  exportBatchId: string | null;
}

interface ExportBatch {
  id: string;
  exportedAt: string;
  exportedBy: string;
  claimCount: number;
}

const EMPLOYEE_ID = "emp-1";
const TEAM_IDS = ["emp-1", "emp-2"];
const CATEGORIES = ["Travel", "Meals", "Office Supplies", "Lodging", "Other"];

const claims: Claim[] = [
  {
    id: "claim-1",
    employeeId: "emp-1",
    employeeName: "Maya Fernando",
    amount: "148.20",
    expenseDate: "2026-01-10",
    category: "Travel",
    description: "Taxi to client site",
    status: "Pending",
    rejectionReason: null,
    submittedAt: "2026-01-10",
    decidedAt: null,
    exportBatchId: null,
  },
  {
    id: "claim-2",
    employeeId: "emp-1",
    employeeName: "Maya Fernando",
    amount: "62.00",
    expenseDate: "2026-01-05",
    category: "Meals",
    description: "Client lunch",
    status: "Approved",
    rejectionReason: null,
    submittedAt: "2026-01-05",
    decidedAt: "2026-01-07",
    exportBatchId: null,
  },
  {
    id: "claim-3",
    employeeId: "emp-2",
    employeeName: "Ravi Perera",
    amount: "310.00",
    expenseDate: "2026-01-08",
    category: "Travel",
    description: "Flight to conference",
    status: "Pending",
    rejectionReason: null,
    submittedAt: "2026-01-08",
    decidedAt: null,
    exportBatchId: null,
  },
  {
    id: "claim-4",
    employeeId: "emp-2",
    employeeName: "Ravi Perera",
    amount: "45.00",
    expenseDate: "2025-12-20",
    category: "Office Supplies",
    description: "Printer paper",
    status: "Rejected",
    rejectionReason: "Not a reimbursable business expense",
    submittedAt: "2025-12-20",
    decidedAt: "2025-12-22",
    exportBatchId: null,
  },
  {
    id: "claim-5",
    employeeId: "emp-1",
    employeeName: "Maya Fernando",
    amount: "90.00",
    expenseDate: "2025-12-15",
    category: "Meals",
    description: "Team dinner",
    status: "Approved",
    rejectionReason: null,
    submittedAt: "2025-12-15",
    decidedAt: "2025-12-16",
    exportBatchId: "batch-1",
  },
  {
    id: "claim-6",
    employeeId: "emp-2",
    employeeName: "Ravi Perera",
    amount: "120.00",
    expenseDate: "2026-01-02",
    category: "Travel",
    description: "Train ticket",
    status: "Withdrawn",
    rejectionReason: null,
    submittedAt: "2026-01-02",
    decidedAt: null,
    exportBatchId: null,
  },
];

const exportBatches: ExportBatch[] = [
  { id: "batch-1", exportedAt: "2025-12-31", exportedBy: "Chen Wei", claimCount: 1 },
];

const users = {
  Employee: { name: "Maya Fernando", email: "maya.fernando@acme.example" },
  Manager: { name: "Ana Silva", email: "ana.silva@acme.example" },
  FinanceReviewer: { name: "Chen Wei", email: "chen.wei@acme.example" },
};

const navByRole: Record<string, { id: string; label: string; to: string }[]> = {
  Employee: [{ id: "nav.my-claims", label: "My claims", to: "screen.my-claims" }],
  Manager: [{ id: "nav.approval-queue", label: "Approval queue", to: "screen.approval-queue" }],
  FinanceReviewer: [
    { id: "nav.approved-claims", label: "Approved claims", to: "screen.approved-claims" },
    { id: "nav.export-history", label: "Export history", to: "screen.export-history" },
  ],
};

function statusTone(status: string): "default" | "info" | "success" | "warning" | "error" {
  if (status === "Pending") return "warning";
  if (status === "Approved") return "success";
  if (status === "Rejected") return "error";
  return "default";
}

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  const user = users[role as keyof typeof users] ?? users.Employee;
  const nav = navByRole[role] ?? [];
  return (
    <AppShell
      id="shell"
      user={user}
      nav={nav}
      account="screen.account"
      settings="screen.settings"
      signOut="screen.signed-out"
    >
      {children}
    </AppShell>
  );
}

function MyClaims() {
  const state = useDisplayState();
  const all = useCollection<Claim>("claims");
  const mine = state === "state.empty" ? [] : all.items.filter((c) => c.employeeId === EMPLOYEE_ID);
  const pending = mine.filter((c) => c.status === "Pending").length;
  const approved = mine.filter((c) => c.status === "Approved").length;
  return (
    <Shell>
      <Heading
        id="heading.my-claims"
        text="My claims"
        actions={<Button id="btn.new-claim" label="New claim" emphasis="primary" to="screen.claim-form" />}
      />
      {state === "state.failed" && (
        <Alert id="alert.my-claims-failed" tone="error" title="Claims feed unavailable" text="Your claim statuses may be out of date. Try again shortly." />
      )}
      <StatGroup>
        <Stat id="stat.pending-mine" label="Awaiting review" value={String(pending)} hint="of your claims" icon="Hourglass" tone="warning" />
        <Stat id="stat.approved-mine" label="Approved" value={String(approved)} hint="ready for payroll" icon="CircleCheck" tone="success" />
      </StatGroup>
      <Section id="section.my-claims" title="Claims" count={mine.length} subtitle="Your submitted expense claims, newest first.">
        <Table
          id="table.my-claims"
          columns={["Category", { label: "Amount", kind: "number" }, { label: "Status", kind: "status" }, "Submitted"]}
          rows={mine.map((c) => ({
            id: `claim.${c.id}`,
            cells: [c.category, `$${c.amount}`, c.submittedAt],
            status: { text: c.status, tone: statusTone(c.status) },
            to: "screen.claim-detail",
            params: { claim: c.id },
          }))}
          empty={<EmptyState id="empty.my-claims" title="No claims yet" text="Submit your first expense claim to get reimbursed." actions={<Button id="btn.new-claim-empty" label="New claim" emphasis="primary" to="screen.claim-form" />} />}
        />
      </Section>
    </Shell>
  );
}

function ClaimDetail() {
  const { claim: id } = useParams();
  const navigate = useNav();
  const all = useCollection<Claim>("claims");
  const mine = all.items.filter((c) => c.employeeId === EMPLOYEE_ID);
  const claim = (id ? all.get(id) : undefined) ?? mine[0]!;
  return (
    <Shell>
      <Breadcrumbs
        id="breadcrumbs.claim-detail"
        items={[
          { id: "crumb.my-claims", label: "My claims", to: "screen.my-claims" },
          { id: "crumb.claim", label: `Claim ${claim.id}` },
        ]}
      />
      <Heading id="heading.claim-detail" text={`Claim ${claim.id}`} />
      <Detail
        id="detail.claim"
        fields={[
          { label: "Category", value: claim.category },
          { label: "Amount", value: `$${claim.amount}` },
          { label: "Date", value: claim.expenseDate },
          { label: "Description", value: claim.description },
          { label: "Status", value: claim.status },
          ...(claim.status === "Rejected" && claim.rejectionReason
            ? [{ label: "Rejection reason", value: claim.rejectionReason }]
            : []),
        ]}
      />
      {claim.status === "Pending" && (
        <>
          <Button id="btn.edit-claim" label="Edit" emphasis="primary" to="screen.claim-form" params={{ claim: claim.id }} />
          <Button
            id="btn.withdraw-claim"
            label="Withdraw"
            emphasis="danger"
            onPress={() => {
              all.update(claim.id, { status: "Withdrawn" });
              navigate.go("screen.my-claims");
            }}
          />
        </>
      )}
    </Shell>
  );
}

function ClaimForm() {
  const { claim: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<Claim>("claims");
  const today = useToday();
  const existing = id ? all.get(id) : undefined;
  const isEdit = Boolean(existing);
  const onSubmit = (values: Record<string, string>) => {
    if (existing) {
      all.update(existing.id, {
        amount: values.amount,
        expenseDate: values.expenseDate,
        category: values.category,
        description: values.description,
      });
    } else {
      all.create({
        employeeId: EMPLOYEE_ID,
        employeeName: "Maya Fernando",
        amount: values.amount,
        expenseDate: values.expenseDate,
        category: values.category,
        description: values.description,
        status: "Pending",
        rejectionReason: null,
        submittedAt: today,
        decidedAt: null,
        exportBatchId: null,
      });
    }
    navigate.go("screen.my-claims");
  };
  return (
    <Shell>
      <Breadcrumbs
        id="breadcrumbs.claim-form"
        items={[
          { id: "crumb.my-claims", label: "My claims", to: "screen.my-claims" },
          { id: "crumb.claim-form", label: isEdit ? "Edit claim" : "New claim" },
        ]}
      />
      <Heading id="heading.claim-form" text={isEdit ? "Edit claim" : "Submit a claim"} />
      <Form
        id="form.claim"
        onSubmit={onSubmit}
        actions={<Button id="btn.save-claim" label="Save claim" emphasis="primary" submit />}
      >
        {state === "state.validation-error" && (
          <ValidationSummary
            id="validation.claim"
            issues={["Enter an amount greater than zero", "Choose a date", "Choose a category", "Describe the expense"]}
          />
        )}
        <Field
          id="field.amount"
          name="amount"
          label="Amount"
          type="number"
          required
          defaultValue={existing?.amount}
          error={state === "state.validation-error" ? "Enter an amount greater than zero" : undefined}
        />
        <Field
          id="field.expense-date"
          name="expenseDate"
          label="Date"
          type="date"
          required
          defaultValue={existing?.expenseDate}
          error={state === "state.validation-error" ? "Choose a date" : undefined}
        />
        <Field
          id="field.category"
          name="category"
          label="Category"
          type="select"
          options={CATEGORIES}
          required
          defaultValue={existing?.category}
          error={state === "state.validation-error" ? "Choose a category" : undefined}
        />
        <Field
          id="field.description"
          name="description"
          label="Description"
          type="textarea"
          required
          defaultValue={existing?.description}
          error={state === "state.validation-error" ? "Describe the expense" : undefined}
        />
      </Form>
    </Shell>
  );
}

function ApprovalQueue() {
  const state = useDisplayState();
  const all = useCollection<Claim>("claims");
  const pending = state === "state.empty"
    ? []
    : all.items.filter((c) => TEAM_IDS.includes(c.employeeId) && c.status === "Pending");
  return (
    <Shell>
      <Heading id="heading.approval-queue" text="Approval queue" />
      {state === "state.failed" && (
        <Alert id="alert.queue-failed" tone="error" title="Claims feed unavailable" text="New claims may not appear yet. Refresh in a few minutes." />
      )}
      <StatGroup>
        <Stat id="stat.pending-team" label="Awaiting you" value={String(pending.length)} hint="claims to decide" icon="Inbox" tone="warning" />
      </StatGroup>
      <Section id="section.approval-queue" title="Pending claims" count={pending.length} subtitle="Claims submitted by your direct reports.">
        <Table
          id="table.approval-queue"
          columns={["Employee", "Category", { label: "Amount", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={pending.map((c) => ({
            id: `claim.${c.id}`,
            cells: [c.employeeName, c.category, `$${c.amount}`],
            status: { text: c.status, tone: statusTone(c.status) },
            to: "screen.claim-review",
            params: { claim: c.id },
          }))}
          empty={<EmptyState id="empty.approval-queue" title="Nothing to review" text="Claims from your team appear here when submitted." />}
        />
      </Section>
    </Shell>
  );
}

function ClaimReview() {
  const { claim: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<Claim>("claims");
  const today = useToday();
  const [rejecting, setRejecting] = useState(false);
  const team = all.items.filter((c) => TEAM_IDS.includes(c.employeeId));
  const claim = (id ? all.get(id) : undefined) ?? team[0]!;
  const approve = () => {
    all.update(claim.id, { status: "Approved", decidedAt: today });
    navigate.go("screen.approval-queue");
  };
  const reject = (values: Record<string, string>) => {
    all.update(claim.id, { status: "Rejected", decidedAt: today, rejectionReason: values.reason });
    navigate.go("screen.approval-queue");
  };
  return (
    <Shell>
      <Breadcrumbs
        id="breadcrumbs.claim-review"
        items={[
          { id: "crumb.approval-queue", label: "Approval queue", to: "screen.approval-queue" },
          { id: "crumb.claim-review", label: `Claim ${claim.id}` },
        ]}
      />
      <Heading id="heading.claim-review" text={`Claim ${claim.id} — ${claim.employeeName}`} />
      <Detail
        id="detail.claim-review"
        fields={[
          { label: "Employee", value: claim.employeeName },
          { label: "Category", value: claim.category },
          { label: "Amount", value: `$${claim.amount}` },
          { label: "Date", value: claim.expenseDate },
          { label: "Description", value: claim.description },
          { label: "Status", value: claim.status },
        ]}
      />
      {claim.status === "Pending" && (
        <>
          <Button id="btn.approve" label="Approve" emphasis="primary" onPress={approve} />
          <Button id="btn.reject" label="Reject" emphasis="danger" onPress={() => setRejecting(true)} />
          <Dialog id="dialog.reject" title={`Reject claim ${claim.id}`} open={rejecting} onClose={() => setRejecting(false)}>
            <Form
              id="form.reject"
              onSubmit={reject}
              actions={<Button id="btn.reject-confirm" label="Reject" emphasis="danger" submit />}
            >
              {state === "state.validation-error" && (
                <ValidationSummary id="validation.reject" issues={["Give the employee a reason"]} />
              )}
              <Field
                id="field.reason"
                name="reason"
                label="Reason"
                type="textarea"
                required
                error={state === "state.validation-error" ? "Give the employee a reason" : undefined}
              />
            </Form>
          </Dialog>
        </>
      )}
    </Shell>
  );
}

function ApprovedClaims() {
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<Claim>("claims");
  const exportBatchList = useCollection<ExportBatch>("exportBatches");
  const today = useToday();
  const approved = state === "state.empty" ? [] : all.items.filter((c) => c.status === "Approved");
  const unexported = approved.filter((c) => !c.exportBatchId);
  const exportToPayroll = () => {
    const toExport = all.items.filter((c) => c.status === "Approved" && !c.exportBatchId);
    const batchId = exportBatchList.create({ exportedAt: today, exportedBy: "Chen Wei", claimCount: toExport.length });
    toExport.forEach((c) => all.update(c.id, { exportBatchId: batchId }));
    navigate.go("screen.export-history");
  };
  return (
    <Shell>
      <Heading id="heading.approved-claims" text="Approved claims" />
      {state === "state.failed" && (
        <Alert id="alert.approved-failed" tone="error" title="Claims feed unavailable" text="Approved claims may be incomplete. Try again shortly." />
      )}
      <StatGroup>
        <Stat id="stat.approved-count" label="Approved" value={String(approved.length)} hint="ready for payroll" icon="CircleCheck" tone="success" />
        <Stat id="stat.unexported-count" label="Not yet exported" value={String(unexported.length)} hint="awaiting export" icon="FileText" tone="warning" />
      </StatGroup>
      <Section
        id="section.approved-claims"
        title="Approved claims"
        count={approved.length}
        subtitle="Approved claims ready for or already sent to payroll."
        actions={<Button id="btn.export-payroll" label="Export to payroll" emphasis="primary" disabled={unexported.length === 0} onPress={exportToPayroll} />}
      >
        <Table
          id="table.approved-claims"
          columns={["Employee", "Category", { label: "Amount", kind: "number" }, { label: "Export status", kind: "status" }]}
          rows={approved.map((c) => ({
            id: `claim.${c.id}`,
            cells: [c.employeeName, c.category, `$${c.amount}`],
            status: c.exportBatchId
              ? { text: `Exported (${c.exportBatchId})`, tone: "default" }
              : { text: "Not exported", tone: "warning" },
          }))}
          empty={<EmptyState id="empty.approved-claims" title="No approved claims" text="Claims appear here once a manager approves them." />}
        />
      </Section>
    </Shell>
  );
}

function ExportHistory() {
  const state = useDisplayState();
  const all = useCollection<ExportBatch>("exportBatches");
  const batches = state === "state.empty" ? [] : all.items;
  return (
    <Shell>
      <Heading id="heading.export-history" text="Export history" />
      <Section id="section.export-history" title="Past exports" count={batches.length} subtitle="Every payroll export, oldest first.">
        <Table
          id="table.export-history"
          columns={["Batch", "Exported at", "Exported by", { label: "Claims", kind: "number" }]}
          rows={batches.map((b) => ({
            id: `batch.${b.id}`,
            cells: [b.id, b.exportedAt, b.exportedBy, String(b.claimCount)],
          }))}
          empty={<EmptyState id="empty.export-history" title="No exports yet" text="Export approved claims from the Approved claims page to see them here." />}
        />
      </Section>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const user = users[role as keyof typeof users] ?? users.Employee;
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail
        id="detail.account"
        fields={[
          { label: "Name", value: user.name },
          { label: "Email", value: user.email },
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
        text="Expense Claims sends no email or notifications: open the app to see where each claim stands."
      />
    </Shell>
  );
}

const entryByRole: Record<string, string> = {
  Employee: "screen.my-claims",
  Manager: "screen.approval-queue",
  FinanceReviewer: "screen.approved-claims",
};

function SignedOut() {
  const role = useRole();
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to={entryByRole[role] ?? "screen.my-claims"} />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.my-claims": MyClaims,
    "screen.claim-detail": ClaimDetail,
    "screen.claim-form": ClaimForm,
    "screen.approval-queue": ApprovalQueue,
    "screen.claim-review": ClaimReview,
    "screen.approved-claims": ApprovedClaims,
    "screen.export-history": ExportHistory,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { claims, exportBatches },
});
