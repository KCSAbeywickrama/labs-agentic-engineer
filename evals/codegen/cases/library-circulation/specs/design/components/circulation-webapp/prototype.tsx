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
  Section, Stat, StatGroup, Stack, Table, Tabs, Text, ValidationSummary, defineApp, useCollection,
  useDisplayState, useNav, useParams, useRole, useToday,
} from "@wso2/prototype-kit";

interface Title { id: string; name: string; author: string; subject: string }
interface Copy { id: string; titleId: string; barcode: string; status: string }
interface Loan {
  id: string; copyId: string; titleId: string; titleName: string; barcode: string; memberId: string;
  memberName: string; checkedOutOn: string; dueOn: string; returnedOn: string; status: string; renewals: number;
}
interface Hold {
  id: string; titleId: string; titleName: string; memberId: string; memberName: string; placedOn: string;
  status: string; position: string; barcode: string; readyUntil: string;
}
interface Fee {
  id: string; loanId: string; titleName: string; memberId: string; memberName: string; daysLate: number;
  amountCents: number; status: string;
}

const titles: Title[] = [
  { id: "t1", name: "Middlemarch", author: "George Eliot", subject: "Fiction" },
  { id: "t2", name: "Emma", author: "Jane Austen", subject: "Fiction" },
  { id: "t3", name: "A Brief History of Time", author: "Stephen Hawking", subject: "Science" },
  { id: "t4", name: "Sapiens", author: "Yuval Noah Harari", subject: "History" },
  { id: "t5", name: "The Hobbit", author: "J.R.R. Tolkien", subject: "Fantasy" },
];

const copies: Copy[] = [
  { id: "c1", titleId: "t1", barcode: "3001", status: "On loan" },
  { id: "c2", titleId: "t1", barcode: "3002", status: "Available" },
  { id: "c3", titleId: "t2", barcode: "3003", status: "On loan" },
  { id: "c4", titleId: "t3", barcode: "3004", status: "On loan" },
  { id: "c5", titleId: "t3", barcode: "3005", status: "On hold shelf" },
  { id: "c6", titleId: "t4", barcode: "3006", status: "Available" },
  { id: "c7", titleId: "t5", barcode: "3007", status: "On loan" },
  { id: "c8", titleId: "t2", barcode: "3008", status: "Withdrawn" },
];

const loans: Loan[] = [
  { id: "l1", copyId: "c1", titleId: "t1", titleName: "Middlemarch", barcode: "3001", memberId: "maya", memberName: "Maya Fernando", checkedOutOn: "2025-12-30", dueOn: "2026-01-20", returnedOn: "", status: "Open", renewals: 0 },
  { id: "l2", copyId: "c3", titleId: "t2", titleName: "Emma", barcode: "3003", memberId: "maya", memberName: "Maya Fernando", checkedOutOn: "2025-12-20", dueOn: "2026-01-10", returnedOn: "", status: "Open", renewals: 0 },
  { id: "l3", copyId: "c4", titleId: "t3", titleName: "A Brief History of Time", barcode: "3004", memberId: "dan", memberName: "Dan Perera", checkedOutOn: "2025-12-22", dueOn: "2026-01-12", returnedOn: "", status: "Open", renewals: 1 },
  { id: "l4", copyId: "c7", titleId: "t5", titleName: "The Hobbit", barcode: "3007", memberId: "dan", memberName: "Dan Perera", checkedOutOn: "2026-01-05", dueOn: "2026-01-26", returnedOn: "", status: "Open", renewals: 0 },
  { id: "l5", copyId: "c6", titleId: "t4", titleName: "Sapiens", barcode: "3006", memberId: "maya", memberName: "Maya Fernando", checkedOutOn: "2025-12-09", dueOn: "2025-12-30", returnedOn: "2026-01-03", status: "Returned", renewals: 0 },
  { id: "l6", copyId: "c2", titleId: "t1", titleName: "Middlemarch", barcode: "3002", memberId: "dan", memberName: "Dan Perera", checkedOutOn: "2025-11-20", dueOn: "2025-12-11", returnedOn: "2025-12-13", status: "Returned", renewals: 0 },
];

const holds: Hold[] = [
  { id: "h1", titleId: "t3", titleName: "A Brief History of Time", memberId: "ravi", memberName: "Ravi Perera", placedOn: "2026-01-08", status: "Ready", position: "1", barcode: "3005", readyUntil: "2026-01-20" },
  { id: "h2", titleId: "t5", titleName: "The Hobbit", memberId: "maya", memberName: "Maya Fernando", placedOn: "2026-01-11", status: "Active", position: "1", barcode: "", readyUntil: "" },
  { id: "h3", titleId: "t5", titleName: "The Hobbit", memberId: "ravi", memberName: "Ravi Perera", placedOn: "2026-01-13", status: "Active", position: "2", barcode: "", readyUntil: "" },
];

const fees: Fee[] = [
  { id: "f1", loanId: "l5", titleName: "Sapiens", memberId: "maya", memberName: "Maya Fernando", daysLate: 4, amountCents: 100, status: "Unpaid" },
  { id: "f2", loanId: "l6", titleName: "Middlemarch", memberId: "dan", memberName: "Dan Perera", daysLate: 2, amountCents: 50, status: "Unpaid" },
  { id: "f3", loanId: "l7", titleName: "Emma", memberId: "maya", memberName: "Maya Fernando", daysLate: 8, amountCents: 200, status: "Settled" },
];

const memberNames = ["Maya Fernando", "Dan Perera", "Ravi Perera"];
const memberIdOf = (name: string) => (name === "Maya Fernando" ? "maya" : name === "Dan Perera" ? "dan" : "ravi");

const maya = { name: "Maya Fernando", email: "maya@library.example" };
const leo = { name: "Leo Tan", email: "leo@library.example" };

const money = (cents: number) => (cents / 100).toFixed(2);

function dayNum(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const a = m < 3 ? 1 : 0;
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

function fromDayNum(j: number): string {
  const a = j + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

type Tone = "default" | "info" | "success" | "warning" | "error";

const copyTone = (s: string): Tone =>
  s === "Available" ? "success" : s === "On loan" ? "warning" : s === "On hold shelf" ? "info" : "default";
const feeTone = (s: string): Tone => (s === "Unpaid" ? "warning" : s === "Settled" ? "success" : "default");
const holdTone = (s: string): Tone => (s === "Ready" ? "success" : "info");

function loanState(l: Loan, today: string): { text: string; tone: Tone } {
  if (l.status === "Returned") return { text: "Returned", tone: "default" };
  if (l.dueOn < today) return { text: "Overdue", tone: "error" };
  return { text: "Open", tone: "success" };
}

function useUser() {
  return useRole() === "Librarian" ? leo : maya;
}

function Shell({ children }: { children: ReactNode }) {
  const user = useUser();
  return (
    <AppShell
      id="shell"
      user={user}
      nav={[
        { id: "nav.catalogue", label: "Catalogue", to: "screen.catalogue" },
        { id: "nav.my-loans", label: "My loans", to: "screen.my-loans" },
        { id: "nav.my-holds", label: "My holds", to: "screen.my-holds" },
        { id: "nav.my-fees", label: "My fees", to: "screen.my-fees" },
        { id: "nav.loans", label: "Loans", to: "screen.loans" },
        { id: "nav.holds-queue", label: "Holds queue", to: "screen.holds-queue" },
        { id: "nav.fees", label: "Fees", to: "screen.fees" },
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
  return (
    <Alert id="alert.failed" tone="error" title="The library service is unavailable" text="Figures may be out of date. Try again in a few minutes." />
  );
}

function Catalogue() {
  const state = useDisplayState();
  const role = useRole();
  const all = useCollection<Title>("titles");
  const copyList = useCollection<Copy>("copies");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const needle = q.trim().toLowerCase();
  const shown = state === "state.empty" ? [] : all.items.filter((t) => needle === "" || `${t.name} ${t.author} ${t.subject}`.toLowerCase().includes(needle));
  const availableOf = (id: string) => copyList.items.filter((c) => c.titleId === id && c.status === "Available").length;
  const totalAvailable = copyList.items.filter((c) => c.status === "Available").length;
  return (
    <Shell>
      <Heading id="heading.catalogue" text="Catalogue" />
      {state === "state.failed" && <FailedAlert />}
      <StatGroup>
        <Stat id="stat.titles" label="Titles" value={String(all.items.length)} hint="in the catalogue" icon="Layers" />
        <Stat id="stat.available" label="Copies available" value={String(totalAvailable)} hint="ready to borrow" icon="CircleCheck" tone="success" />
      </StatGroup>
      <Section
        id="section.titles"
        title="Titles"
        count={shown.length}
        subtitle="Search by title, author or subject. Open a title to see its availability."
        actions={role === "Librarian" ? <Button id="btn.add-title" label="Add title" emphasis="primary" onPress={() => setAdding(true)} /> : undefined}
      >
        <Filters id="filters.titles">
          <Field id="field.search" label="Search" value={q} onChange={setQ} placeholder="Title, author or subject" />
        </Filters>
        <Table
          id="table.titles"
          columns={["Title", "Author", "Subject", { label: "Copies available", kind: "number" }]}
          rows={shown.map((t) => ({
            id: `title.${t.id}`,
            cells: [t.name, t.author, t.subject, String(availableOf(t.id))],
            to: "screen.title",
            params: { title: t.id },
          }))}
          empty={<EmptyState id="empty.titles" title="No titles found" text="Try a different search." />}
        />
      </Section>
      <Dialog id="dialog.add-title" title="Add title" open={adding} onClose={() => setAdding(false)}>
        {state === "state.validation-error" && (
          <ValidationSummary id="summary.add-title" issues={["Title is required", "Author is required"]} />
        )}
        <Form
          id="form.add-title"
          onSubmit={(v) => {
            all.create({ name: v.name ?? "", author: v.author ?? "", subject: v.subject ?? "" });
            setAdding(false);
          }}
          actions={<Button id="btn.add-title.save" label="Add title" emphasis="primary" submit />}
        >
          <Field id="field.title-name" name="name" label="Title" required error={state === "state.validation-error" ? "Title is required" : undefined} />
          <Field id="field.title-author" name="author" label="Author" required error={state === "state.validation-error" ? "Author is required" : undefined} />
          <Field id="field.title-subject" name="subject" label="Subject" />
        </Form>
      </Dialog>
    </Shell>
  );
}

function TitleDetail() {
  const state = useDisplayState();
  const role = useRole();
  const { title: id } = useParams();
  const navigate = useNav();
  const titleList = useCollection<Title>("titles");
  const copyList = useCollection<Copy>("copies");
  const holdList = useCollection<Hold>("holds");
  const [editing, setEditing] = useState(false);
  const [addingCopy, setAddingCopy] = useState(false);
  const [removeRefused, setRemoveRefused] = useState(false);
  const title = (id ? titleList.get(id) : undefined) ?? titleList.items[0]!;
  const mine = copyList.items.filter((c) => c.titleId === title.id);
  const available = mine.filter((c) => c.status === "Available").length;
  const queue = holdList.items.filter((h) => h.titleId === title.id && (h.status === "Active" || h.status === "Ready")).length;
  const alreadyHeld = holdList.items.some((h) => h.titleId === title.id && h.memberId === "maya" && (h.status === "Active" || h.status === "Ready"));
  const placeHold = () => {
    holdList.create({
      titleId: title.id, titleName: title.name, memberId: "maya", memberName: "Maya Fernando",
      placedOn: "2026-01-15", status: "Active", position: String(queue + 1), barcode: "", readyUntil: "",
    });
    navigate.go("screen.my-holds");
  };
  return (
    <Shell>
      <Breadcrumbs id="crumbs.title" items={[{ id: "crumb.catalogue", label: "Catalogue", to: "screen.catalogue" }, { id: "crumb.title", label: title.name }]} />
      <Heading
        id="heading.title"
        text={title.name}
        actions={
          role === "Librarian" ? (
            <Stack direction="row">
              <Button id="btn.edit-title" label="Edit title" onPress={() => setEditing(true)} />
              <Button
                id="btn.remove-title"
                label="Remove title"
                emphasis="danger"
                onPress={() => {
                  if (mine.some((c) => c.status === "On loan")) {
                    setRemoveRefused(true);
                  } else {
                    titleList.remove(title.id);
                    navigate.go("screen.catalogue");
                  }
                }}
              />
            </Stack>
          ) : undefined
        }
      />
      {state === "state.failed" && <FailedAlert />}
      {removeRefused && (
        <Alert id="alert.remove-refused" tone="error" title="Title not removed" text="A copy is on loan. Withdraw its copies instead." />
      )}
      <Detail
        id="detail.title"
        fields={[
          { label: "Author", value: title.author },
          { label: "Subject", value: title.subject },
          { label: "Copies available", value: `${available} of ${mine.filter((c) => c.status !== "Withdrawn").length}` },
          { label: "Holds waiting", value: String(queue) },
        ]}
      />
      {role === "Member" && (
        <Section id="section.hold" title="Place a hold" subtitle="Holds are available when every copy is out.">
          {state === "state.validation-error" && (
            <Alert id="alert.hold-refused" tone="error" title="Hold refused" text="A copy is available, you already hold this title, or you have 5 active holds." />
          )}
          <Button id="btn.place-hold" label="Place hold" emphasis="primary" disabled={available > 0 || alreadyHeld} onPress={placeHold} />
          {available > 0 && <Text id="text.hold-hint" text="A copy is available now; ask a librarian to check it out." />}
          {alreadyHeld && <Text id="text.hold-held" text="You already have a hold on this title." />}
        </Section>
      )}
      {role === "Librarian" && (
        <Section
          id="section.copies"
          title="Copies"
          count={mine.length}
          subtitle="Each copy has a barcode and a status."
          actions={<Button id="btn.add-copy" label="Add copy" emphasis="primary" onPress={() => setAddingCopy(true)} />}
        >
          <Table
            id="table.copies"
            columns={["Barcode", { label: "Status", kind: "status" }]}
            rows={(state === "state.empty" ? [] : mine).map((c) => ({
              id: `copy.${c.id}`,
              cells: [c.barcode],
              status: { text: c.status, tone: copyTone(c.status) },
              actions: c.status === "Available" ? [{ id: `copy.${c.id}.withdraw`, label: "Withdraw", emphasis: "danger" as const, onPress: () => copyList.update(c.id, { status: "Withdrawn" }) }] : [],
            }))}
            empty={<EmptyState id="empty.copies" title="No copies" text="Add a copy to lend this title." />}
          />
        </Section>
      )}
      <Dialog id="dialog.edit-title" title="Edit title" open={editing} onClose={() => setEditing(false)}>
        <Form
          id="form.edit-title"
          onSubmit={(v) => {
            titleList.update(title.id, { name: v.name ?? title.name, author: v.author ?? title.author, subject: v.subject ?? title.subject });
            setEditing(false);
          }}
          actions={<Button id="btn.edit-title.save" label="Save" emphasis="primary" submit />}
        >
          <Field id="field.edit-name" name="name" label="Title" required defaultValue={title.name} />
          <Field id="field.edit-author" name="author" label="Author" required defaultValue={title.author} />
          <Field id="field.edit-subject" name="subject" label="Subject" defaultValue={title.subject} />
        </Form>
      </Dialog>
      <Dialog id="dialog.add-copy" title="Add copy" open={addingCopy} onClose={() => setAddingCopy(false)}>
        <Form
          id="form.add-copy"
          onSubmit={(v) => {
            copyList.create({ titleId: title.id, barcode: v.barcode ?? "", status: "Available" });
            setAddingCopy(false);
          }}
          actions={<Button id="btn.add-copy.save" label="Add copy" emphasis="primary" submit />}
        >
          <Field id="field.barcode" name="barcode" label="Barcode" required error={state === "state.validation-error" ? "This barcode is already in use" : undefined} />
        </Form>
      </Dialog>
    </Shell>
  );
}

function MyLoans() {
  const state = useDisplayState();
  const today = useToday();
  const all = useCollection<Loan>("loans");
  const mine = state === "state.empty" ? [] : all.items.filter((l) => l.memberId === "maya");
  const current = mine.filter((l) => l.status === "Open");
  const past = mine.filter((l) => l.status === "Returned");
  const overdue = current.filter((l) => l.dueOn < today).length;
  return (
    <Shell>
      <Heading id="heading.my-loans" text="My loans" />
      {state === "state.failed" && <FailedAlert />}
      <StatGroup>
        <Stat id="stat.current" label="Current loans" value={String(current.length)} hint="of 10 allowed" icon="ClipboardList" />
        <Stat id="stat.overdue" label="Overdue" value={String(overdue)} hint="return as soon as you can" icon="Clock" tone={overdue > 0 ? "error" : "success"} />
      </StatGroup>
      <Tabs
        id="tabs.loans"
        tabs={[
          {
            id: "tab.current",
            label: "Current",
            content: (
              <Table
                id="table.current-loans"
                columns={["Title", "Checked out", "Due", { label: "Status", kind: "status" }]}
                rows={current.map((l) => ({
                  id: `current.${l.id}`,
                  cells: [l.titleName, l.checkedOutOn, l.dueOn],
                  status: loanState(l, today),
                }))}
                empty={<EmptyState id="empty.current-loans" title="No current loans" text="Borrow something from the catalogue at the desk." actions={<Button id="btn.browse" label="Browse catalogue" to="screen.catalogue" />} />}
              />
            ),
          },
          {
            id: "tab.past",
            label: "Past",
            content: (
              <Table
                id="table.past-loans"
                columns={["Title", "Due", "Returned", { label: "Status", kind: "status" }]}
                rows={past.map((l) => ({
                  id: `past.${l.id}`,
                  cells: [l.titleName, l.dueOn, l.returnedOn],
                  status: loanState(l, today),
                }))}
                empty={<EmptyState id="empty.past-loans" title="No past loans" text="Returned items appear here." />}
              />
            ),
          },
        ]}
      />
    </Shell>
  );
}

function MyHolds() {
  const state = useDisplayState();
  const all = useCollection<Hold>("holds");
  const mine = state === "state.empty" ? [] : all.items.filter((h) => h.memberId === "maya" && (h.status === "Active" || h.status === "Ready"));
  return (
    <Shell>
      <Heading id="heading.my-holds" text="My holds" />
      {state === "state.failed" && <FailedAlert />}
      <Section id="section.my-holds" title="Holds" count={mine.length} subtitle="A ready hold waits at the desk for 7 days.">
        <Table
          id="table.my-holds"
          columns={["Title", "Placed", { label: "Queue position", kind: "number" }, "Pickup copy", { label: "Status", kind: "status" }]}
          rows={mine.map((h) => ({
            id: `hold.${h.id}`,
            cells: [h.titleName, h.placedOn, h.status === "Ready" ? "-" : h.position, h.status === "Ready" ? `${h.barcode} until ${h.readyUntil}` : "-"],
            status: { text: h.status, tone: holdTone(h.status) },
            actions: [{ id: `hold.${h.id}.cancel`, label: "Cancel", emphasis: "danger" as const, onPress: () => all.update(h.id, { status: "Cancelled" }) }],
          }))}
          empty={<EmptyState id="empty.my-holds" title="No holds" text="Place a hold on a title whose copies are all out." actions={<Button id="btn.find-title" label="Find a title" to="screen.catalogue" />} />}
        />
      </Section>
    </Shell>
  );
}

function MyFees() {
  const state = useDisplayState();
  const all = useCollection<Fee>("fees");
  const mine = state === "state.empty" ? [] : all.items.filter((f) => f.memberId === "maya");
  const unpaid = mine.filter((f) => f.status === "Unpaid").reduce((sum, f) => sum + f.amountCents, 0);
  return (
    <Shell>
      <Heading id="heading.my-fees" text="My fees" />
      {state === "state.failed" && <FailedAlert />}
      <StatGroup>
        <Stat id="stat.balance" label="Unpaid balance" value={money(unpaid)} hint="pay at the desk" icon="Wallet" tone={unpaid > 0 ? "warning" : "success"} />
        <Stat id="stat.fee-count" label="Fees" value={String(mine.length)} hint="from late returns" icon="Receipt" />
      </StatGroup>
      <Section id="section.my-fees" title="Fees" count={mine.length} subtitle="A late return costs 0.25 per day, up to 10.00 per loan.">
        <Table
          id="table.my-fees"
          columns={["Title", { label: "Days late", kind: "number" }, { label: "Amount", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={mine.map((f) => ({
            id: `fee.${f.id}`,
            cells: [f.titleName, String(f.daysLate), money(f.amountCents)],
            status: { text: f.status, tone: feeTone(f.status) },
          }))}
          empty={<EmptyState id="empty.my-fees" title="No fees" text="You owe nothing." />}
        />
      </Section>
    </Shell>
  );
}

function LoansDesk() {
  const state = useDisplayState();
  const today = useToday();
  const loanList = useCollection<Loan>("loans");
  const copyList = useCollection<Copy>("copies");
  const holdList = useCollection<Hold>("holds");
  const feeList = useCollection<Fee>("fees");
  const [show, setShow] = useState("Open");
  const [notice, setNotice] = useState<{ tone: Tone; title: string; text: string } | null>(null);
  const rows = state === "state.empty" ? [] : loanList.items.filter((l) => {
    const s = loanState(l, today).text;
    return show === "All" || s === show || (show === "Open" && s === "Overdue");
  });
  const overdueCount = loanList.items.filter((l) => l.status === "Open" && l.dueOn < today).length;
  const openCount = loanList.items.filter((l) => l.status === "Open").length;

  const checkOut = (v: Record<string, string>) => {
    const copy = copyList.items.find((c) => c.barcode === (v.barcode ?? "").trim());
    const memberName = v.member ?? "Maya Fernando";
    const memberId = memberIdOf(memberName);
    const unpaid = feeList.items.filter((f) => f.memberId === memberId && f.status === "Unpaid").reduce((s, f) => s + f.amountCents, 0);
    const open = loanList.items.filter((l) => l.memberId === memberId && l.status === "Open").length;
    if (!copy) return setNotice({ tone: "error", title: "Check-out refused", text: "No copy has that barcode." });
    if (copy.status !== "Available") return setNotice({ tone: "error", title: "Check-out refused", text: `That copy is ${copy.status.toLowerCase()}.` });
    if (open >= 10) return setNotice({ tone: "error", title: "Check-out refused", text: `${memberName} already has 10 open loans.` });
    if (unpaid > 1000) return setNotice({ tone: "error", title: "Check-out refused", text: `${memberName} owes more than 10.00 in fees.` });
    const t = titles.find((x) => x.id === copy.titleId);
    loanList.create({
      copyId: copy.id, titleId: copy.titleId, titleName: t ? t.name : "", barcode: copy.barcode, memberId, memberName,
      checkedOutOn: today, dueOn: fromDayNum(dayNum(today) + 21), returnedOn: "", status: "Open", renewals: 0,
    });
    copyList.update(copy.id, { status: "On loan" });
    setNotice({ tone: "success", title: "Checked out", text: `${t ? t.name : "Copy"} is due ${fromDayNum(dayNum(today) + 21)}.` });
  };

  const checkIn = (l: Loan) => {
    const late = Math.max(0, dayNum(today) - dayNum(l.dueOn));
    loanList.update(l.id, { status: "Returned", returnedOn: today });
    copyList.update(l.copyId, { status: "Available" });
    if (late > 0) {
      const amount = Math.min(25 * late, 1000);
      feeList.create({ loanId: l.id, titleName: l.titleName, memberId: l.memberId, memberName: l.memberName, daysLate: late, amountCents: amount, status: "Unpaid" });
      setNotice({ tone: "warning", title: "Checked in late", text: `${late} days late: a fee of ${money(amount)} was added for ${l.memberName}.` });
    } else {
      setNotice({ tone: "success", title: "Checked in", text: `${l.titleName} is back on the shelf.` });
    }
  };

  const renew = (l: Loan) => {
    const waiting = holdList.items.some((h) => h.titleId === l.titleId && h.status === "Active");
    if (l.renewals >= 1) return setNotice({ tone: "error", title: "Renewal refused", text: "A loan can be renewed once." });
    if (waiting) return setNotice({ tone: "error", title: "Renewal refused", text: "Another member has a hold on this title." });
    loanList.update(l.id, { dueOn: fromDayNum(dayNum(l.dueOn) + 21), renewals: l.renewals + 1 });
    setNotice({ tone: "success", title: "Renewed", text: `${l.titleName} is now due ${fromDayNum(dayNum(l.dueOn) + 21)}.` });
  };

  return (
    <Shell>
      <Heading id="heading.loans" text="Loans" />
      {state === "state.failed" && <FailedAlert />}
      {notice && <Alert id="alert.notice" tone={notice.tone} title={notice.title} text={notice.text} />}
      <StatGroup>
        <Stat id="stat.open" label="Open loans" value={String(openCount)} hint="across all members" icon="ClipboardList" />
        <Stat id="stat.overdue" label="Overdue" value={String(overdueCount)} hint="past their due date" icon="Clock" tone={overdueCount > 0 ? "error" : "success"} />
      </StatGroup>
      <Section id="section.check-out" title="Check out a copy" subtitle="The loan period is 21 days.">
        {state === "state.validation-error" && (
          <ValidationSummary id="summary.check-out" issues={["Barcode is required", "That copy is already on loan"]} />
        )}
        <Form
          id="form.check-out"
          onSubmit={checkOut}
          actions={<Button id="btn.check-out" label="Check out" emphasis="primary" submit />}
        >
          <Field id="field.checkout-barcode" name="barcode" label="Copy barcode" required error={state === "state.validation-error" ? "Barcode is required" : undefined} />
          <Field id="field.checkout-member" name="member" label="Member" type="select" options={memberNames} defaultValue="Maya Fernando" />
        </Form>
      </Section>
      <Section id="section.loans" title="Loans" count={rows.length} subtitle="Check in or renew a loan from its row.">
        <Filters id="filters.loans">
          <Field id="field.loan-filter" label="Show" type="select" options={["Open", "Overdue", "Returned", "All"]} value={show} onChange={setShow} />
        </Filters>
        <Table
          id="table.loans"
          columns={["Title", "Barcode", "Member", "Due", { label: "Status", kind: "status" }]}
          rows={rows.map((l) => ({
            id: `loan.${l.id}`,
            cells: [l.titleName, l.barcode, l.memberName, l.dueOn],
            status: loanState(l, today),
            actions: l.status === "Open"
              ? [
                  { id: `loan.${l.id}.checkin`, label: "Check in", onPress: () => checkIn(l) },
                  { id: `loan.${l.id}.renew`, label: "Renew", onPress: () => renew(l) },
                ]
              : [],
          }))}
          empty={<EmptyState id="empty.loans" title="No loans" text="Nothing matches this view." />}
        />
      </Section>
    </Shell>
  );
}

function HoldsQueue() {
  const state = useDisplayState();
  const today = useToday();
  const holdList = useCollection<Hold>("holds");
  const copyList = useCollection<Copy>("copies");
  const loanList = useCollection<Loan>("loans");
  const [titleFilter, setTitleFilter] = useState("All titles");
  const live = holdList.items.filter((h) => h.status === "Active" || h.status === "Ready");
  const rows = state === "state.empty" ? [] : live.filter((h) => titleFilter === "All titles" || h.titleName === titleFilter);
  const spare = (titleId: string) => copyList.items.find((c) => c.titleId === titleId && c.status === "Available");
  const assign = (h: Hold) => {
    const copy = spare(h.titleId);
    if (!copy) return;
    copyList.update(copy.id, { status: "On hold shelf" });
    holdList.update(h.id, { status: "Ready", barcode: copy.barcode, readyUntil: fromDayNum(dayNum(today) + 7) });
  };
  const fulfil = (h: Hold) => {
    const copy = copyList.items.find((c) => c.barcode === h.barcode);
    if (copy) copyList.update(copy.id, { status: "On loan" });
    holdList.update(h.id, { status: "Fulfilled" });
    loanList.create({
      copyId: copy ? copy.id : "", titleId: h.titleId, titleName: h.titleName, barcode: h.barcode, memberId: h.memberId,
      memberName: h.memberName, checkedOutOn: today, dueOn: fromDayNum(dayNum(today) + 21), returnedOn: "", status: "Open", renewals: 0,
    });
  };
  const cancel = (h: Hold) => {
    const copy = copyList.items.find((c) => c.barcode === h.barcode);
    if (h.status === "Ready" && copy) copyList.update(copy.id, { status: "Available" });
    holdList.update(h.id, { status: "Cancelled" });
  };
  return (
    <Shell>
      <Heading id="heading.holds-queue" text="Holds queue" />
      {state === "state.failed" && <FailedAlert />}
      <Section id="section.holds" title="Active holds" count={rows.length} subtitle="Oldest first. A ready hold is kept for 7 days; cancel it when it lapses.">
        <Filters id="filters.holds">
          <Field id="field.hold-title" label="Title" type="select" options={["All titles", ...titles.map((t) => t.name)]} value={titleFilter} onChange={setTitleFilter} />
        </Filters>
        <Table
          id="table.holds"
          columns={["Title", "Member", "Placed", { label: "Position", kind: "number" }, "Copy", { label: "Status", kind: "status" }]}
          rows={rows.map((h) => ({
            id: `hold.${h.id}`,
            cells: [h.titleName, h.memberName, h.placedOn, h.status === "Ready" ? "-" : h.position, h.status === "Ready" ? `${h.barcode} until ${h.readyUntil}` : "-"],
            status: { text: h.status, tone: holdTone(h.status) },
            actions: [
              ...(h.status === "Active" && h.position === "1" && spare(h.titleId) ? [{ id: `hold.${h.id}.assign`, label: "Assign returned copy", onPress: () => assign(h) }] : []),
              ...(h.status === "Ready" ? [{ id: `hold.${h.id}.fulfil`, label: "Check out to member", onPress: () => fulfil(h) }] : []),
              { id: `hold.${h.id}.cancel`, label: "Cancel", emphasis: "danger" as const, onPress: () => cancel(h) },
            ],
          }))}
          empty={<EmptyState id="empty.holds" title="No holds waiting" text="Holds placed by members appear here." />}
        />
      </Section>
      <Button id="btn.to-loans" label="Go to loans" to="screen.loans" />
    </Shell>
  );
}

function FeesDesk() {
  const state = useDisplayState();
  const feeList = useCollection<Fee>("fees");
  const [who, setWho] = useState("All members");
  const rows = state === "state.empty" ? [] : feeList.items.filter((f) => who === "All members" || f.memberName === who);
  const unpaid = rows.filter((f) => f.status === "Unpaid").reduce((s, f) => s + f.amountCents, 0);
  return (
    <Shell>
      <Heading id="heading.fees" text="Fees" />
      {state === "state.failed" && <FailedAlert />}
      <StatGroup>
        <Stat id="stat.unpaid" label="Unpaid balance" value={money(unpaid)} hint={who} icon="Wallet" tone={unpaid > 0 ? "warning" : "success"} />
        <Stat id="stat.fee-rows" label="Fees" value={String(rows.length)} hint="in this view" icon="Receipt" />
      </StatGroup>
      <Section id="section.fees" title="Fees" count={rows.length} subtitle="Record a payment or waive a fee from its row. Payment is taken at the desk.">
        <Filters id="filters.fees">
          <Field id="field.fee-member" label="Member" type="select" options={["All members", ...memberNames]} value={who} onChange={setWho} />
        </Filters>
        <Table
          id="table.fees"
          columns={["Member", "Title", { label: "Days late", kind: "number" }, { label: "Amount", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={rows.map((f) => ({
            id: `fee.${f.id}`,
            cells: [f.memberName, f.titleName, String(f.daysLate), money(f.amountCents)],
            status: { text: f.status, tone: feeTone(f.status) },
            actions: f.status === "Unpaid"
              ? [
                  { id: `fee.${f.id}.pay`, label: "Record payment", onPress: () => feeList.update(f.id, { status: "Settled" }) },
                  { id: `fee.${f.id}.waive`, label: "Waive", emphasis: "danger" as const, onPress: () => feeList.update(f.id, { status: "Waived" }) },
                ]
              : [],
          }))}
          empty={<EmptyState id="empty.fees" title="No fees" text="Late returns create fees." />}
        />
      </Section>
    </Shell>
  );
}

function Account() {
  const user = useUser();
  const role = useRole();
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
        onSubmit={() => navigate.go("screen.catalogue")}
        actions={<Button id="btn.save-settings" label="Save settings" emphasis="primary" submit />}
      >
        <Field id="field.page-size" label="Rows per page" type="select" options={["20", "50", "100"]} defaultValue="20" />
      </Form>
    </Shell>
  );
}

function SignedOut() {
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to="screen.catalogue" />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.catalogue": Catalogue,
    "screen.title": TitleDetail,
    "screen.my-loans": MyLoans,
    "screen.my-holds": MyHolds,
    "screen.my-fees": MyFees,
    "screen.loans": LoansDesk,
    "screen.holds-queue": HoldsQueue,
    "screen.fees": FeesDesk,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { titles, copies, loans, holds, fees },
});
