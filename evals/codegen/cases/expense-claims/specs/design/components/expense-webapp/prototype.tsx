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
  Alert, AppShell, Badge, Breadcrumbs, Button, Detail, Dialog, EmptyState, Field, Form, Heading, Screen,
  Section, Stat, StatGroup, Table, ValidationSummary, defineApp, useCollection, useDisplayState, useNav,
  useParams, useRole, type Tone,
} from "@wso2/prototype-kit";

interface Claim {
  id: string;
  employeeId: string;
  employee: string;
  amount: string;
  expenseDate: string;
  category: string;
  description: string;
  status: string;
  rejectionReason: string;
  exportBatchId: string;
}

interface ExportBatch { id: string; exportedAt: string; exportedBy: string; claimCount: string }

const claims: Claim[] = [
  { id: "c1042", employeeId: "e1", employee: "Ravi Perera", amount: "120.00", expenseDate: "2026-01-10", category: "Travel", description: "Taxi to client workshop", status: "pending", rejectionReason: "", exportBatchId: "" },
  { id: "c1039", employeeId: "e1", employee: "Ravi Perera", amount: "42.50", expenseDate: "2026-01-02", category: "Meals", description: "Team lunch", status: "approved", rejectionReason: "", exportBatchId: "" },
  { id: "c1031", employeeId: "e1", employee: "Ravi Perera", amount: "18.00", expenseDate: "2025-12-18", category: "Supplies", description: "Printer paper", status: "rejected", rejectionReason: "Covered by office supplies budget", exportBatchId: "" },
  { id: "c1044", employeeId: "e2", employee: "Maya Fernando", amount: "310.00", expenseDate: "2026-01-12", category: "Travel", description: "Train tickets to Kandy", status: "pending", rejectionReason: "", exportBatchId: "" },
  { id: "c1045", employeeId: "e3", employee: "Ana Silva", amount: "35.00", expenseDate: "2026-01-13", category: "Meals", description: "Client dinner", status: "pending", rejectionReason: "", exportBatchId: "" },
  { id: "c1020", employeeId: "e2", employee: "Maya Fernando", amount: "95.00", expenseDate: "2025-12-05", category: "Training", description: "Online course fee", status: "approved", rejectionReason: "", exportBatchId: "batch-1" },
];

const exportBatches: ExportBatch[] = [
  { id: "batch-1", exportedAt: "2026-01-02 09:00", exportedBy: "Nimali Jayasuriya", claimCount: "12" },
  { id: "batch-2", exportedAt: "2025-12-01 09:00", exportedBy: "Nimali Jayasuriya", claimCount: "9" },
];

const users: Record<string, { name: string; email: string }> = {
  Employee: { name: "Ravi Perera", email: "ravi@acme.example" },
  Manager: { name: "Kasun Wijesinghe", email: "kasun@acme.example" },
  FinanceReviewer: { name: "Nimali Jayasuriya", email: "nimali@acme.example" },
};
const homes: Record<string, string> = {
  Employee: "screen.my-claims",
  Manager: "screen.approvals",
  FinanceReviewer: "screen.approved",
};
const categories = ["Travel", "Meals", "Supplies", "Training", "Other"];

function tone(status: string): Tone {
  if (status === "approved") return "success";
  if (status === "rejected") return "error";
  if (status === "pending") return "warning";
  return "default";
}

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  return (
    <AppShell
      id="shell"
      user={users[role] ?? users.Employee!}
      nav={[
        { id: "nav.my-claims", label: "My claims", to: "screen.my-claims" },
        { id: "nav.approvals", label: "Approvals", to: "screen.approvals" },
        { id: "nav.approved", label: "Approved claims", to: "screen.approved" },
        { id: "nav.export-history", label: "Export history", to: "screen.export-history" },
      ]}
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
  const mine = state === "state.empty" ? [] : all.items.filter((c) => c.employeeId === "e1");
  const count = (s: string) => mine.filter((c) => c.status === s).length;
  return (
    <Shell>
      <Heading id="heading.my-claims" text="My claims" />
      {state === "state.failed" && (
        <Alert id="alert.claims-failed" tone="error" title="Claims unavailable" text="We could not load your claims. Try again in a few minutes." />
      )}
      <StatGroup>
        <Stat id="stat.pending" label="Pending" value={String(count("pending"))} hint="awaiting your manager" icon="Hourglass" tone="warning" />
        <Stat id="stat.approved" label="Approved" value={String(count("approved"))} hint="ready for payroll" icon="CircleCheck" tone="success" />
        <Stat id="stat.rejected" label="Rejected" value={String(count("rejected"))} hint="see the reason" icon="CircleX" tone="error" />
      </StatGroup>
      <Section
        id="section.claims"
        title="Claims"
        count={mine.length}
        subtitle="Open a pending claim to edit or withdraw it."
        actions={<Button id="btn.new-claim" label="New claim" emphasis="primary" to="screen.new-claim" />}
      >
        <Table
          id="table.claims"
          columns={["Date", "Category", { label: "Amount", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={mine.map((c) => ({
            id: `claim.${c.id}`,
            cells: [c.expenseDate, c.category, c.amount],
            status: { text: c.status, tone: tone(c.status) },
            to: "screen.claim-detail",
            params: { claim: c.id },
          }))}
          empty={<EmptyState id="empty.claims" title="No claims yet" text="Submit a claim to request reimbursement." actions={<Button id="btn.empty-new-claim" label="New claim" to="screen.new-claim" />} />}
        />
      </Section>
    </Shell>
  );
}

function NewClaim() {
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<Claim>("claims");
  const invalid = state === "state.validation-error";
  return (
    <Shell>
      <Breadcrumbs id="crumbs.new-claim" items={[{ id: "crumb.claims", label: "My claims", to: "screen.my-claims" }, { id: "crumb.new", label: "New claim" }]} />
      <Heading id="heading.new-claim" text="New claim" />
      {state === "state.failed" && (
        <Alert id="alert.submit-failed" tone="error" title="Claim not submitted" text="The claim could not be saved. Your input is kept; try again shortly." />
      )}
      {invalid && <ValidationSummary id="summary.new-claim" issues={["Amount is required", "Description is required"]} />}
      <Form
        id="form.new-claim"
        onSubmit={(v) => {
          all.create({
            employeeId: "e1", employee: "Ravi Perera", amount: v.amount ?? "0.00", expenseDate: v.date ?? "2026-01-15",
            category: v.category ?? "Other", description: v.description ?? "", status: "pending", rejectionReason: "", exportBatchId: "",
          });
          navigate.go("screen.my-claims");
        }}
        actions={
          <>
            <Button id="btn.cancel-claim" label="Cancel" to="screen.my-claims" />
            <Button id="btn.submit-claim" label="Submit claim" emphasis="primary" submit />
          </>
        }
      >
        <Field id="field.amount" name="amount" label="Amount" type="number" required error={invalid ? "Enter an amount" : undefined} />
        <Field id="field.date" name="date" label="Expense date" type="date" required defaultValue="2026-01-15" />
        <Field id="field.category" name="category" label="Category" type="select" options={categories} defaultValue="Travel" />
        <Field id="field.description" name="description" label="Description" type="textarea" required error={invalid ? "Describe the expense" : undefined} />
      </Form>
    </Shell>
  );
}

function ClaimDetail() {
  const { claim: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<Claim>("claims");
  const mine = all.items.filter((c) => c.employeeId === "e1");
  const claim = (id ? all.get(id) : undefined) ?? mine[0]!;
  const pending = claim.status === "pending";
  return (
    <Shell>
      <Breadcrumbs id="crumbs.claim" items={[{ id: "crumb.claims", label: "My claims", to: "screen.my-claims" }, { id: "crumb.claim", label: `Claim ${claim.id}` }]} />
      <Heading id="heading.claim" text={`Claim ${claim.id}`} actions={<Badge id="badge.status" label={claim.status} tone={tone(claim.status)} />} />
      {state === "state.failed" && (
        <Alert id="alert.update-failed" tone="error" title="Update failed" text="The claim could not be updated. Try again shortly." />
      )}
      {claim.status === "rejected" && (
        <Alert id="alert.rejected" tone="error" title="Rejected" text={claim.rejectionReason || "No reason given."} />
      )}
      <Detail
        id="detail.claim"
        fields={[
          { label: "Amount", value: claim.amount },
          { label: "Expense date", value: claim.expenseDate },
          { label: "Category", value: claim.category },
        ]}
      />
      {pending ? (
        <Form
          id="form.claim"
          onSubmit={() => navigate.go("screen.my-claims")}
          actions={
            <>
              <Button id="btn.withdraw" label="Withdraw" emphasis="danger" onPress={() => { all.update(claim.id, { status: "withdrawn" }); navigate.go("screen.my-claims"); }} />
              <Button id="btn.save-claim" label="Save changes" emphasis="primary" submit />
            </>
          }
        >
          <Field id="field.claim-description" label="Description" type="textarea" required defaultValue={claim.description}
            error={state === "state.validation-error" ? "Description cannot be empty" : undefined} />
        </Form>
      ) : (
        <Detail id="detail.claim-description" fields={[{ label: "Description", value: claim.description }]} />
      )}
    </Shell>
  );
}

function Approvals() {
  const state = useDisplayState();
  const all = useCollection<Claim>("claims");
  const team = all.items.filter((c) => c.employeeId !== "e1" && c.status === "pending");
  const rows = state === "state.empty" ? [] : team;
  return (
    <Shell>
      <Heading id="heading.approvals" text="Approval queue" />
      {state === "state.failed" && (
        <Alert id="alert.queue-failed" tone="error" title="Queue unavailable" text="Team claims could not be loaded. Refresh in a few minutes." />
      )}
      <StatGroup>
        <Stat id="stat.waiting" label="Awaiting you" value={String(rows.length)} hint="claims to decide" icon="Inbox" tone="warning" />
      </StatGroup>
      <Section id="section.queue" title="Team claims" count={rows.length} subtitle="Claims from your direct reports. Open one to approve or reject it.">
        <Table
          id="table.queue"
          columns={["Employee", "Date", "Category", { label: "Amount", kind: "number" }]}
          rows={rows.map((c) => ({
            id: `claim.${c.id}`,
            cells: [c.employee, c.expenseDate, c.category, c.amount],
            to: "screen.claim-review",
            params: { claim: c.id },
            actions: [{ id: `claim.${c.id}.approve`, label: "Approve", onPress: () => all.update(c.id, { status: "approved" }) }],
          }))}
          empty={<EmptyState id="empty.queue" title="Nothing to approve" text="New team claims appear here." />}
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
  const [rejecting, setRejecting] = useState(false);
  const claim = (id ? all.get(id) : undefined) ?? all.items.find((c) => c.employeeId !== "e1")!;
  const decide = (patch: Partial<Omit<Claim, "id">>) => {
    all.update(claim.id, patch);
    navigate.go("screen.approvals");
  };
  return (
    <Shell>
      <Breadcrumbs id="crumbs.review" items={[{ id: "crumb.queue", label: "Approval queue", to: "screen.approvals" }, { id: "crumb.review", label: `Claim ${claim.id}` }]} />
      <Heading
        id="heading.review"
        text="Review claim"
        actions={
          <>
            <Button id="btn.reject" label="Reject" emphasis="danger" onPress={() => setRejecting(true)} />
            <Button id="btn.approve" label="Approve" emphasis="primary" onPress={() => decide({ status: "approved" })} />
          </>
        }
      />
      {state === "state.failed" && (
        <Alert id="alert.decision-failed" tone="error" title="Decision not saved" text="The decision could not be recorded. Try again shortly." />
      )}
      <Detail
        id="detail.review"
        fields={[
          { label: "Employee", value: claim.employee },
          { label: "Amount", value: claim.amount },
          { label: "Expense date", value: claim.expenseDate },
          { label: "Category", value: claim.category },
          { label: "Description", value: claim.description },
          { label: "Status", value: claim.status },
        ]}
      />
      <Dialog id="dialog.reject" title={`Reject claim ${claim.id}`} open={rejecting} onClose={() => setRejecting(false)}>
        {state === "state.validation-error" && <ValidationSummary id="summary.reject" issues={["A reason is required"]} />}
        <Form
          id="form.reject"
          onSubmit={(v) => decide({ status: "rejected", rejectionReason: v.reason ?? "" })}
          actions={<Button id="btn.reject-confirm" label="Reject claim" emphasis="danger" submit />}
        >
          <Field id="field.reason" name="reason" label="Reason" type="textarea" required
            error={state === "state.validation-error" ? "Give the employee a reason" : undefined} />
        </Form>
      </Dialog>
    </Shell>
  );
}

function Approved() {
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<Claim>("claims");
  const batches = useCollection<ExportBatch>("exportBatches");
  const ready = state === "state.empty" ? [] : all.items.filter((c) => c.status === "approved" && c.exportBatchId === "");
  const doExport = () => {
    const batchId = batches.create({ exportedAt: "2026-01-15 10:00", exportedBy: "Nimali Jayasuriya", claimCount: String(ready.length) });
    ready.forEach((c) => all.update(c.id, { exportBatchId: batchId }));
    navigate.go("screen.export-history");
  };
  return (
    <Shell>
      <Heading id="heading.approved" text="Approved claims" />
      {state === "state.failed" && (
        <Alert id="alert.export-failed" tone="error" title="Export failed" text="No claims were marked as exported. Try again in a few minutes." />
      )}
      {state === "state.delayed" && (
        <Alert id="alert.export-delayed" tone="info" title="Export in progress" text="The payroll CSV is being prepared and will download shortly." />
      )}
      <StatGroup>
        <Stat id="stat.ready" label="Ready to export" value={String(ready.length)} hint="approved, not yet exported" icon="Receipt" tone="success" />
      </StatGroup>
      <Section
        id="section.approved"
        title="Not yet exported"
        count={ready.length}
        subtitle="Exporting downloads a CSV and marks these claims as exported (assumed format)."
        actions={<Button id="btn.export" label="Export to payroll" emphasis="primary" disabled={ready.length === 0} onPress={doExport} />}
      >
        <Table
          id="table.approved"
          columns={["Employee", "Date", "Category", { label: "Amount", kind: "number" }]}
          rows={ready.map((c) => ({ id: `claim.${c.id}`, cells: [c.employee, c.expenseDate, c.category, c.amount] }))}
          empty={<EmptyState id="empty.approved" title="Nothing to export" text="Approved claims appear here until they are exported." />}
        />
      </Section>
    </Shell>
  );
}

function ExportHistory() {
  const state = useDisplayState();
  const batches = useCollection<ExportBatch>("exportBatches");
  const rows = state === "state.empty" ? [] : batches.items;
  return (
    <Shell>
      <Heading id="heading.history" text="Export history" />
      {state === "state.failed" && (
        <Alert id="alert.history-failed" tone="error" title="History unavailable" text="Past exports could not be loaded. Refresh in a few minutes." />
      )}
      <Section id="section.history" title="Export batches" count={rows.length} subtitle="Each claim appears in exactly one batch.">
        <Table
          id="table.history"
          columns={["Exported at", "Exported by", { label: "Claims", kind: "number" }]}
          rows={rows.map((b) => ({ id: `batch.${b.id}`, cells: [b.exportedAt, b.exportedBy, b.claimCount] }))}
          empty={<EmptyState id="empty.history" title="No exports yet" text="Batches appear here after the first export." />}
        />
      </Section>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const user = users[role] ?? users.Employee!;
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail id="detail.account" fields={[{ label: "Name", value: user.name }, { label: "Email", value: user.email }]} />
    </Shell>
  );
}

function Settings() {
  const role = useRole();
  const navigate = useNav();
  return (
    <Shell>
      <Heading id="heading.settings" text="Settings" />
      <Form
        id="form.settings"
        onSubmit={() => navigate.go(homes[role] ?? "screen.my-claims")}
        actions={<Button id="btn.save-settings" label="Save settings" emphasis="primary" submit />}
      >
        <Field id="field.compact" label="Compact tables" type="switch" defaultValue="off" />
      </Form>
    </Shell>
  );
}

function SignedOut() {
  const role = useRole();
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to={homes[role] ?? "screen.my-claims"} />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.my-claims": MyClaims,
    "screen.new-claim": NewClaim,
    "screen.claim-detail": ClaimDetail,
    "screen.approvals": Approvals,
    "screen.claim-review": ClaimReview,
    "screen.approved": Approved,
    "screen.export-history": ExportHistory,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { claims, exportBatches },
});
