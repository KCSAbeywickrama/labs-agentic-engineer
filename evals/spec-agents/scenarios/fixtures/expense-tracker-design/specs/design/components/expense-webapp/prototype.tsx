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
  Alert, AppShell, Button, Detail, Dialog, EmptyState, Field, Form, Heading, Screen, Section,
  Stat, StatGroup, Table, ValidationSummary, defineApp, useCollection, useDisplayState, useNav,
  useParams, useRole, useToday,
} from "@wso2/prototype-kit";

interface Claim {
  id: string;
  employeeName: string;
  description: string;
  amount: string;
  date: string;
  submittedAt: string;
  status: "Submitted" | "Approved" | "Rejected";
  reason?: string;
  decidedAt?: string;
}

const claims: Claim[] = [
  { id: "1042", employeeName: "Maya Fernando", description: "Taxi to client site", amount: "$42.00", date: "2026-01-09", submittedAt: "2026-01-11", status: "Submitted" },
  { id: "1038", employeeName: "Maya Fernando", description: "Conference ticket", amount: "$350.00", date: "2026-01-03", submittedAt: "2026-01-06", status: "Approved", decidedAt: "2026-01-07" },
  { id: "1021", employeeName: "Maya Fernando", description: "Team lunch", amount: "$86.40", date: "2025-12-18", submittedAt: "2025-12-21", status: "Rejected", reason: "Receipts were not itemized per person." },
  { id: "1044", employeeName: "Ravi Perera", description: "Hotel stay", amount: "$210.00", date: "2026-01-12", submittedAt: "2026-01-13", status: "Submitted" },
  { id: "1041", employeeName: "Ana Silva", description: "Software license", amount: "$59.99", date: "2026-01-07", submittedAt: "2026-01-09", status: "Submitted" },
  { id: "1015", employeeName: "Ana Silva", description: "Office supplies", amount: "$120.00", date: "2025-12-10", submittedAt: "2025-12-15", status: "Approved", decidedAt: "2025-12-16" },
];

const employeeUser = { name: "Maya Fernando", email: "maya.fernando@acme.example", role: "Employee" };
const approverUser = { name: "Dinesh Rao", email: "dinesh.rao@acme.example", role: "Approver" };

function statusTone(status: Claim["status"]): "success" | "warning" | "error" {
  if (status === "Approved") return "success";
  if (status === "Rejected") return "error";
  return "warning";
}

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  const nav =
    role === "Approver"
      ? [
          { id: "nav.queue", label: "Approval queue", to: "screen.queue" },
          { id: "nav.report", label: "Monthly report", to: "screen.report" },
        ]
      : [{ id: "nav.my-claims", label: "My claims", to: "screen.my-claims" }];
  return (
    <AppShell
      id="shell"
      user={role === "Approver" ? approverUser : employeeUser}
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
  const mine =
    state === "state.empty"
      ? []
      : all.items
          .filter((c) => c.employeeName === employeeUser.name)
          .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
  return (
    <Shell>
      <Heading
        id="heading.my-claims"
        text="My claims"
        actions={<Button id="btn.new-claim" label="New claim" emphasis="primary" to="screen.new-claim" />}
      />
      <Section id="section.my-claims" title="Claims" count={mine.length} subtitle="Newest submitted first.">
        <Table
          id="table.my-claims"
          columns={["Description", { label: "Amount", kind: "number" }, "Date", { label: "Status", kind: "status" }]}
          rows={mine.map((c) => ({
            id: `claim.${c.id}`,
            cells: [c.description, c.amount, c.date],
            status: { text: c.status, tone: statusTone(c.status) },
            to: "screen.claim-detail",
            params: { claim: c.id },
          }))}
          empty={<EmptyState id="empty.my-claims" title="No claims yet" text="Submit your first expense claim to get started." actions={<Button id="btn.new-claim-empty" label="New claim" emphasis="primary" to="screen.new-claim" />} />}
        />
      </Section>
    </Shell>
  );
}

function NewClaim() {
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<Claim>("claims");
  const today = useToday();
  return (
    <Shell>
      <Heading id="heading.new-claim" text="New claim" />
      <Section id="section.new-claim" title="Expense details" subtitle="Describe the expense, its amount and the date it was incurred.">
        {state === "state.validation-error" && (
          <ValidationSummary
            id="validation.new-claim"
            issues={["The amount must be greater than zero", "The date cannot be in the future"]}
          />
        )}
        <Form
          id="form.new-claim"
          onSubmit={(values) => {
            all.create({
              employeeName: employeeUser.name,
              description: values.description ?? "",
              amount: values.amount ? `$${Number(values.amount).toFixed(2)}` : "$0.00",
              date: values.date ?? today,
              submittedAt: today,
              status: "Submitted",
            });
            navigate.go("screen.my-claims");
          }}
          actions={<Button id="btn.submit-claim" label="Submit claim" emphasis="primary" submit />}
        >
          <Field
            id="field.description"
            name="description"
            label="Description"
            required
            placeholder="Taxi to client site"
            error={state === "state.validation-error" ? undefined : undefined}
          />
          <Field
            id="field.amount"
            name="amount"
            label="Amount"
            type="number"
            required
            error={state === "state.validation-error" ? "Must be greater than zero" : undefined}
          />
          <Field
            id="field.date"
            name="date"
            label="Date"
            type="date"
            required
            defaultValue={today}
            error={state === "state.validation-error" ? "Cannot be in the future" : undefined}
          />
        </Form>
      </Section>
    </Shell>
  );
}

function ClaimDetail() {
  const { claim: id } = useParams();
  const all = useCollection<Claim>("claims");
  const mine = all.items.filter((c) => c.employeeName === employeeUser.name);
  const claim = (id ? all.get(id) : undefined) ?? mine[0]!;
  return (
    <Shell>
      <Heading id="heading.claim-detail" text={`Claim ${claim.id}`} />
      <Detail
        id="detail.claim"
        fields={[
          { label: "Description", value: claim.description },
          { label: "Amount", value: claim.amount },
          { label: "Date", value: claim.date },
          { label: "Status", value: claim.status },
        ]}
      />
      {claim.status === "Rejected" && (
        <Alert id="alert.rejected" tone="error" title="Rejected" text={claim.reason ?? "No reason given."} />
      )}
      {claim.status === "Approved" && (
        <Alert id="alert.approved" tone="success" title="Approved" text={`Decided on ${claim.decidedAt ?? claim.date}.`} />
      )}
      {claim.status === "Submitted" && (
        <Alert id="alert.waiting" tone="info" title="Awaiting a decision" text="An approver has not decided this claim yet." />
      )}
    </Shell>
  );
}

function Queue() {
  const state = useDisplayState();
  const all = useCollection<Claim>("claims");
  const waiting =
    state === "state.empty"
      ? []
      : all.items.filter((c) => c.status === "Submitted").sort((a, b) => (a.submittedAt > b.submittedAt ? 1 : -1));
  return (
    <Shell>
      <Heading id="heading.queue" text="Approval queue" />
      <StatGroup>
        <Stat id="stat.waiting" label="Waiting" value={String(waiting.length)} hint="claims to decide" icon="Inbox" tone="warning" />
      </StatGroup>
      <Section id="section.queue" title="Submitted claims" count={waiting.length} subtitle="Oldest first, so nothing waits unseen.">
        <Table
          id="table.queue"
          columns={["Employee", "Description", { label: "Amount", kind: "number" }, "Date"]}
          rows={waiting.map((c) => ({
            id: `queue.${c.id}`,
            cells: [c.employeeName, c.description, c.amount, c.date],
            to: "screen.queue-detail",
            params: { claim: c.id },
          }))}
          empty={<EmptyState id="empty.queue" title="Nothing waiting" text="Every submitted claim has been decided." />}
        />
      </Section>
    </Shell>
  );
}

function QueueDetail() {
  const { claim: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<Claim>("claims");
  const waiting = all.items.filter((c) => c.status === "Submitted");
  const claim = (id ? all.get(id) : undefined) ?? waiting[0]!;
  const [rejecting, setRejecting] = useState(false);
  const today = useToday();
  const decide = (status: Claim["status"], reason?: string) => {
    all.update(claim.id, { status, decidedAt: today, reason });
    navigate.go("screen.queue");
  };
  return (
    <Shell>
      <Heading id="heading.queue-detail" text={`Claim ${claim.id} — ${claim.employeeName}`} />
      <Detail
        id="detail.queue-claim"
        fields={[
          { label: "Employee", value: claim.employeeName },
          { label: "Description", value: claim.description },
          { label: "Amount", value: claim.amount },
          { label: "Date", value: claim.date },
          { label: "Status", value: claim.status },
        ]}
      />
      {claim.status === "Submitted" ? (
        <>
          <Button id="btn.approve" label="Approve" emphasis="primary" onPress={() => decide("Approved")} />
          <Button id="btn.reject" label="Reject" emphasis="danger" onPress={() => setRejecting(true)} />
        </>
      ) : (
        <Alert
          id="alert.already-decided"
          tone="info"
          title="Already decided"
          text="This claim has already been decided and cannot be decided again."
        />
      )}
      <Dialog id="dialog.reject" title={`Reject claim ${claim.id}`} open={rejecting} onClose={() => setRejecting(false)}>
        <Form
          id="form.reject"
          onSubmit={(values) => decide("Rejected", values.reason ?? "")}
          actions={<Button id="btn.reject-confirm" label="Reject" emphasis="danger" submit />}
        >
          <Field
            id="field.reject-reason"
            name="reason"
            label="Reason"
            type="textarea"
            required
            error={state === "state.validation-error" ? "Give the employee a reason" : undefined}
          />
        </Form>
      </Dialog>
    </Shell>
  );
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${names[Number(m) - 1]} ${y}`;
}

function Report() {
  const today = useToday();
  const defaultMonth = today.slice(0, 7);
  const all = useCollection<Claim>("claims");
  const [month, setMonth] = useState(defaultMonth);
  const approvedInMonth = all.items.filter((c) => c.status === "Approved" && (c.decidedAt ?? "").slice(0, 7) === month);
  const totalCents = approvedInMonth.reduce((sum, c) => sum + Math.round(Number(c.amount.replace(/[^0-9.]/g, "")) * 100), 0);
  const total = `$${(totalCents / 100).toFixed(2)}`;
  return (
    <Shell>
      <Heading id="heading.report" text="Monthly report" />
      <Section id="section.report" title="Approved claims" subtitle="Read-only. The total of approved claims for the selected month.">
        <Field
          id="field.month"
          name="month"
          label="Month"
          type="select"
          options={["2026-01", "2025-12"]}
          value={month}
          onChange={setMonth}
        />
        <StatGroup>
          <Stat id="stat.total" label={monthLabel(month)} value={total} hint={`${approvedInMonth.length} approved claim(s)`} icon="DollarSign" />
        </StatGroup>
      </Section>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const user = role === "Approver" ? approverUser : employeeUser;
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
  const navigate = useNav();
  return (
    <Shell>
      <Heading id="heading.settings" text="Settings" />
      <Form
        id="form.settings"
        onSubmit={() => navigate.go("screen.my-claims")}
        actions={<Button id="btn.save-settings" label="Save settings" emphasis="primary" submit />}
      >
        <Field id="field.compact" label="Use a compact table" type="switch" defaultValue="off" />
      </Form>
    </Shell>
  );
}

function SignedOut() {
  const role = useRole();
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Button
        id="btn.sign-in"
        label="Sign in"
        emphasis="primary"
        to={role === "Approver" ? "screen.queue" : "screen.my-claims"}
      />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.my-claims": MyClaims,
    "screen.new-claim": NewClaim,
    "screen.claim-detail": ClaimDetail,
    "screen.queue": Queue,
    "screen.queue-detail": QueueDetail,
    "screen.report": Report,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { claims },
});
