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
  Section, Stat, StatGroup, Table, ValidationSummary, defineApp, useCollection, useDisplayState, useNav,
  useParams, useRole, useToday,
} from "@wso2/prototype-kit";

interface Title { id: string; name: string; author: string; subject: string; isbn: string; availableCopies: number }
interface Copy { id: string; titleId: string; barcode: string; status: string }
interface Loan { id: string; title: string; copyBarcode: string; memberId: string; checkedOut: string; due: string; returned: string; status: string }
interface Hold { id: string; titleId: string; title: string; memberId: string; placed: string; status: string; position: string }
interface Fee { id: string; loan: string; memberId: string; amount: string; status: string }

const ME = "m-1001";

const titles: Title[] = [
  { id: "t-1", name: "The Hobbit", author: "J.R.R. Tolkien", subject: "Fantasy", isbn: "9780261102217", availableCopies: 2 },
  { id: "t-2", name: "Dune", author: "Frank Herbert", subject: "Science fiction", isbn: "9780441172719", availableCopies: 0 },
  { id: "t-3", name: "Emma", author: "Jane Austen", subject: "Romance", isbn: "9780141439587", availableCopies: 1 },
  { id: "t-4", name: "Neuromancer", author: "William Gibson", subject: "Science fiction", isbn: "9780441569595", availableCopies: 3 },
];

const copies: Copy[] = [
  { id: "c-1", titleId: "t-1", barcode: "HOB-001", status: "available" },
  { id: "c-2", titleId: "t-1", barcode: "HOB-002", status: "on-loan" },
  { id: "c-3", titleId: "t-1", barcode: "HOB-003", status: "available" },
  { id: "c-4", titleId: "t-2", barcode: "DUN-001", status: "on-loan" },
  { id: "c-5", titleId: "t-2", barcode: "DUN-002", status: "on-hold" },
  { id: "c-6", titleId: "t-3", barcode: "EMM-001", status: "available" },
  { id: "c-7", titleId: "t-4", barcode: "NEU-001", status: "available" },
];

const loans: Loan[] = [
  { id: "l-1", title: "The Hobbit", copyBarcode: "HOB-002", memberId: ME, checkedOut: "2026-01-05", due: "2026-01-19", returned: "", status: "On loan" },
  { id: "l-2", title: "Emma", copyBarcode: "EMM-002", memberId: ME, checkedOut: "2025-12-28", due: "2026-01-11", returned: "", status: "Overdue" },
  { id: "l-3", title: "Dune", copyBarcode: "DUN-001", memberId: "m-2210", checkedOut: "2026-01-02", due: "2026-01-16", returned: "", status: "On loan" },
];

const holds: Hold[] = [
  { id: "h-1", titleId: "t-2", title: "Dune", memberId: ME, placed: "2026-01-10", status: "Waiting", position: "2" },
  { id: "h-2", titleId: "t-2", title: "Dune", memberId: "m-2210", placed: "2026-01-09", status: "Ready", position: "1" },
];

const fees: Fee[] = [
  { id: "f-1", loan: "Emma", memberId: ME, amount: "1.00", status: "Unpaid" },
  { id: "f-2", loan: "Dune", memberId: "m-2210", amount: "0.75", status: "Unpaid" },
  { id: "f-3", loan: "Persuasion", memberId: "m-3300", amount: "2.50", status: "Paid" },
];

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  const librarian = role === "Librarian";
  const user = librarian
    ? { name: "Lena Fonseka", email: "lena@library.example" }
    : { name: "Mia Perera", email: "mia@library.example" };
  const nav = librarian
    ? [
        { id: "nav.titles", label: "Titles", to: "screen.manage-titles" },
        { id: "nav.checkout", label: "Check out", to: "screen.checkout" },
        { id: "nav.checkin", label: "Check in", to: "screen.checkin" },
        { id: "nav.holds-queue", label: "Holds queue", to: "screen.holds-queue" },
        { id: "nav.fees", label: "Fees", to: "screen.fees-desk" },
      ]
    : [
        { id: "nav.catalogue", label: "Catalogue", to: "screen.catalogue" },
        { id: "nav.loans", label: "My loans", to: "screen.my-loans" },
        { id: "nav.holds", label: "My holds", to: "screen.my-holds" },
        { id: "nav.fees", label: "My fees", to: "screen.my-fees" },
      ];
  return (
    <AppShell id="shell" user={user} nav={nav} account="screen.account" settings="screen.settings" signOut="screen.signed-out">
      {children}
    </AppShell>
  );
}

function FailedAlert() {
  return (
    <Alert id="alert.failed" tone="error" title="Library service unavailable" text="The circulation service did not answer. Try again in a few minutes." />
  );
}

function copyTone(status: string) {
  if (status === "available") return "success" as const;
  if (status === "withdrawn") return "error" as const;
  return "warning" as const;
}

function Catalogue() {
  const state = useDisplayState();
  const all = useCollection<Title>("titles");
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const found = state === "state.empty" ? [] : all.items.filter((t) =>
    term === "" || [t.name, t.author, t.subject].some((v) => v.toLowerCase().includes(term)));
  return (
    <Shell>
      <Heading id="heading.catalogue" text="Catalogue" />
      {state === "state.failed" && <FailedAlert />}
      <Section id="section.titles" title="Titles" count={found.length} subtitle="Search by title, author or subject. Open a title to borrow it or place a hold.">
        <Filters id="filters.search">
          <Field id="field.search" label="Search" placeholder="Title, author or subject" value={q} onChange={setQ} />
        </Filters>
        <Table
          id="table.titles"
          columns={["Title", "Author", "Subject", { label: "Available", kind: "number" }]}
          rows={found.map((t) => ({
            id: `title.${t.id}`,
            cells: [t.name, t.author, t.subject, String(t.availableCopies)],
            to: "screen.title-detail",
            params: { title: t.id },
          }))}
          empty={<EmptyState id="empty.titles" title="No titles found" text="Try another title, author or subject." />}
        />
      </Section>
    </Shell>
  );
}

function TitleDetail() {
  const { title: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const today = useToday();
  const all = useCollection<Title>("titles");
  const loanList = useCollection<Loan>("loans");
  const holdList = useCollection<Hold>("holds");
  const title = (id ? all.get(id) : undefined) ?? all.items[0]!;
  const none = title.availableCopies === 0;
  const blocked = state === "state.blocked";
  const borrow = () => {
    if (blocked || none) return;
    loanList.create({ title: title.name, copyBarcode: "NEW-001", memberId: ME, checkedOut: today, due: "2026-01-29", returned: "", status: "On loan" });
    all.update(title.id, { availableCopies: title.availableCopies - 1 });
    navigate.go("screen.my-loans");
  };
  const hold = () => {
    if (blocked) return;
    holdList.create({ titleId: title.id, title: title.name, memberId: ME, placed: today, status: "Waiting", position: "3" });
    navigate.go("screen.my-holds");
  };
  return (
    <Shell>
      <Breadcrumbs id="crumbs.title" items={[
        { id: "crumb.catalogue", label: "Catalogue", to: "screen.catalogue" },
        { id: "crumb.title", label: title.name },
      ]} />
      <Heading id="heading.title" text={title.name} />
      {state === "state.failed" && <FailedAlert />}
      {blocked && (
        <Alert id="alert.blocked" tone="error" title="Cannot borrow or hold" text="You have 5 active loans or an unpaid fee, or you already hold this title. Settle it at the desk and try again." />
      )}
      <Section
        id="section.title"
        title="Details"
        actions={
          <Stack2>
            <Button id="btn.hold" label="Place hold" onPress={hold} disabled={!none} />
            <Button id="btn.borrow" label="Borrow" emphasis="primary" onPress={borrow} disabled={none} />
          </Stack2>
        }
      >
        <Detail id="detail.title" fields={[
          { label: "Author", value: title.author },
          { label: "Subject", value: title.subject },
          { label: "ISBN", value: title.isbn },
        ]} />
        <Badge id="badge.availability" label={`${title.availableCopies} copies available`} tone={none ? "warning" : "success"} />
      </Section>
    </Shell>
  );
}

function Stack2({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function MyLoans() {
  const state = useDisplayState();
  const all = useCollection<Loan>("loans");
  const mine = state === "state.empty" ? [] : all.items.filter((l) => l.memberId === ME && l.returned === "");
  return (
    <Shell>
      <Heading id="heading.loans" text="My loans" />
      {state === "state.failed" && <FailedAlert />}
      <StatGroup>
        <Stat id="stat.active" label="Active loans" value={String(mine.length)} hint="of 5 allowed" icon="Receipt" />
        <Stat id="stat.overdue" label="Overdue" value={String(mine.filter((l) => l.status === "Overdue").length)} hint="return at the desk" icon="Clock" tone="warning" />
      </StatGroup>
      <Section id="section.loans" title="Current loans" count={mine.length} subtitle="Late returns cost 0.25 per day.">
        <Table
          id="table.loans"
          columns={["Title", "Checked out", "Due", { label: "Status", kind: "status" }]}
          rows={mine.map((l) => ({
            id: `loan.${l.id}`,
            cells: [l.title, l.checkedOut, l.due],
            status: { text: l.status, tone: l.status === "Overdue" ? "error" : "info" },
          }))}
          empty={<EmptyState id="empty.loans" title="No active loans" text="Borrow a title from the catalogue." actions={<Button id="btn.browse" label="Browse catalogue" to="screen.catalogue" />} />}
        />
      </Section>
    </Shell>
  );
}

function MyHolds() {
  const state = useDisplayState();
  const all = useCollection<Hold>("holds");
  const mine = state === "state.empty" ? [] : all.items.filter((h) => h.memberId === ME);
  return (
    <Shell>
      <Heading id="heading.holds" text="My holds" />
      {state === "state.failed" && <FailedAlert />}
      <Section id="section.holds" title="Holds" count={mine.length} subtitle="You get the copy when it is returned, first come first served.">
        <Table
          id="table.holds"
          columns={["Title", { label: "Position", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={mine.map((h) => ({
            id: `hold.${h.id}`,
            cells: [h.title, h.position],
            status: { text: h.status, tone: h.status === "Ready" ? "success" : "warning" },
            actions: [{ id: `hold.${h.id}.cancel`, label: "Cancel hold", emphasis: "danger", onPress: () => all.remove(h.id) }],
          }))}
          empty={<EmptyState id="empty.holds" title="No holds" text="Place a hold on a title with no available copy." />}
        />
      </Section>
    </Shell>
  );
}

function MyFees() {
  const state = useDisplayState();
  const all = useCollection<Fee>("fees");
  const mine = state === "state.empty" ? [] : all.items.filter((f) => f.memberId === ME);
  const unpaid = mine.filter((f) => f.status === "Unpaid").reduce((sum, f) => sum + Number(f.amount), 0);
  return (
    <Shell>
      <Heading id="heading.fees" text="My fees" />
      {state === "state.failed" && <FailedAlert />}
      <StatGroup>
        <Stat id="stat.unpaid" label="Unpaid total" value={unpaid.toFixed(2)} hint="pay at the desk" icon="Wallet" tone={unpaid > 0 ? "warning" : "success"} />
      </StatGroup>
      <Section id="section.fees" title="Fees" count={mine.length} subtitle="You cannot borrow while a fee is unpaid.">
        <Table
          id="table.fees"
          columns={["Loan", { label: "Amount", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={mine.map((f) => ({
            id: `fee.${f.id}`,
            cells: [f.loan, f.amount],
            status: { text: f.status, tone: f.status === "Paid" ? "success" : "warning" },
          }))}
          empty={<EmptyState id="empty.fees" title="No fees" text="You owe nothing." />}
        />
      </Section>
    </Shell>
  );
}

function ManageTitles() {
  const state = useDisplayState();
  const all = useCollection<Title>("titles");
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const found = state === "state.empty" ? [] : all.items.filter((t) => term === "" || t.name.toLowerCase().includes(term) || t.author.toLowerCase().includes(term));
  const copyList = useCollection<Copy>("copies");
  return (
    <Shell>
      <Heading id="heading.titles" text="Titles" />
      {state === "state.failed" && <FailedAlert />}
      <Section id="section.titles" title="Catalogue titles" count={found.length} subtitle="Open a title to manage its copies."
        actions={<Button id="btn.add-title" label="Add title" emphasis="primary" to="screen.edit-title" />}>
        <Filters id="filters.titles">
          <Field id="field.search" label="Search titles" value={q} onChange={setQ} />
        </Filters>
        <Table
          id="table.titles"
          columns={["Title", "Author", { label: "Copies", kind: "number" }]}
          rows={found.map((t) => ({
            id: `title.${t.id}`,
            cells: [t.name, t.author, String(copyList.items.filter((c) => c.titleId === t.id).length)],
            to: "screen.title-copies",
            params: { title: t.id },
            actions: [{ id: `title.${t.id}.edit`, label: "Edit", to: "screen.edit-title", params: { title: t.id } }],
          }))}
          empty={<EmptyState id="empty.titles" title="No titles" text="Add the first title." />}
        />
      </Section>
    </Shell>
  );
}

function EditTitle() {
  const { title: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<Title>("titles");
  const existing = id ? all.get(id) : undefined;
  const bad = state === "state.validation-error";
  const save = (v: Record<string, string>) => {
    const patch = { name: v["field.name"] ?? "", author: v["field.author"] ?? "", subject: v["field.subject"] ?? "", isbn: v["field.isbn"] ?? "" };
    if (existing) all.update(existing.id, patch);
    else all.create({ ...patch, availableCopies: 0 });
    navigate.go("screen.manage-titles");
  };
  return (
    <Shell>
      <Breadcrumbs id="crumbs.edit-title" items={[
        { id: "crumb.titles", label: "Titles", to: "screen.manage-titles" },
        { id: "crumb.edit", label: existing ? existing.name : "New title" },
      ]} />
      <Heading id="heading.edit-title" text={existing ? "Edit title" : "Add title"} />
      {state === "state.failed" && <FailedAlert />}
      {bad && <ValidationSummary id="summary.title" issues={["Name is required", "Author is required"]} />}
      <Form
        id="form.title"
        onSubmit={save}
        actions={
          <>
            <Button id="btn.cancel" label="Cancel" to="screen.manage-titles" />
            <Button id="btn.save" label="Save" emphasis="primary" submit />
          </>
        }
      >
        <Field id="field.name" label="Name" required defaultValue={existing?.name ?? ""} error={bad ? "Name is required" : undefined} />
        <Field id="field.author" label="Author" required defaultValue={existing?.author ?? ""} error={bad ? "Author is required" : undefined} />
        <Field id="field.subject" label="Subject" defaultValue={existing?.subject ?? ""} />
        <Field id="field.isbn" label="ISBN" defaultValue={existing?.isbn ?? ""} />
      </Form>
      {existing && (
        <Section id="section.danger" title="Remove title" subtitle="A title with open loans cannot be removed.">
          {state === "state.blocked" && (
            <Alert id="alert.remove-blocked" tone="error" title="Cannot remove" text="This title has copies on loan." />
          )}
          <Button id="btn.remove-title" label="Remove title" emphasis="danger" onPress={() => {
            if (state === "state.blocked") return;
            all.remove(existing.id);
            navigate.go("screen.manage-titles");
          }} />
        </Section>
      )}
    </Shell>
  );
}

function TitleCopies() {
  const { title: id } = useParams();
  const state = useDisplayState();
  const titleList = useCollection<Title>("titles");
  const all = useCollection<Copy>("copies");
  const title = (id ? titleList.get(id) : undefined) ?? titleList.items[0]!;
  const mine = state === "state.empty" ? [] : all.items.filter((c) => c.titleId === title.id);
  return (
    <Shell>
      <Breadcrumbs id="crumbs.copies" items={[
        { id: "crumb.titles", label: "Titles", to: "screen.manage-titles" },
        { id: "crumb.title", label: title.name },
      ]} />
      <Heading id="heading.copies" text={`Copies of ${title.name}`} />
      {state === "state.failed" && <FailedAlert />}
      <Section id="section.copies" title="Copies" count={mine.length} subtitle="Status changes as copies are lent, held and returned."
        actions={<Button id="btn.add-copy" label="Add copy" emphasis="primary" to="screen.edit-copy" params={{ title: title.id }} />}>
        <Table
          id="table.copies"
          columns={["Barcode", { label: "Status", kind: "status" }]}
          rows={mine.map((c) => ({
            id: `copy.${c.id}`,
            cells: [c.barcode],
            status: { text: c.status, tone: copyTone(c.status) },
            to: "screen.edit-copy",
            params: { copy: c.id },
          }))}
          empty={<EmptyState id="empty.copies" title="No copies" text="Add a copy to make this title borrowable." />}
        />
      </Section>
    </Shell>
  );
}

function EditCopy() {
  const { copy: copyId, title: titleParam } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const titleList = useCollection<Title>("titles");
  const all = useCollection<Copy>("copies");
  const existing = copyId ? all.get(copyId) : undefined;
  const title = (existing ? titleList.get(existing.titleId) : titleParam ? titleList.get(titleParam) : undefined) ?? titleList.items[0]!;
  const bad = state === "state.validation-error";
  const back = () => navigate.go("screen.title-copies", { title: title.id });
  return (
    <Shell>
      <Breadcrumbs id="crumbs.edit-copy" items={[
        { id: "crumb.titles", label: "Titles", to: "screen.manage-titles" },
        { id: "crumb.title", label: title.name, to: "screen.title-copies", params: { title: title.id } },
        { id: "crumb.copy", label: existing ? existing.barcode : "New copy" },
      ]} />
      <Heading id="heading.edit-copy" text={existing ? "Edit copy" : "Add copy"} />
      {state === "state.failed" && <FailedAlert />}
      {bad && <ValidationSummary id="summary.copy" issues={["Barcode is required"]} />}
      <Form
        id="form.copy"
        onSubmit={(v) => {
          const barcode = v["field.barcode"] ?? "";
          if (existing) all.update(existing.id, { barcode });
          else all.create({ titleId: title.id, barcode, status: "available" });
          back();
        }}
        actions={
          <>
            <Button id="btn.cancel" label="Cancel" to="screen.title-copies" params={{ title: title.id }} />
            <Button id="btn.save" label="Save" emphasis="primary" submit />
          </>
        }
      >
        <Field id="field.barcode" label="Barcode" required defaultValue={existing?.barcode ?? ""} error={bad ? "Barcode is required" : undefined} />
      </Form>
      {existing && (
        <Section id="section.withdraw" title="Withdraw copy" subtitle="A withdrawn copy can no longer be borrowed.">
          <Button id="btn.withdraw" label="Withdraw copy" emphasis="danger" onPress={() => {
            all.update(existing.id, { status: "withdrawn" });
            back();
          }} />
        </Section>
      )}
    </Shell>
  );
}

function Checkout() {
  const state = useDisplayState();
  const today = useToday();
  const copyList = useCollection<Copy>("copies");
  const titleList = useCollection<Title>("titles");
  const loanList = useCollection<Loan>("loans");
  const [done, setDone] = useState("");
  const bad = state === "state.validation-error";
  return (
    <Shell>
      <Heading id="heading.checkout" text="Check out" />
      {state === "state.failed" && <FailedAlert />}
      {state === "state.blocked" && (
        <Alert id="alert.blocked" tone="error" title="Checkout refused" text="The member has 5 active loans or an unpaid fee, or the copy is not available." />
      )}
      {done !== "" && <Alert id="alert.done" tone="success" title="Checked out" text={done} />}
      {bad && <ValidationSummary id="summary.checkout" issues={["Member id is required", "Copy barcode is required"]} />}
      <Section id="section.checkout" title="Loan a copy" subtitle="The due date is 14 days from today.">
        <Form
          id="form.checkout"
          onSubmit={(v) => {
            if (state === "state.blocked") return;
            const barcode = v["field.barcode"] ?? "";
            const member = v["field.member"] ?? "";
            const copy = copyList.items.find((c) => c.barcode === barcode) ?? copyList.items[0]!;
            const title = titleList.get(copy.titleId);
            loanList.create({ title: title ? title.name : "Unknown", copyBarcode: copy.barcode, memberId: member, checkedOut: today, due: "2026-01-29", returned: "", status: "On loan" });
            copyList.update(copy.id, { status: "on-loan" });
            setDone(`${copy.barcode} is out to ${member}, due 2026-01-29.`);
          }}
          actions={<Button id="btn.checkout" label="Check out" emphasis="primary" submit />}
        >
          <Field id="field.member" label="Member id" required defaultValue="m-1001" error={bad ? "Member id is required" : undefined} />
          <Field id="field.barcode" label="Copy barcode" required defaultValue="HOB-001" error={bad ? "Copy barcode is required" : undefined} />
        </Form>
      </Section>
    </Shell>
  );
}

function Checkin() {
  const state = useDisplayState();
  const today = useToday();
  const loanList = useCollection<Loan>("loans");
  const copyList = useCollection<Copy>("copies");
  const feeList = useCollection<Fee>("fees");
  const [done, setDone] = useState("");
  const [fee, setFee] = useState("0.00");
  const bad = state === "state.validation-error";
  return (
    <Shell>
      <Heading id="heading.checkin" text="Check in" />
      {state === "state.failed" && <FailedAlert />}
      {state === "state.blocked" && (
        <Alert id="alert.blocked" tone="error" title="Check in refused" text="No active loan exists for that copy." />
      )}
      {done !== "" && <Alert id="alert.done" tone="success" title="Checked in" text={done} />}
      {bad && <ValidationSummary id="summary.checkin" issues={["Copy barcode is required"]} />}
      <StatGroup>
        <Stat id="stat.late-fee" label="Late fee" value={fee} hint="0.25 per day overdue" icon="Receipt" tone={fee === "0.00" ? "default" : "warning"} />
      </StatGroup>
      <Section id="section.checkin" title="Return a copy" subtitle="A late return creates a fee; a waiting hold is offered the copy.">
        <Form
          id="form.checkin"
          onSubmit={(v) => {
            if (state === "state.blocked") return;
            const barcode = v["field.barcode"] ?? "";
            const loan = loanList.items.find((l) => l.copyBarcode === barcode && l.returned === "") ?? loanList.items.find((l) => l.returned === "")!;
            const days = Math.floor((new Date(today).getTime() - new Date(loan.due).getTime()) / 86400000);
            const amount = days > 0 ? (days * 0.25).toFixed(2) : "0.00";
            loanList.update(loan.id, { returned: today, status: "Returned" });
            const copy = copyList.items.find((c) => c.barcode === loan.copyBarcode);
            if (copy) copyList.update(copy.id, { status: "available" });
            if (days > 0) feeList.create({ loan: loan.title, memberId: loan.memberId, amount, status: "Unpaid" });
            setFee(amount);
            setDone(`${loan.title} returned${days > 0 ? `, ${days} days late` : " on time"}.`);
          }}
          actions={<Button id="btn.checkin" label="Check in" emphasis="primary" submit />}
        >
          <Field id="field.barcode" label="Copy barcode" required defaultValue="EMM-002" error={bad ? "Copy barcode is required" : undefined} />
        </Form>
      </Section>
    </Shell>
  );
}

function HoldsQueue() {
  const state = useDisplayState();
  const all = useCollection<Hold>("holds");
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const rows = state === "state.empty" ? [] : all.items.filter((h) => term === "" || h.title.toLowerCase().includes(term));
  return (
    <Shell>
      <Heading id="heading.holds-queue" text="Holds queue" />
      {state === "state.failed" && <FailedAlert />}
      <Section id="section.queue" title="Holds" count={rows.length} subtitle="In queue order; the first member waiting gets the returned copy.">
        <Filters id="filters.queue">
          <Field id="field.filter" label="Filter by title" value={q} onChange={setQ} />
        </Filters>
        <Table
          id="table.queue"
          columns={["Title", "Member", "Placed", { label: "Status", kind: "status" }]}
          rows={rows.map((h) => ({
            id: `hold.${h.id}`,
            cells: [h.title, h.memberId, h.placed],
            status: { text: h.status, tone: h.status === "Ready" ? "success" : "warning" },
            actions: [{ id: `hold.${h.id}.cancel`, label: "Cancel hold", emphasis: "danger", onPress: () => all.remove(h.id) }],
          }))}
          empty={<EmptyState id="empty.queue" title="No holds" text="No member is waiting for a title." />}
        />
      </Section>
    </Shell>
  );
}

function FeesDesk() {
  const state = useDisplayState();
  const all = useCollection<Fee>("fees");
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const rows = state === "state.empty" ? [] : all.items.filter((f) => term === "" || f.memberId.toLowerCase().includes(term));
  return (
    <Shell>
      <Heading id="heading.fees-desk" text="Fees" />
      {state === "state.failed" && <FailedAlert />}
      <Section id="section.fees" title="Member fees" count={rows.length} subtitle="Members settle fees at the desk; mark them paid here.">
        <Filters id="filters.fees">
          <Field id="field.filter" label="Filter by member" value={q} onChange={setQ} />
        </Filters>
        <Table
          id="table.fees"
          columns={["Member", "Loan", { label: "Amount", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={rows.map((f) => ({
            id: `fee.${f.id}`,
            cells: [f.memberId, f.loan, f.amount],
            status: { text: f.status, tone: f.status === "Paid" ? "success" : "warning" },
            actions: f.status === "Unpaid" ? [{ id: `fee.${f.id}.pay`, label: "Mark paid", onPress: () => all.update(f.id, { status: "Paid" }) }] : [],
          }))}
          empty={<EmptyState id="empty.fees" title="No fees" text="No member owes anything." />}
        />
      </Section>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const name = role === "Librarian" ? "Lena Fonseka" : "Mia Perera";
  const email = role === "Librarian" ? "lena@library.example" : "mia@library.example";
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail id="detail.account" fields={[{ label: "Name", value: name }, { label: "Email", value: email }, { label: "Role", value: role }]} />
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
        onSubmit={() => navigate.go(role === "Librarian" ? "screen.manage-titles" : "screen.catalogue")}
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
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to={role === "Librarian" ? "screen.manage-titles" : "screen.catalogue"} />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.catalogue": Catalogue,
    "screen.title-detail": TitleDetail,
    "screen.my-loans": MyLoans,
    "screen.my-holds": MyHolds,
    "screen.my-fees": MyFees,
    "screen.manage-titles": ManageTitles,
    "screen.edit-title": EditTitle,
    "screen.title-copies": TitleCopies,
    "screen.edit-copy": EditCopy,
    "screen.checkout": Checkout,
    "screen.checkin": Checkin,
    "screen.holds-queue": HoldsQueue,
    "screen.fees-desk": FeesDesk,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { titles, copies, loans, holds, fees },
});
