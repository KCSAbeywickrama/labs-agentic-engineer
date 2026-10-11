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
  Heading, Screen, Section, Table, ValidationSummary, defineApp, useCollection,
  useDisplayState, useNav, useParams, useRole, useToday,
} from "@wso2/prototype-kit";

interface Title {
  id: string;
  name: string;
  author: string;
  subject: string;
  isbn: string;
  availableCopies: number;
}

interface Copy {
  id: string;
  titleId: string;
  titleName: string;
  barcode: string;
  status: "available" | "on-loan" | "on-hold" | "withdrawn";
}

interface Loan {
  id: string;
  titleId: string;
  titleName: string;
  copyId: string;
  memberId: string;
  memberName: string;
  checkedOutAt: string;
  dueDate: string;
  returnedAt?: string;
  feeAmount: number;
}

interface Hold {
  id: string;
  titleId: string;
  titleName: string;
  memberId: string;
  memberName: string;
  placedAt: string;
  status: "waiting" | "ready" | "fulfilled" | "cancelled";
  position: number;
}

interface Fee {
  id: string;
  loanId: string;
  titleName: string;
  memberId: string;
  memberName: string;
  amount: number;
  status: "unpaid" | "paid";
}

const titles: Title[] = [
  { id: "title.dune", name: "Dune", author: "Frank Herbert", subject: "Science fiction", isbn: "9780441013593", availableCopies: 1 },
  { id: "title.emma", name: "Emma", author: "Jane Austen", subject: "Romance", isbn: "9780141439587", availableCopies: 2 },
  { id: "title.hobbit", name: "The Hobbit", author: "J.R.R. Tolkien", subject: "Fantasy", isbn: "9780547928227", availableCopies: 0 },
  { id: "title.1984", name: "1984", author: "George Orwell", subject: "Dystopian fiction", isbn: "9780451524935", availableCopies: 0 },
  { id: "title.pride", name: "Pride and Prejudice", author: "Jane Austen", subject: "Romance", isbn: "9780141439518", availableCopies: 1 },
];

const copies: Copy[] = [
  { id: "copy.dune-1", titleId: "title.dune", titleName: "Dune", barcode: "D-1001", status: "available" },
  { id: "copy.dune-2", titleId: "title.dune", titleName: "Dune", barcode: "D-1002", status: "on-loan" },
  { id: "copy.emma-1", titleId: "title.emma", titleName: "Emma", barcode: "E-2001", status: "available" },
  { id: "copy.emma-2", titleId: "title.emma", titleName: "Emma", barcode: "E-2002", status: "available" },
  { id: "copy.hobbit-1", titleId: "title.hobbit", titleName: "The Hobbit", barcode: "H-3001", status: "on-loan" },
  { id: "copy.1984-1", titleId: "title.1984", titleName: "1984", barcode: "O-4001", status: "on-hold" },
  { id: "copy.pride-1", titleId: "title.pride", titleName: "Pride and Prejudice", barcode: "P-5001", status: "available" },
];

const loans: Loan[] = [
  { id: "loan.hobbit-mia", titleId: "title.hobbit", titleName: "The Hobbit", copyId: "copy.hobbit-1", memberId: "member.mia", memberName: "Mia Alvarez", checkedOutAt: "2026-01-08", dueDate: "2026-01-22", feeAmount: 0 },
  { id: "loan.dune-dan", titleId: "title.dune", titleName: "Dune", copyId: "copy.dune-2", memberId: "member.dan", memberName: "Dan Okafor", checkedOutAt: "2025-12-28", dueDate: "2026-01-11", feeAmount: 0 },
  { id: "loan.emma-mia-prev", titleId: "title.emma", titleName: "Emma", copyId: "copy.emma-1", memberId: "member.mia", memberName: "Mia Alvarez", checkedOutAt: "2025-12-01", dueDate: "2025-12-15", returnedAt: "2025-12-19", feeAmount: 1.0 },
  { id: "loan.1984-dan-prev", titleId: "title.1984", titleName: "1984", copyId: "copy.1984-1", memberId: "member.dan", memberName: "Dan Okafor", checkedOutAt: "2025-11-01", dueDate: "2025-11-15", returnedAt: "2025-11-23", feeAmount: 2.0 },
];

const holds: Hold[] = [
  { id: "hold.1984-dan", titleId: "title.1984", titleName: "1984", memberId: "member.dan", memberName: "Dan Okafor", placedAt: "2026-01-09T09:00:00Z", status: "waiting", position: 1 },
  { id: "hold.1984-mia", titleId: "title.1984", titleName: "1984", memberId: "member.mia", memberName: "Mia Alvarez", placedAt: "2026-01-11T09:00:00Z", status: "waiting", position: 2 },
];

const fees: Fee[] = [
  { id: "fee.mia-1", loanId: "loan.emma-mia-prev", titleName: "Emma", memberId: "member.mia", memberName: "Mia Alvarez", amount: 1.0, status: "unpaid" },
  { id: "fee.dan-1", loanId: "loan.1984-dan-prev", titleName: "1984", memberId: "member.dan", memberName: "Dan Okafor", amount: 2.0, status: "unpaid" },
];

const memberUser = { name: "Mia Alvarez", email: "mia@example.com" };
const librarianUser = { name: "Lena Brooks", email: "lena@example.com" };
const CURRENT_MEMBER_ID = "member.mia";

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  const memberNav = [
    { id: "nav.catalogue", label: "Catalogue", to: "screen.catalogue" },
    { id: "nav.loans", label: "My loans", to: "screen.loans" },
    { id: "nav.holds", label: "My holds", to: "screen.holds" },
    { id: "nav.fees", label: "My fees", to: "screen.fees" },
  ];
  const librarianNav = [
    { id: "nav.titles", label: "Titles", to: "screen.titles" },
    { id: "nav.loans-all", label: "Loans", to: "screen.loans-all" },
    { id: "nav.holds-queue", label: "Holds queue", to: "screen.holds-queue" },
    { id: "nav.fees-all", label: "Fees", to: "screen.fees-all" },
  ];
  return (
    <AppShell
      id="shell"
      user={role === "Librarian" ? librarianUser : memberUser}
      nav={role === "Librarian" ? librarianNav : memberNav}
      account="screen.account"
      settings="screen.settings"
      signOut="screen.signed-out"
    >
      {children}
    </AppShell>
  );
}

function Catalogue() {
  const state = useDisplayState();
  const all = useCollection<Title>("titles");
  const [query, setQuery] = useState("");
  const results = state === "state.empty"
    ? []
    : all.items.filter((t) =>
        [t.name, t.author, t.subject].some((v) => v.toLowerCase().includes(query.toLowerCase())),
      );
  return (
    <Shell>
      <Heading id="heading.catalogue" text="Catalogue" />
      {state === "state.failed" && (
        <Alert id="alert.catalogue-failed" tone="error" title="Catalogue unavailable" text="The catalogue service could not be reached. Try again shortly." />
      )}
      <Section id="section.titles" title="Titles" count={results.length} subtitle="Search by title, author or subject.">
        <Filters id="filters.catalogue">
          <Field id="field.query" label="Search" value={query} onChange={setQuery} placeholder="Herbert, Romance, Dune…" />
        </Filters>
        <Table
          id="table.titles"
          columns={["Title", "Author", "Subject", { label: "Available", kind: "number" }]}
          rows={results.map((t) => ({
            id: `title.${t.id}`,
            cells: [t.name, t.author, t.subject, String(t.availableCopies)],
            to: "screen.title",
            params: { title: t.id },
          }))}
          empty={<EmptyState id="empty.catalogue" title="No titles match" text="Try a different title, author or subject." />}
        />
      </Section>
    </Shell>
  );
}

function TitleDetail() {
  const { title: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const allTitles = useCollection<Title>("titles");
  const allCopies = useCollection<Copy>("copies");
  const allLoans = useCollection<Loan>("loans");
  const allHolds = useCollection<Hold>("holds");
  const title = (id ? allTitles.get(id) : undefined) ?? allTitles.items[0]!;
  const hasHold = allHolds.items.some((h) => h.titleId === title.id && h.memberId === CURRENT_MEMBER_ID && h.status === "waiting");

  const borrow = () => {
    const freeCopy = allCopies.items.find((c) => c.titleId === title.id && c.status === "available");
    if (!freeCopy) return;
    allCopies.update(freeCopy.id, { status: "on-loan" });
    allTitles.update(title.id, { availableCopies: Math.max(0, title.availableCopies - 1) });
    allLoans.create({
      titleId: title.id,
      titleName: title.name,
      copyId: freeCopy.id,
      memberId: CURRENT_MEMBER_ID,
      memberName: "Mia Alvarez",
      checkedOutAt: "2026-01-15",
      dueDate: "2026-01-29",
      feeAmount: 0,
    });
    navigate.go("screen.loans");
  };

  const placeHold = () => {
    allHolds.create({
      titleId: title.id,
      titleName: title.name,
      memberId: CURRENT_MEMBER_ID,
      memberName: "Mia Alvarez",
      placedAt: "2026-01-15T09:00:00Z",
      status: "waiting",
      position: allHolds.items.filter((h) => h.titleId === title.id && h.status === "waiting").length + 1,
    });
    navigate.go("screen.holds");
  };

  return (
    <Shell>
      <Breadcrumbs id="breadcrumbs.title" items={[{ id: "crumb.catalogue", label: "Catalogue", to: "screen.catalogue" }, { id: "crumb.title", label: title.name }]} />
      <Heading id="heading.title" text={title.name} />
      {state === "state.validation-error" && (
        <Alert id="alert.title-validation" tone="error" title="Can't place a hold" text="You already have a waiting hold on this title." />
      )}
      <Detail
        id="detail.title"
        fields={[
          { label: "Author", value: title.author },
          { label: "Subject", value: title.subject },
          { label: "ISBN", value: title.isbn },
          { label: "Available copies", value: String(title.availableCopies) },
        ]}
      />
      <Button
        id="btn.borrow"
        label="Borrow"
        emphasis="primary"
        disabled={title.availableCopies === 0}
        onPress={borrow}
      />
      <Button
        id="btn.hold"
        label="Place a hold"
        disabled={title.availableCopies > 0 || hasHold}
        onPress={placeHold}
      />
    </Shell>
  );
}

function MyLoans() {
  const state = useDisplayState();
  const all = useCollection<Loan>("loans");
  const today = useToday();
  const mine = state === "state.empty" ? [] : all.items.filter((l) => l.memberId === CURRENT_MEMBER_ID);
  return (
    <Shell>
      <Heading id="heading.loans" text="My loans" />
      <Section id="section.loans" title="Loans" count={mine.length} subtitle="Return by the due date to avoid a late fee.">
        <Table
          id="table.loans"
          columns={["Title", "Checked out", "Due date", { label: "Status", kind: "status" }]}
          rows={mine.map((l) => ({
            id: `loan.${l.id}`,
            cells: [l.titleName, l.checkedOutAt, l.dueDate],
            status: l.returnedAt
              ? { text: "Returned", tone: "default" }
              : l.dueDate < today
                ? { text: "Overdue", tone: "error" }
                : { text: "Active", tone: "success" },
          }))}
          empty={<EmptyState id="empty.loans" title="No loans yet" text="Borrow a title from the catalogue to see it here." />}
        />
      </Section>
    </Shell>
  );
}

function MyHolds() {
  const state = useDisplayState();
  const all = useCollection<Hold>("holds");
  const navigate = useNav();
  const mine = state === "state.empty" ? [] : all.items.filter((h) => h.memberId === CURRENT_MEMBER_ID && h.status !== "cancelled");
  return (
    <Shell>
      <Heading id="heading.holds" text="My holds" />
      <Section id="section.holds" title="Holds" count={mine.length} subtitle="Waiting holds in queue order.">
        <Table
          id="table.holds"
          columns={["Title", "Placed", { label: "Status", kind: "status" }, { label: "Position", kind: "number" }]}
          rows={mine.map((h) => ({
            id: `hold.${h.id}`,
            cells: [h.titleName, h.placedAt.slice(0, 10), String(h.position)],
            status: { text: h.status, tone: h.status === "ready" ? "success" : "warning" },
            actions: [{ id: `hold.${h.id}.cancel`, label: "Cancel", emphasis: "danger", onPress: () => { all.remove(h.id); navigate.go("screen.holds"); } }],
          }))}
          empty={<EmptyState id="empty.holds" title="No holds" text="Place a hold from a title with no available copy." />}
        />
      </Section>
    </Shell>
  );
}

function MyFees() {
  const state = useDisplayState();
  const all = useCollection<Fee>("fees");
  const mine = state === "state.empty" ? [] : all.items.filter((f) => f.memberId === CURRENT_MEMBER_ID);
  const unpaidTotal = mine.filter((f) => f.status === "unpaid").reduce((sum, f) => sum + f.amount, 0);
  return (
    <Shell>
      <Heading id="heading.fees" text="My fees" />
      {unpaidTotal > 0 && (
        <Alert id="alert.unpaid-fees" tone="warning" title="You have unpaid fees" text="Settle unpaid fees at the desk; you cannot borrow while fees are unpaid." />
      )}
      <Section id="section.fees" title="Fees" count={mine.length} subtitle="Fees are settled at the desk.">
        <Table
          id="table.fees"
          columns={["Title", { label: "Amount", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={mine.map((f) => ({
            id: `fee.${f.id}`,
            cells: [f.titleName, money(f.amount)],
            status: { text: f.status, tone: f.status === "unpaid" ? "warning" : "success" },
          }))}
          empty={<EmptyState id="empty.fees" title="No fees" text="Late fees appear here after an overdue return." />}
        />
      </Section>
    </Shell>
  );
}

function Titles() {
  const state = useDisplayState();
  const all = useCollection<Title>("titles");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Title | null>(null);
  const results = state === "state.empty" ? [] : all.items;

  const submitAdd = (values: Record<string, string>) => {
    all.create({ name: values.name, author: values.author, subject: values.subject ?? "", isbn: values.isbn ?? "", availableCopies: 0 });
    setAdding(false);
  };
  const submitEdit = (values: Record<string, string>) => {
    if (!editing) return;
    all.update(editing.id, { name: values.name, author: values.author, subject: values.subject, isbn: values.isbn });
    setEditing(null);
  };

  return (
    <Shell>
      <Heading id="heading.titles" text="Titles" actions={<Button id="btn.add-title" label="Add title" emphasis="primary" onPress={() => setAdding(true)} />} />
      <Section id="section.titles-admin" title="Titles" count={results.length} subtitle="Manage the catalogue's titles.">
        <Table
          id="table.titles-admin"
          columns={["Title", "Author", "Subject", { label: "Available", kind: "number" }]}
          rows={results.map((t) => ({
            id: `titleadmin.${t.id}`,
            cells: [t.name, t.author, t.subject, String(t.availableCopies)],
            to: "screen.title-manage",
            params: { title: t.id },
            actions: [
              { id: `titleadmin.${t.id}.edit`, label: "Edit", onPress: () => setEditing(t) },
              { id: `titleadmin.${t.id}.remove`, label: "Remove", emphasis: "danger", onPress: () => all.remove(t.id) },
            ],
          }))}
          empty={<EmptyState id="empty.titles-admin" title="No titles" text="Add a title to start the catalogue." actions={<Button id="btn.add-title-empty" label="Add title" emphasis="primary" onPress={() => setAdding(true)} />} />}
        />
      </Section>
      <Dialog id="dialog.add-title" title="Add title" open={adding} onClose={() => setAdding(false)}>
        {state === "state.validation-error" && <ValidationSummary id="summary.add-title" issues={["Title name is required", "Author is required"]} />}
        <Form id="form.add-title" onSubmit={submitAdd} actions={<Button id="btn.add-title.confirm" label="Add title" emphasis="primary" submit />}>
          <Field id="field.add-name" name="name" label="Title" required />
          <Field id="field.add-author" name="author" label="Author" required />
          <Field id="field.add-subject" name="subject" label="Subject" />
          <Field id="field.add-isbn" name="isbn" label="ISBN" />
        </Form>
      </Dialog>
      <Dialog id="dialog.edit-title" title={`Edit ${editing?.name ?? "title"}`} open={!!editing} onClose={() => setEditing(null)}>
        <Form id="form.edit-title" onSubmit={submitEdit} actions={<Button id="btn.edit-title.confirm" label="Save" emphasis="primary" submit />}>
          <Field id="field.edit-name" name="name" label="Title" defaultValue={editing?.name} required />
          <Field id="field.edit-author" name="author" label="Author" defaultValue={editing?.author} required />
          <Field id="field.edit-subject" name="subject" label="Subject" defaultValue={editing?.subject} />
          <Field id="field.edit-isbn" name="isbn" label="ISBN" defaultValue={editing?.isbn} />
        </Form>
      </Dialog>
    </Shell>
  );
}

function TitleManage() {
  const { title: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const allTitles = useCollection<Title>("titles");
  const allCopies = useCollection<Copy>("copies");
  const allLoans = useCollection<Loan>("loans");
  const title = (id ? allTitles.get(id) : undefined) ?? allTitles.items[0]!;
  const titleCopies = state === "state.empty" ? [] : allCopies.items.filter((c) => c.titleId === title.id);
  const [adding, setAdding] = useState(false);
  const [checkingOut, setCheckingOut] = useState<Copy | null>(null);

  const addCopy = (values: Record<string, string>) => {
    allCopies.create({ titleId: title.id, titleName: title.name, barcode: values.barcode, status: "available" });
    allTitles.update(title.id, { availableCopies: title.availableCopies + 1 });
    setAdding(false);
  };

  const withdraw = (copy: Copy) => {
    if (copy.status === "available") {
      allTitles.update(title.id, { availableCopies: Math.max(0, title.availableCopies - 1) });
    }
    allCopies.update(copy.id, { status: "withdrawn" });
  };

  const checkOut = (values: Record<string, string>) => {
    if (!checkingOut) return;
    allCopies.update(checkingOut.id, { status: "on-loan" });
    if (checkingOut.status === "available") {
      allTitles.update(title.id, { availableCopies: Math.max(0, title.availableCopies - 1) });
    }
    allLoans.create({
      titleId: title.id,
      titleName: title.name,
      copyId: checkingOut.id,
      memberId: `member.${values.member.toLowerCase().replace(/\s+/g, "-")}`,
      memberName: values.member,
      checkedOutAt: "2026-01-15",
      dueDate: "2026-01-29",
      feeAmount: 0,
    });
    setCheckingOut(null);
    navigate.go("screen.loans-all");
  };

  return (
    <Shell>
      <Breadcrumbs id="breadcrumbs.title-manage" items={[{ id: "crumb.titles", label: "Titles", to: "screen.titles" }, { id: "crumb.title-manage", label: title.name }]} />
      <Heading id="heading.title-manage" text={title.name} />
      <Detail
        id="detail.title-manage"
        fields={[
          { label: "Author", value: title.author },
          { label: "Subject", value: title.subject },
          { label: "Available copies", value: String(title.availableCopies) },
        ]}
      />
      <Section id="section.copies" title="Copies" count={titleCopies.length} subtitle="Add, withdraw or check out a copy." actions={<Button id="btn.add-copy" label="Add copy" emphasis="primary" onPress={() => setAdding(true)} />}>
        <Table
          id="table.copies"
          columns={["Barcode", { label: "Status", kind: "status" }]}
          rows={titleCopies.map((c) => ({
            id: `copy.${c.id}`,
            cells: [c.barcode],
            status: { text: c.status, tone: c.status === "available" ? "success" : c.status === "withdrawn" ? "default" : "warning" },
            actions: [
              { id: `copy.${c.id}.checkout`, label: "Check out", onPress: () => setCheckingOut(c), ...(c.status !== "available" ? { disabled: true } : {}) },
              { id: `copy.${c.id}.withdraw`, label: "Withdraw", emphasis: "danger", onPress: () => withdraw(c) },
            ],
          }))}
          empty={<EmptyState id="empty.copies" title="No copies" text="Add a copy to make this title available." />}
        />
      </Section>
      {state === "state.validation-error" && <ValidationSummary id="summary.add-copy" issues={["Barcode is required"]} />}
      <Dialog id="dialog.add-copy" title="Add copy" open={adding} onClose={() => setAdding(false)}>
        <Form id="form.add-copy" onSubmit={addCopy} actions={<Button id="btn.add-copy.confirm" label="Add copy" emphasis="primary" submit />}>
          <Field id="field.barcode" name="barcode" label="Barcode" required />
        </Form>
      </Dialog>
      <Dialog id="dialog.check-out" title={`Check out ${checkingOut?.barcode ?? "copy"}`} open={!!checkingOut} onClose={() => setCheckingOut(null)}>
        <Form id="form.check-out" onSubmit={checkOut} actions={<Button id="btn.check-out.confirm" label="Check out" emphasis="primary" submit />}>
          <Field id="field.member" name="member" label="Member name" required />
        </Form>
      </Dialog>
    </Shell>
  );
}

function LoansAll() {
  const state = useDisplayState();
  const allLoans = useCollection<Loan>("loans");
  const allCopies = useCollection<Copy>("copies");
  const allTitles = useCollection<Title>("titles");
  const allHolds = useCollection<Hold>("holds");
  const allFees = useCollection<Fee>("fees");
  const today = useToday();
  const [checkingIn, setCheckingIn] = useState<Loan | null>(null);
  const items = state === "state.empty" ? [] : allLoans.items;

  const daysLate = (loan: Loan) => {
    const due = new Date(loan.dueDate).getTime();
    const now = new Date(today).getTime();
    return Math.max(0, Math.round((now - due) / 86400000));
  };

  const confirmCheckIn = () => {
    if (!checkingIn) return;
    const late = daysLate(checkingIn);
    const fee = late * 0.25;
    allLoans.update(checkingIn.id, { returnedAt: today, feeAmount: fee });
    if (fee > 0) {
      allFees.create({ loanId: checkingIn.id, titleName: checkingIn.titleName, memberId: checkingIn.memberId, memberName: checkingIn.memberName, amount: fee, status: "unpaid" });
    }
    const waitingHold = allHolds.items.find((h) => h.titleId === checkingIn.titleId && h.status === "waiting");
    if (waitingHold) {
      allCopies.update(checkingIn.copyId, { status: "on-hold" });
      allHolds.update(waitingHold.id, { status: "ready" });
    } else {
      allCopies.update(checkingIn.copyId, { status: "available" });
      const title = allTitles.get(checkingIn.titleId);
      if (title) allTitles.update(title.id, { availableCopies: title.availableCopies + 1 });
    }
    setCheckingIn(null);
  };

  return (
    <Shell>
      <Heading id="heading.loans-all" text="Loans" />
      <Section id="section.loans-all" title="Loans" count={items.length} subtitle="Check in a copy to close its loan.">
        <Table
          id="table.loans-all"
          columns={["Title", "Member", "Due date", { label: "Status", kind: "status" }]}
          rows={items.map((l) => ({
            id: `loanall.${l.id}`,
            cells: [l.titleName, l.memberName, l.dueDate],
            status: l.returnedAt
              ? { text: "Returned", tone: "default" }
              : l.dueDate < today
                ? { text: "Overdue", tone: "error" }
                : { text: "Active", tone: "success" },
            actions: l.returnedAt ? [] : [{ id: `loanall.${l.id}.checkin`, label: "Check in", onPress: () => setCheckingIn(l) }],
          }))}
          empty={<EmptyState id="empty.loans-all" title="No loans" text="Check a copy out to a member to see it here." />}
        />
      </Section>
      <Dialog id="dialog.check-in" title={`Check in ${checkingIn?.titleName ?? "loan"}`} open={!!checkingIn} onClose={() => setCheckingIn(null)} actions={<Button id="btn.check-in.confirm" label="Check in" emphasis="primary" onPress={confirmCheckIn} />}>
        {checkingIn && daysLate(checkingIn) > 0 ? (
          <Alert id="alert.late-fee" tone="warning" title="This return is late" text={`${daysLate(checkingIn)} day(s) overdue — a fee of ${money(daysLate(checkingIn) * 0.25)} will be created.`} />
        ) : (
          <Alert id="alert.on-time" tone="success" title="Returned on time" text="No fee will be created." />
        )}
      </Dialog>
    </Shell>
  );
}

function HoldsQueue() {
  const state = useDisplayState();
  const all = useCollection<Hold>("holds");
  const [titleFilter, setTitleFilter] = useState("");
  const items = (state === "state.empty" ? [] : all.items.filter((h) => h.status !== "cancelled"))
    .filter((h) => !titleFilter || h.titleName === titleFilter)
    .sort((a, b) => a.position - b.position);
  const titleOptions = Array.from(new Set(all.items.map((h) => h.titleName)));

  return (
    <Shell>
      <Heading id="heading.holds-queue" text="Holds queue" />
      <Section id="section.holds-queue" title="Holds" count={items.length} subtitle="First come, first served per title.">
        <Filters id="filters.holds-queue">
          <Field id="field.title-filter" label="Title" type="select" value={titleFilter} onChange={setTitleFilter} options={["", ...titleOptions]} />
        </Filters>
        <Table
          id="table.holds-queue"
          columns={["Title", "Member", { label: "Position", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={items.map((h) => ({
            id: `holdqueue.${h.id}`,
            cells: [h.titleName, h.memberName, String(h.position)],
            status: { text: h.status, tone: h.status === "ready" ? "success" : "warning" },
            actions: [{ id: `holdqueue.${h.id}.cancel`, label: "Cancel", emphasis: "danger", onPress: () => all.remove(h.id) }],
          }))}
          empty={<EmptyState id="empty.holds-queue" title="No holds" text="Holds appear here once a member places one." />}
        />
      </Section>
    </Shell>
  );
}

function FeesAll() {
  const state = useDisplayState();
  const all = useCollection<Fee>("fees");
  const items = state === "state.empty" ? [] : all.items;
  return (
    <Shell>
      <Heading id="heading.fees-all" text="Fees" />
      <Section id="section.fees-all" title="Fees" count={items.length} subtitle="Mark a fee paid once it is settled at the desk.">
        <Table
          id="table.fees-all"
          columns={["Title", "Member", { label: "Amount", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={items.map((f) => ({
            id: `feeall.${f.id}`,
            cells: [f.titleName, f.memberName, money(f.amount)],
            status: { text: f.status, tone: f.status === "unpaid" ? "warning" : "success" },
            actions: f.status === "unpaid" ? [{ id: `feeall.${f.id}.pay`, label: "Mark paid", onPress: () => all.update(f.id, { status: "paid" }) }] : [],
          }))}
          empty={<EmptyState id="empty.fees-all" title="No fees" text="Late fees appear here after an overdue return." />}
        />
      </Section>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const user = role === "Librarian" ? librarianUser : memberUser;
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail id="detail.account" fields={[{ label: "Name", value: user.name }, { label: "Email", value: user.email }, { label: "Role", value: role }]} />
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
        text="The library sends no email or notifications: open the app to see your loans, holds and fees."
      />
    </Shell>
  );
}

function SignedOut() {
  const role = useRole();
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to={role === "Librarian" ? "screen.titles" : "screen.catalogue"} />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.catalogue": Catalogue,
    "screen.title": TitleDetail,
    "screen.loans": MyLoans,
    "screen.holds": MyHolds,
    "screen.fees": MyFees,
    "screen.titles": Titles,
    "screen.title-manage": TitleManage,
    "screen.loans-all": LoansAll,
    "screen.holds-queue": HoldsQueue,
    "screen.fees-all": FeesAll,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { titles, copies, loans, holds, fees },
});
