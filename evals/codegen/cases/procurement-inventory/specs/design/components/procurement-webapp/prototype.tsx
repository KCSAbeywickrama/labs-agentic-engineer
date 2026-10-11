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
  useNav, useParams, useRole, type Tone,
} from "@wso2/prototype-kit";

interface Item { id: string; sku: string; name: string; unit: string; unitPrice: number; reorderLevel: number; onHand: number }
interface Line { itemId: string; item: string; ordered: number; received: number; unitPrice: number }
interface Req { id: string; requester: string; status: string; total: number; raised: string; decision: string; lines: Line[] }
interface Entry { id: string; itemId: string; when: string; change: number; balance: number; reason: string; reference: string }

const items: Item[] = [
  { id: "item.pen-01", sku: "PEN-01", name: "Ballpoint pens", unit: "box", unitPrice: 4.5, reorderLevel: 10, onHand: 3 },
  { id: "item.pap-a4", sku: "PAP-A4", name: "A4 paper", unit: "ream", unitPrice: 6.2, reorderLevel: 15, onHand: 20 },
  { id: "item.stp-05", sku: "STP-05", name: "Stapler", unit: "each", unitPrice: 12.9, reorderLevel: 5, onHand: 8 },
  { id: "item.ton-22", sku: "TON-22", name: "Toner cartridge", unit: "each", unitPrice: 89, reorderLevel: 4, onHand: 2 },
];

const requests: Req[] = [
  { id: "PR-1001", requester: "Rita Fernando", status: "pending", total: 62, raised: "2026-01-15", decision: "",
    lines: [{ itemId: "item.pap-a4", item: "A4 paper", ordered: 10, received: 0, unitPrice: 6.2 }] },
  { id: "PR-1002", requester: "Ravi Perera", status: "pending", total: 6200, raised: "2026-01-15", decision: "",
    lines: [{ itemId: "item.pap-a4", item: "A4 paper", ordered: 1000, received: 0, unitPrice: 6.2 }] },
  { id: "PR-0998", requester: "Rita Fernando", status: "partially-received", total: 310, raised: "2026-01-14", decision: "Approved by Alan Perera",
    lines: [{ itemId: "item.pap-a4", item: "A4 paper", ordered: 50, received: 20, unitPrice: 6.2 }] },
  { id: "PR-1003", requester: "Ana Silva", status: "approved", total: 115.8, raised: "2026-01-13", decision: "Approved by Alan Perera",
    lines: [
      { itemId: "item.pen-01", item: "Ballpoint pens", ordered: 20, received: 0, unitPrice: 4.5 },
      { itemId: "item.stp-05", item: "Stapler", ordered: 2, received: 0, unitPrice: 12.9 },
    ] },
  { id: "PR-0990", requester: "Rita Fernando", status: "rejected", total: 89, raised: "2026-01-08", decision: "Rejected by Alan Perera: Not budgeted",
    lines: [{ itemId: "item.ton-22", item: "Toner cartridge", ordered: 1, received: 0, unitPrice: 89 }] },
];

const ledger: Entry[] = [
  { id: "ledger.1", itemId: "item.pap-a4", when: "2026-01-14", change: 20, balance: 20, reason: "goods-receipt", reference: "RC-77" },
  { id: "ledger.2", itemId: "item.pen-01", when: "2026-01-09", change: 3, balance: 3, reason: "goods-receipt", reference: "RC-70" },
  { id: "ledger.3", itemId: "item.ton-22", when: "2026-01-09", change: 2, balance: 2, reason: "goods-receipt", reference: "RC-71" },
  { id: "ledger.4", itemId: "item.stp-05", when: "2026-01-09", change: 8, balance: 8, reason: "goods-receipt", reference: "RC-72" },
];

const LIMIT = 5000;
const ME = "Rita Fernando";
const money = (n: number) => n.toFixed(2);
const tones: Record<string, Tone> = {
  pending: "warning", approved: "success", rejected: "error", "partially-received": "info", received: "success",
};

const users: Record<string, { name: string; email: string }> = {
  Requester: { name: "Rita Fernando", email: "rita@acme.example" },
  Approver: { name: "Alan Perera", email: "alan@acme.example" },
  "Warehouse Clerk": { name: "Wanda Silva", email: "wanda@acme.example" },
};

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  return (
    <AppShell
      id="shell"
      user={users[role] ?? users["Requester"]!}
      nav={[
        { id: "nav.home", label: "Home", to: "screen.home" },
        { id: "nav.catalogue", label: "Catalogue", to: "screen.catalogue" },
        { id: "nav.my-requests", label: "My requests", to: "screen.my-requests" },
        { id: "nav.approvals", label: "Approvals", to: "screen.approval-queue" },
        { id: "nav.receiving", label: "Receiving", to: "screen.receiving-queue" },
        { id: "nav.stock", label: "Stock levels", to: "screen.stock-levels" },
        { id: "nav.low-stock", label: "Low stock", to: "screen.low-stock" },
        { id: "nav.manage", label: "Manage catalogue", to: "screen.manage-catalogue" },
      ]}
      account="screen.account"
      settings="screen.settings"
      signOut="screen.signed-out"
    >
      {children}
    </AppShell>
  );
}

function Failed({ id, title }: { id: string; title: string }) {
  const state = useDisplayState();
  if (state !== "state.failed") return null;
  return <Alert id={id} tone="error" title={title} text="The service did not answer. Data shown may be out of date; try again in a few minutes." />;
}

function Home() {
  const role = useRole();
  const reqs = useCollection<Req>("requests");
  const its = useCollection<Item>("items");
  const mine = reqs.items.filter((r) => r.requester === ME && (r.status === "pending" || r.status === "approved"));
  const toDecide = reqs.items.filter((r) => r.status === "pending" && r.requester !== "Alan Perera");
  const toReceive = reqs.items.filter((r) => r.status === "approved" || r.status === "partially-received");
  const low = its.items.filter((i) => i.onHand < i.reorderLevel);
  return (
    <Shell>
      <Heading id="heading.home" text="Home" />
      <StatGroup>
        {role === "Requester" && <Stat id="stat.mine" label="My open requests" value={String(mine.length)} hint="pending or awaiting goods" icon="ClipboardList" />}
        {role === "Requester" && <Stat id="stat.catalogue" label="Catalogue items" value={String(its.items.length)} hint="available to request" icon="Package" />}
        {role === "Approver" && <Stat id="stat.to-decide" label="Awaiting your decision" value={String(toDecide.length)} hint="pending requests" icon="Inbox" tone="warning" />}
        {role === "Approver" && <Stat id="stat.limit" label="Approval limit" value={money(LIMIT)} hint="same for all approvers" icon="Gauge" />}
        {role === "Warehouse Clerk" && <Stat id="stat.to-receive" label="Orders to receive" value={String(toReceive.length)} hint="approved or partly received" icon="Truck" />}
        {role === "Warehouse Clerk" && <Stat id="stat.low" label="Low-stock items" value={String(low.length)} hint="below reorder level" icon="TriangleAlert" tone="warning" />}
      </StatGroup>
      <Section id="section.start" title="Get started" subtitle="Your main task as this role.">
        {role === "Requester" && <Button id="btn.go-catalogue" label="Browse the catalogue" emphasis="primary" to="screen.catalogue" />}
        {role === "Approver" && <Button id="btn.go-approvals" label="Review pending requests" emphasis="primary" to="screen.approval-queue" />}
        {role === "Warehouse Clerk" && <Button id="btn.go-receiving" label="Receive goods" emphasis="primary" to="screen.receiving-queue" />}
      </Section>
    </Shell>
  );
}

function Catalogue() {
  const state = useDisplayState();
  const all = useCollection<Item>("items");
  const [q, setQ] = useState("");
  const shown = state === "state.empty" ? [] : all.items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Shell>
      <Heading id="heading.catalogue" text="Catalogue" />
      <Failed id="alert.catalogue-failed" title="Catalogue unavailable" />
      <Section
        id="section.items"
        title="Items"
        count={shown.length}
        subtitle="Open an item to start a request for it."
        actions={<Button id="btn.new-request" label="New request" emphasis="primary" to="screen.new-request" />}
      >
        <Filters id="filters.items">
          <Field id="field.search" label="Search items" type="text" value={q} onChange={setQ} placeholder="Name" />
        </Filters>
        <Table
          id="table.items"
          columns={["SKU", "Item", "Unit", { label: "Unit price", kind: "number" }]}
          rows={shown.map((i) => ({
            id: `item.${i.sku}`,
            cells: [i.sku, i.name, i.unit, money(i.unitPrice)],
            to: "screen.new-request",
            params: { item: i.id },
          }))}
          empty={<EmptyState id="empty.items" title="No items" text="No catalogue items match." />}
        />
      </Section>
    </Shell>
  );
}

function NewRequest() {
  const state = useDisplayState();
  const navigate = useNav();
  const { item: preset } = useParams();
  const all = useCollection<Item>("items");
  const reqs = useCollection<Req>("requests");
  const first = (preset ? all.get(preset) : undefined) ?? all.items[0]!;
  const [itemName, setItemName] = useState(first.name);
  const [qty, setQty] = useState("1");
  const [lines, setLines] = useState<{ itemId: string; item: string; qty: number; unitPrice: number }[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const shownError = error ?? (state === "state.validation-error" ? "Add at least one line to the request" : undefined);
  const add = () => {
    const it = all.items.find((i) => i.name === itemName);
    const n = parseInt(qty, 10);
    if (!it || !(n > 0)) { setError("Quantity must be at least 1"); return; }
    setError(undefined);
    setLines([...lines, { itemId: it.id, item: it.name, qty: n, unitPrice: it.unitPrice }]);
  };
  const submit = () => {
    if (lines.length === 0) { setError("Add at least one line to the request"); return; }
    reqs.create({
      requester: ME, status: "pending", total, raised: "2026-01-15", decision: "",
      lines: lines.map((l) => ({ itemId: l.itemId, item: l.item, ordered: l.qty, received: 0, unitPrice: l.unitPrice })),
    });
    navigate.go("screen.my-requests");
  };
  return (
    <Shell>
      <Breadcrumbs id="crumbs.new-request" items={[
        { id: "crumb.catalogue", label: "Catalogue", to: "screen.catalogue" },
        { id: "crumb.new", label: "New request" },
      ]} />
      <Heading id="heading.new-request" text="New purchase request" />
      {shownError && <ValidationSummary id="summary.request" issues={[shownError]} />}
      <Form
        id="form.request"
        onSubmit={submit}
        actions={
          <Stack2>
            <Button id="btn.cancel-request" label="Cancel" to="screen.catalogue" />
            <Button id="btn.submit-request" label="Submit request" emphasis="primary" submit />
          </Stack2>
        }
      >
        <Field id="field.item" label="Item" type="select" options={all.items.map((i) => i.name)} value={itemName} onChange={setItemName} />
        <Field id="field.quantity" label="Quantity" type="number" value={qty} onChange={setQty} />
        <Button id="btn.add-line" label="Add line" onPress={add} />
      </Form>
      <Section id="section.lines" title="Lines" count={lines.length} subtitle="Total value is the sum of quantity times unit price.">
        <Table
          id="table.lines"
          columns={["Item", { label: "Quantity", kind: "number" }, { label: "Unit price", kind: "number" }, { label: "Line value", kind: "number" }]}
          rows={lines.map((l, idx) => ({
            id: `line.${idx}`,
            cells: [l.item, String(l.qty), money(l.unitPrice), money(l.qty * l.unitPrice)],
            actions: [{ id: `line.${idx}.remove`, label: "Remove", emphasis: "danger" as const, onPress: () => setLines(lines.filter((_, k) => k !== idx)) }],
          }))}
          empty={<EmptyState id="empty.lines" title="No lines yet" text="Choose an item and quantity, then add the line." />}
        />
        <Detail id="detail.total" fields={[{ label: "Total value", value: money(total) }]} />
      </Section>
    </Shell>
  );
}

function Stack2({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function MyRequests() {
  const state = useDisplayState();
  const all = useCollection<Req>("requests");
  const [status, setStatus] = useState("all");
  const mine = state === "state.empty" ? [] : all.items.filter((r) => r.requester === ME && (status === "all" || r.status === status));
  return (
    <Shell>
      <Heading id="heading.my-requests" text="My requests" />
      <Failed id="alert.requests-failed" title="Requests unavailable" />
      <Section
        id="section.my-requests"
        title="Requests"
        count={mine.length}
        subtitle="Only requests you raised."
        actions={<Button id="btn.new-request" label="New request" emphasis="primary" to="screen.new-request" />}
      >
        <Filters id="filters.requests">
          <Field id="field.status" label="Status" type="select" options={["all", "pending", "approved", "rejected", "partially-received", "received"]} value={status} onChange={setStatus} />
        </Filters>
        <Table
          id="table.my-requests"
          columns={["Request", { label: "Total", kind: "number" }, "Raised", { label: "Status", kind: "status" }]}
          rows={mine.map((r) => ({
            id: `request.${r.id}`,
            cells: [r.id, money(r.total), r.raised],
            status: { text: r.status, tone: tones[r.status] ?? "default" },
            to: "screen.my-request-detail",
            params: { request: r.id },
          }))}
          empty={<EmptyState id="empty.my-requests" title="No requests" text="Requests you raise appear here." />}
        />
      </Section>
    </Shell>
  );
}

function MyRequestDetail() {
  const { request: id } = useParams();
  const all = useCollection<Req>("requests");
  const r = (id ? all.get(id) : undefined) ?? all.items.find((x) => x.requester === ME)!;
  return (
    <Shell>
      <Breadcrumbs id="crumbs.my-request" items={[
        { id: "crumb.my-requests", label: "My requests", to: "screen.my-requests" },
        { id: "crumb.request", label: r.id },
      ]} />
      <Heading id="heading.my-request" text={`Request ${r.id}`} actions={<Badge id="badge.status" label={r.status} tone={tones[r.status] ?? "default"} />} />
      <Detail id="detail.my-request" fields={[
        { label: "Raised", value: r.raised },
        { label: "Total value", value: money(r.total) },
        { label: "Decision", value: r.decision || "Awaiting a decision" },
      ]} />
      <Section id="section.my-lines" title="Items" count={r.lines.length}>
        <Table
          id="table.my-lines"
          columns={["Item", { label: "Ordered", kind: "number" }, { label: "Received", kind: "number" }]}
          rows={r.lines.map((l, i) => ({ id: `line.${i}`, cells: [l.item, String(l.ordered), String(l.received)] }))}
        />
      </Section>
    </Shell>
  );
}

function ApprovalQueue() {
  const state = useDisplayState();
  const all = useCollection<Req>("requests");
  const pending = state === "state.empty" ? [] : all.items.filter((r) => r.status === "pending" && r.requester !== "Alan Perera");
  return (
    <Shell>
      <Heading id="heading.queue" text="Pending requests" />
      <Failed id="alert.queue-failed" title="Requests unavailable" />
      <StatGroup>
        <Stat id="stat.limit" label="Approval limit" value={money(LIMIT)} hint="same for all approvers" icon="Gauge" />
        <Stat id="stat.pending" label="Awaiting you" value={String(pending.length)} hint="requests to decide" icon="Inbox" tone="warning" />
      </StatGroup>
      <Section id="section.pending" title="Requests" count={pending.length} subtitle="Open a request to approve or reject it.">
        <Table
          id="table.pending"
          columns={["Request", "Requester", { label: "Total", kind: "number" }, "Raised", { label: "Status", kind: "status" }]}
          rows={pending.map((r) => ({
            id: `request.${r.id}`,
            cells: [r.id, r.requester, money(r.total), r.raised],
            status: r.total > LIMIT ? { text: "Over limit", tone: "warning" as Tone } : { text: "Pending", tone: "default" as Tone },
            to: "screen.review-request",
            params: { request: r.id },
          }))}
          empty={<EmptyState id="empty.queue" title="Nothing to review" text="New requests appear here." />}
        />
      </Section>
    </Shell>
  );
}

function ReviewRequest() {
  const { request: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<Req>("requests");
  const [refused, setRefused] = useState(false);
  const r = (id ? all.get(id) : undefined) ?? all.items.find((x) => x.status === "pending")!;
  const over = r.total > LIMIT;
  const approve = () => {
    if (over) { setRefused(true); return; }
    all.update(r.id, { status: "approved", decision: "Approved by Alan Perera" });
    navigate.go("screen.approval-queue");
  };
  const reject = (values: Record<string, string>) => {
    all.update(r.id, { status: "rejected", decision: `Rejected by Alan Perera: ${values["field.reason"] || "no reason given"}` });
    navigate.go("screen.approval-queue");
  };
  return (
    <Shell>
      <Breadcrumbs id="crumbs.review" items={[
        { id: "crumb.queue", label: "Pending requests", to: "screen.approval-queue" },
        { id: "crumb.review", label: r.id },
      ]} />
      <Heading id="heading.review" text={`Review ${r.id}`} />
      {(refused || state === "state.validation-error") && (
        <Alert id="alert.refused" tone="error" title="Cannot approve" text={`The total is above the approval limit of ${money(LIMIT)}, or you raised this request. Reject it or ask for a smaller order.`} />
      )}
      {over && <Alert id="alert.over-limit" tone="warning" title="Exceeds approval limit" text={`Total ${money(r.total)} is above the limit of ${money(LIMIT)}.`} />}
      <Detail id="detail.review" fields={[
        { label: "Requester", value: r.requester },
        { label: "Raised", value: r.raised },
        { label: "Total value", value: money(r.total) },
      ]} />
      <Section id="section.review-lines" title="Items" count={r.lines.length}>
        <Table
          id="table.review-lines"
          columns={["Item", { label: "Quantity", kind: "number" }, { label: "Unit price", kind: "number" }, { label: "Line value", kind: "number" }]}
          rows={r.lines.map((l, i) => ({ id: `line.${i}`, cells: [l.item, String(l.ordered), money(l.unitPrice), money(l.ordered * l.unitPrice)] }))}
        />
      </Section>
      <Form
        id="form.decision"
        onSubmit={reject}
        actions={
          <Stack2>
            <Button id="btn.reject" label="Reject" emphasis="danger" submit />
            <Button id="btn.approve" label="Approve" emphasis="primary" onPress={approve} />
          </Stack2>
        }
      >
        <Field id="field.reason" label="Reason (for rejection)" type="textarea" />
      </Form>
    </Shell>
  );
}

function ReceivingQueue() {
  const state = useDisplayState();
  const all = useCollection<Req>("requests");
  const open = state === "state.empty" ? [] : all.items.filter((r) => r.status === "approved" || r.status === "partially-received");
  return (
    <Shell>
      <Heading id="heading.receiving" text="Approved orders" />
      <Failed id="alert.receiving-failed" title="Orders unavailable" />
      <Section id="section.orders" title="Orders" count={open.length} subtitle="Orders stay open until fully received.">
        <Table
          id="table.orders"
          columns={["Order", { label: "Total", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={open.map((r) => ({
            id: `order.${r.id}`,
            cells: [r.id, money(r.total)],
            status: { text: r.status, tone: tones[r.status] ?? "default" },
            to: "screen.receive-goods",
            params: { request: r.id },
          }))}
          empty={<EmptyState id="empty.orders" title="No orders to receive" text="Approved orders appear here." />}
        />
      </Section>
    </Shell>
  );
}

function ReceiveGoods() {
  const { request: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<Req>("requests");
  const its = useCollection<Item>("items");
  const led = useCollection<Entry>("ledger");
  const [error, setError] = useState<string | undefined>(undefined);
  const r = (id ? all.get(id) : undefined) ?? all.items.find((x) => x.status === "approved" || x.status === "partially-received")!;
  const shownError = error ?? (state === "state.validation-error" ? "A quantity is more than what is still outstanding" : undefined);
  const submit = (values: Record<string, string>) => {
    const qtys = r.lines.map((_, i) => parseInt(values[`qty-${i}`] ?? "0", 10) || 0);
    const bad = r.lines.some((l, i) => qtys[i]! < 0 || qtys[i]! > l.ordered - l.received);
    if (bad || qtys.every((q) => q === 0)) { setError("Enter a quantity, and no more than is outstanding"); return; }
    const lines = r.lines.map((l, i) => ({ ...l, received: l.received + qtys[i]! }));
    all.update(r.id, { lines, status: lines.every((l) => l.received >= l.ordered) ? "received" : "partially-received" });
    r.lines.forEach((l, i) => {
      const q = qtys[i]!;
      const it = its.get(l.itemId);
      if (q > 0 && it) {
        its.update(it.id, { onHand: it.onHand + q });
        led.create({ itemId: it.id, when: "2026-01-15", change: q, balance: it.onHand + q, reason: "goods-receipt", reference: `RC-${r.id}` });
      }
    });
    navigate.go("screen.receiving-queue");
  };
  return (
    <Shell>
      <Breadcrumbs id="crumbs.receive" items={[
        { id: "crumb.orders", label: "Approved orders", to: "screen.receiving-queue" },
        { id: "crumb.order", label: r.id },
      ]} />
      <Heading id="heading.receive" text={`Receive goods for ${r.id}`} />
      {shownError && <ValidationSummary id="summary.receive" issues={[shownError]} />}
      <Failed id="alert.receive-failed" title="Receipt could not be recorded" />
      <Section id="section.receive-lines" title="Lines" count={r.lines.length}>
        <Table
          id="table.receive-lines"
          columns={["Item", { label: "Ordered", kind: "number" }, { label: "Received so far", kind: "number" }, { label: "Outstanding", kind: "number" }]}
          rows={r.lines.map((l, i) => ({ id: `line.${i}`, cells: [l.item, String(l.ordered), String(l.received), String(l.ordered - l.received)] }))}
        />
      </Section>
      <Form
        id="form.receive"
        title="Quantity received now"
        onSubmit={submit}
        actions={
          <Stack2>
            <Button id="btn.cancel-receipt" label="Cancel" to="screen.receiving-queue" />
            <Button id="btn.confirm-receipt" label="Confirm receipt" emphasis="primary" submit />
          </Stack2>
        }
      >
        {r.lines.map((l, i) => (
          <Field key={`${r.id}-${i}`} id={`field.qty.${i}`} name={`qty-${i}`} label={l.item} type="number" defaultValue="0" error={state === "state.validation-error" ? "Cannot exceed the outstanding quantity" : undefined} />
        ))}
      </Form>
    </Shell>
  );
}

function StockLevels() {
  const state = useDisplayState();
  const all = useCollection<Item>("items");
  const [q, setQ] = useState("");
  const shown = state === "state.empty" ? [] : all.items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Shell>
      <Heading id="heading.stock" text="Stock levels" />
      <Failed id="alert.stock-failed" title="Stock levels unavailable" />
      <Section id="section.stock" title="Items" count={shown.length} subtitle="Open an item to see its ledger.">
        <Filters id="filters.stock">
          <Field id="field.search" label="Search items" type="text" value={q} onChange={setQ} />
        </Filters>
        <Table
          id="table.stock"
          columns={["Item", { label: "On hand", kind: "number" }, { label: "Reorder level", kind: "number" }, { label: "Level", kind: "status" }]}
          rows={shown.map((i) => ({
            id: `stock.${i.sku}`,
            cells: [i.name, String(i.onHand), String(i.reorderLevel)],
            status: i.onHand < i.reorderLevel ? { text: "Low", tone: "warning" as Tone } : { text: "OK", tone: "success" as Tone },
            to: "screen.item-ledger",
            params: { item: i.id },
          }))}
          empty={<EmptyState id="empty.stock" title="No items" text="No items match." />}
        />
      </Section>
    </Shell>
  );
}

function ItemLedger() {
  const { item: id } = useParams();
  const state = useDisplayState();
  const its = useCollection<Item>("items");
  const led = useCollection<Entry>("ledger");
  const it = (id ? its.get(id) : undefined) ?? its.items[0]!;
  const entries = state === "state.empty" ? [] : led.items.filter((e) => e.itemId === it.id).slice().reverse();
  return (
    <Shell>
      <Breadcrumbs id="crumbs.ledger" items={[
        { id: "crumb.stock", label: "Stock levels", to: "screen.stock-levels" },
        { id: "crumb.item", label: it.name },
      ]} />
      <Heading id="heading.ledger" text={`${it.name} ledger`} />
      <Failed id="alert.ledger-failed" title="Ledger unavailable" />
      <Section id="section.ledger" title="Ledger entries" count={entries.length} subtitle="Newest first. Entries are never edited.">
        <Table
          id="table.ledger"
          columns={["When", { label: "Change", kind: "number" }, { label: "Balance after", kind: "number" }, "Reason", "Receipt"]}
          rows={entries.map((e) => ({
            id: e.id,
            cells: [e.when, e.change > 0 ? `+${e.change}` : String(e.change), String(e.balance), e.reason, e.reference],
          }))}
          empty={<EmptyState id="empty.ledger" title="No entries" text="Stock changes for this item appear here." />}
        />
      </Section>
    </Shell>
  );
}

function LowStock() {
  const state = useDisplayState();
  const all = useCollection<Item>("items");
  const low = state === "state.empty" ? [] : all.items.filter((i) => i.onHand < i.reorderLevel);
  return (
    <Shell>
      <Heading id="heading.low" text="Low stock" />
      <Failed id="alert.low-failed" title="Low-stock view unavailable" />
      <Section id="section.low" title="Items below reorder level" count={low.length}>
        <Table
          id="table.low"
          columns={["Item", { label: "On hand", kind: "number" }, { label: "Reorder level", kind: "number" }]}
          rows={low.map((i) => ({
            id: `low.${i.sku}`,
            cells: [i.name, String(i.onHand), String(i.reorderLevel)],
            to: "screen.item-ledger",
            params: { item: i.id },
          }))}
          empty={<EmptyState id="empty.low" title="Nothing is low" text="Every item is at or above its reorder level." />}
        />
      </Section>
    </Shell>
  );
}

function ManageCatalogue() {
  const state = useDisplayState();
  const all = useCollection<Item>("items");
  const [q, setQ] = useState("");
  const shown = state === "state.empty" ? [] : all.items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Shell>
      <Heading id="heading.manage" text="Manage catalogue" />
      <Failed id="alert.manage-failed" title="Catalogue unavailable" />
      <Section
        id="section.manage"
        title="Items"
        count={shown.length}
        subtitle="Open an item to edit it."
        actions={<Button id="btn.add-item" label="Add item" emphasis="primary" to="screen.item-form" />}
      >
        <Filters id="filters.manage">
          <Field id="field.search" label="Search items" type="text" value={q} onChange={setQ} />
        </Filters>
        <Table
          id="table.manage"
          columns={["SKU", "Item", "Unit", { label: "Unit price", kind: "number" }, { label: "Reorder level", kind: "number" }]}
          rows={shown.map((i) => ({
            id: `item.${i.sku}`,
            cells: [i.sku, i.name, i.unit, money(i.unitPrice), String(i.reorderLevel)],
            to: "screen.item-form",
            params: { item: i.id },
          }))}
          empty={<EmptyState id="empty.manage" title="No items" text="Add the first catalogue item." />}
        />
      </Section>
    </Shell>
  );
}

function ItemForm() {
  const { item: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<Item>("items");
  const it = id ? all.get(id) : undefined;
  const save = (v: Record<string, string>) => {
    const patch = {
      name: v["field.name"] ?? "", unit: v["field.unit"] ?? "",
      unitPrice: parseFloat(v["field.price"] ?? "0") || 0, reorderLevel: parseInt(v["field.reorder"] ?? "0", 10) || 0,
    };
    if (it) all.update(it.id, patch);
    else all.create({ ...patch, sku: `NEW-${String(all.items.length + 1).padStart(3, "0")}`, onHand: 0 });
    navigate.go("screen.manage-catalogue");
  };
  const bad = state === "state.validation-error";
  return (
    <Shell>
      <Breadcrumbs id="crumbs.item" items={[
        { id: "crumb.manage", label: "Manage catalogue", to: "screen.manage-catalogue" },
        { id: "crumb.item", label: it ? it.name : "New item" },
      ]} />
      <Heading id="heading.item" text={it ? "Edit item" : "Add item"} />
      {bad && <ValidationSummary id="summary.item" issues={["Name is required", "Unit price must be a number such as 12.50"]} />}
      <Failed id="alert.item-failed" title="Item could not be saved" />
      {!it && <Text id="text.new-hint" text="A new item starts with 0 in stock. Its SKU is assigned when you save. (assumed)" />}
      <Form
        id="form.item"
        key={it ? it.id : "new"}
        onSubmit={save}
        actions={
          <Stack2>
            <Button id="btn.cancel-item" label="Cancel" to="screen.manage-catalogue" />
            <Button id="btn.save-item" label="Save item" emphasis="primary" submit />
          </Stack2>
        }
      >
        <Field id="field.name" label="Name" required defaultValue={it?.name} error={bad ? "Name is required" : undefined} />
        <Field id="field.unit" label="Unit" required defaultValue={it?.unit} />
        <Field id="field.price" label="Unit price" required pattern="[0-9]+(\.[0-9]{1,2})?" patternMessage="Enter an amount such as 12.50" defaultValue={it ? money(it.unitPrice) : undefined} error={bad ? "Unit price must be a number" : undefined} />
        <Field id="field.reorder" label="Reorder level" type="number" required defaultValue={it ? String(it.reorderLevel) : undefined} />
      </Form>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const u = users[role] ?? users["Requester"]!;
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail id="detail.account" fields={[{ label: "Name", value: u.name }, { label: "Email", value: u.email }, { label: "Role", value: role }]} />
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
        onSubmit={() => navigate.go("screen.home")}
        actions={<Button id="btn.save-settings" label="Save settings" emphasis="primary" submit />}
      >
        <Field id="field.compact" label="Compact tables" type="switch" defaultValue="off" />
      </Form>
    </Shell>
  );
}

function SignedOut() {
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Text id="text.signed-out" text="Sign in again through your organisation's single sign-on." />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to="screen.home" />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.home": Home,
    "screen.catalogue": Catalogue,
    "screen.new-request": NewRequest,
    "screen.my-requests": MyRequests,
    "screen.my-request-detail": MyRequestDetail,
    "screen.approval-queue": ApprovalQueue,
    "screen.review-request": ReviewRequest,
    "screen.receiving-queue": ReceivingQueue,
    "screen.receive-goods": ReceiveGoods,
    "screen.stock-levels": StockLevels,
    "screen.item-ledger": ItemLedger,
    "screen.low-stock": LowStock,
    "screen.manage-catalogue": ManageCatalogue,
    "screen.item-form": ItemForm,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { items, requests, ledger },
});
