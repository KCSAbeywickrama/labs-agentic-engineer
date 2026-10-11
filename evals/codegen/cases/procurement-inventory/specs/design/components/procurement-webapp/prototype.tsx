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
  Screen, Section, Stat, StatGroup, Table, Text, ValidationSummary, defineApp, useCollection,
  useDisplayState, useNav, useParams, useRole,
} from "@wso2/prototype-kit";

interface Item { id: string; sku: string; name: string; unit: string; priceCents: number; stock: number; reorder: number; active: boolean }
interface Line { id: string; itemId: string; itemName: string; qty: number; priceCents: number; received: number }
interface Req { id: string; requester: string; status: string; justification: string; lines: Line[]; decidedBy: string; reason: string; submitted: string }
interface LedgerRow { id: string; itemId: string; itemName: string; change: number; resulting: number; actor: string; receipt: string; at: string }
interface Receipt { id: string; requestId: string; clerk: string; at: string; summary: string }

const RITA = "Rita Fernando";
const ALAN = "Alan Perera";
const WANDA = "Wanda Silva";
const APPROVAL_LIMIT = 500000;

const items: Item[] = [
  { id: "item-1", sku: "PAP-A4", name: "A4 Paper", unit: "ream", priceCents: 450, stock: 5, reorder: 20, active: true },
  { id: "item-2", sku: "STA-01", name: "Stapler", unit: "each", priceCents: 800, stock: 10, reorder: 10, active: true },
  { id: "item-3", sku: "TON-BK", name: "Printer Toner", unit: "box", priceCents: 6200, stock: 2, reorder: 5, active: true },
  { id: "item-4", sku: "MRK-12", name: "Whiteboard Markers", unit: "pack", priceCents: 1250, stock: 40, reorder: 15, active: true },
  { id: "item-5", sku: "BND-OLD", name: "Old Binder", unit: "each", priceCents: 300, stock: 0, reorder: 10, active: false },
];

const requests: Req[] = [
  { id: "req-1", requester: RITA, status: "pending", justification: "Office restock", submitted: "2026-01-12", decidedBy: "", reason: "",
    lines: [{ id: "l-1-1", itemId: "item-1", itemName: "A4 Paper", qty: 10, priceCents: 450, received: 0 }] },
  { id: "req-2", requester: RITA, status: "approved", justification: "Printer ran out", submitted: "2026-01-08", decidedBy: ALAN, reason: "",
    lines: [{ id: "l-2-1", itemId: "item-3", itemName: "Printer Toner", qty: 3, priceCents: 6200, received: 0 }] },
  { id: "req-3", requester: RITA, status: "rejected", justification: "Desk upgrade", submitted: "2026-01-05", decidedBy: ALAN, reason: "Over budget",
    lines: [{ id: "l-3-1", itemId: "item-2", itemName: "Stapler", qty: 40, priceCents: 800, received: 0 }] },
  { id: "req-4", requester: "Remy Silva", status: "pending", justification: "Workshop supplies", submitted: "2026-01-13", decidedBy: "", reason: "",
    lines: [{ id: "l-4-1", itemId: "item-4", itemName: "Whiteboard Markers", qty: 20, priceCents: 1250, received: 0 }] },
  { id: "req-5", requester: RITA, status: "draft", justification: "", submitted: "", decidedBy: "", reason: "",
    lines: [{ id: "l-5-1", itemId: "item-2", itemName: "Stapler", qty: 2, priceCents: 800, received: 0 }] },
  { id: "req-6", requester: "Marcus Lee", status: "pending", justification: "Annual toner stock", submitted: "2026-01-14", decidedBy: "", reason: "",
    lines: [{ id: "l-6-1", itemId: "item-3", itemName: "Printer Toner", qty: 120, priceCents: 6200, received: 0 }] },
  { id: "req-7", requester: "Remy Silva", status: "approved", justification: "Quarterly paper", submitted: "2026-01-06", decidedBy: ALAN, reason: "",
    lines: [{ id: "l-7-1", itemId: "item-1", itemName: "A4 Paper", qty: 10, priceCents: 450, received: 4 }] },
];

const ledger: LedgerRow[] = [
  { id: "led-3", itemId: "item-1", itemName: "A4 Paper", change: 4, resulting: 5, actor: WANDA, receipt: "rec-1", at: "2026-01-14 11:20" },
  { id: "led-2", itemId: "item-4", itemName: "Whiteboard Markers", change: 24, resulting: 40, actor: WANDA, receipt: "rec-0", at: "2026-01-09 09:05" },
  { id: "led-1", itemId: "item-2", itemName: "Stapler", change: 10, resulting: 10, actor: WANDA, receipt: "rec-00", at: "2026-01-03 15:40" },
];

const receipts: Receipt[] = [
  { id: "rec-1", requestId: "req-7", clerk: WANDA, at: "2026-01-14 11:20", summary: "4 x A4 Paper" },
];

const users: Record<string, { name: string; email: string }> = {
  Requester: { name: RITA, email: "rita.fernando@acme.example" },
  Approver: { name: ALAN, email: "alan.perera@acme.example" },
  WarehouseClerk: { name: WANDA, email: "wanda.silva@acme.example" },
};

const nav = [
  { id: "nav.home", label: "Home", to: "screen.home" },
  { id: "nav.catalogue", label: "Catalogue and stock", to: "screen.catalogue" },
  { id: "nav.low-stock", label: "Low stock", to: "screen.low-stock" },
  { id: "nav.requests", label: "My requests", to: "screen.requests" },
  { id: "nav.approvals", label: "Pending approvals", to: "screen.approvals" },
  { id: "nav.decisions", label: "My decisions", to: "screen.decisions" },
  { id: "nav.receiving", label: "Goods to receive", to: "screen.receiving" },
  { id: "nav.ledger", label: "Stock ledger", to: "screen.ledger" },
];

function money(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `$${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${rest}`;
}

function total(r: Req): number {
  return r.lines.reduce((sum, l) => sum + l.qty * l.priceCents, 0);
}

function statusTone(status: string): "default" | "info" | "success" | "warning" | "error" {
  if (status === "pending") return "warning";
  if (status === "approved") return "success";
  if (status === "rejected") return "error";
  if (status === "received") return "info";
  return "default";
}

function outstanding(r: Req): number {
  return r.lines.reduce((sum, l) => sum + (l.qty - l.received), 0);
}

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  return (
    <AppShell
      id="shell"
      user={users[role] ?? users["Requester"]!}
      nav={nav}
      account="screen.account"
      settings="screen.settings"
      signOut="screen.signed-out"
    >
      {children}
    </AppShell>
  );
}

function FailedAlert() {
  const state = useDisplayState();
  if (state !== "state.failed") return null;
  return <Alert id="alert.failed" tone="error" title="Service unavailable" text="The procurement service could not be reached. Data shown may be out of date; try again in a few minutes." />;
}

function Home() {
  const role = useRole();
  const reqs = useCollection<Req>("requests");
  const stock = useCollection<Item>("items");
  const mine = reqs.items.filter((r) => r.requester === RITA);
  const pending = reqs.items.filter((r) => r.status === "pending" && total(r) <= APPROVAL_LIMIT);
  const toReceive = reqs.items.filter((r) => r.status === "approved" && outstanding(r) > 0);
  const low = stock.items.filter((i) => i.active && i.stock < i.reorder);
  return (
    <Shell>
      <Heading id="heading.home" text={`Welcome, ${users[role]?.name ?? ""}`} />
      <FailedAlert />
      {role === "Requester" && (
        <>
          <StatGroup>
            <Stat id="stat.mine-pending" label="Awaiting approval" value={String(mine.filter((r) => r.status === "pending").length)} hint="your requests" icon="Clock" tone="warning" />
            <Stat id="stat.mine-approved" label="Approved" value={String(mine.filter((r) => r.status === "approved").length)} hint="waiting for goods" icon="CircleCheck" tone="success" />
            <Stat id="stat.low" label="Low-stock items" value={String(low.length)} hint="below reorder level" icon="TriangleAlert" tone="warning" />
          </StatGroup>
          <Section id="section.home-actions" title="Get started">
            <Button id="btn.new-request" label="New purchase request" emphasis="primary" to="screen.request-new" />
            <Button id="btn.my-requests" label="My requests" to="screen.requests" />
            <Button id="btn.low-stock" label="See low stock" to="screen.low-stock" />
          </Section>
        </>
      )}
      {role === "Approver" && (
        <>
          <StatGroup>
            <Stat id="stat.awaiting" label="Awaiting you" value={String(pending.length)} hint="within your limit" icon="Inbox" tone="warning" />
            <Stat id="stat.limit" label="Approval limit" value={money(APPROVAL_LIMIT)} hint="per request" icon="Wallet" />
          </StatGroup>
          <Section id="section.home-actions" title="Get started">
            <Button id="btn.pending" label="Review pending requests" emphasis="primary" to="screen.approvals" />
            <Button id="btn.decisions" label="My decisions" to="screen.decisions" />
          </Section>
        </>
      )}
      {role === "WarehouseClerk" && (
        <>
          <StatGroup>
            <Stat id="stat.to-receive" label="Orders to receive" value={String(toReceive.length)} hint="approved, goods outstanding" icon="Truck" tone="info" />
            <Stat id="stat.low" label="Low-stock items" value={String(low.length)} hint="below reorder level" icon="TriangleAlert" tone="warning" />
          </StatGroup>
          <Section id="section.home-actions" title="Get started">
            <Button id="btn.receive" label="Receive goods" emphasis="primary" to="screen.receiving" />
            <Button id="btn.catalogue" label="Catalogue and stock" to="screen.catalogue" />
            <Button id="btn.ledger" label="Stock ledger" to="screen.ledger" />
          </Section>
        </>
      )}
    </Shell>
  );
}

function Catalogue() {
  const role = useRole();
  const state = useDisplayState();
  const all = useCollection<Item>("items");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const clerk = role === "WarehouseClerk";
  const visible = state === "state.empty" ? [] : all.items.filter((i) => (clerk || i.active) && `${i.name} ${i.sku}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <Shell>
      <Heading id="heading.catalogue" text="Catalogue and stock" />
      <FailedAlert />
      <Section
        id="section.items"
        title="Items"
        count={visible.length}
        subtitle={clerk ? "Add, edit, price and deactivate items. Stock changes only through receiving." : "Active items you can request, with current stock."}
        actions={clerk ? <Button id="btn.add-item" label="Add item" emphasis="primary" onPress={() => setAdding(true)} /> : undefined}
      >
        <Filters id="filters.items">
          <Field id="field.search" label="Search by name or SKU" value={query} onChange={setQuery} />
        </Filters>
        <Table
          id="table.items"
          columns={["SKU", "Name", "Unit", { label: "Unit price", kind: "number" }, { label: "Stock", kind: "number" }, { label: "Reorder level", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={visible.map((i) => ({
            id: `item.${i.id}`,
            cells: [i.sku, i.name, i.unit, money(i.priceCents), String(i.stock), String(i.reorder)],
            status: !i.active ? { text: "Inactive", tone: "default" as const } : i.stock < i.reorder ? { text: "Low stock", tone: "warning" as const } : { text: "Active", tone: "success" as const },
            ...(clerk ? { to: "screen.item-detail", params: { item: i.id } } : {}),
            actions: clerk
              ? [{ id: `item.${i.id}.toggle`, label: i.active ? "Deactivate" : "Reactivate", emphasis: i.active ? ("danger" as const) : undefined, onPress: () => all.update(i.id, { active: !i.active }) }]
              : [{ id: `item.${i.id}.request`, label: "Request", to: "screen.request-new", params: { item: i.id } }],
          }))}
          empty={<EmptyState id="empty.items" title="No items found" text="Try a different search." />}
        />
      </Section>
      <Dialog id="dialog.add-item" title="Add item" open={adding} onClose={() => setAdding(false)}>
        <Form
          id="form.add-item"
          onSubmit={(v) => {
            all.create({ sku: v["sku"] ?? "", name: v["name"] ?? "", unit: v["unit"] ?? "each", priceCents: Math.round(Number(v["price"] ?? "0") * 100), stock: 0, reorder: Number(v["reorder"] ?? "0"), active: true });
            setAdding(false);
          }}
          actions={<Button id="btn.add-item.save" label="Add item" emphasis="primary" submit />}
        >
          <Field id="field.sku" name="sku" label="SKU" required error={state === "state.validation-error" ? "This SKU already exists" : undefined} />
          <Field id="field.name" name="name" label="Name" required />
          <Field id="field.unit" name="unit" label="Unit of measure" required />
          <Field id="field.reorder" name="reorder" label="Reorder level" type="number" required />
          <Field id="field.price" name="price" label="Unit price" type="number" required />
        </Form>
      </Dialog>
    </Shell>
  );
}

function ItemDetail() {
  const { item: id } = useParams();
  const state = useDisplayState();
  const all = useCollection<Item>("items");
  const rows = useCollection<LedgerRow>("ledger");
  const item = (id ? all.get(id) : undefined) ?? all.items[0]!;
  const entries = state === "state.empty" ? [] : rows.items.filter((l) => l.itemId === item.id);
  return (
    <Shell>
      <Breadcrumbs id="crumbs.item" items={[{ id: "crumb.catalogue", label: "Catalogue and stock", to: "screen.catalogue" }, { id: "crumb.item", label: item.name }]} />
      <Heading id="heading.item" text={item.name} />
      <FailedAlert />
      <StatGroup>
        <Stat id="stat.stock" label="Current stock" value={String(item.stock)} hint={`reorder level ${item.reorder}`} icon="Package" tone={item.stock < item.reorder ? "warning" : "success"} />
        <Stat id="stat.price" label="Unit price" value={money(item.priceCents)} hint={`per ${item.unit}`} icon="Tag" />
      </StatGroup>
      <Section id="section.edit-item" title="Edit item" subtitle={`SKU ${item.sku} cannot be changed.`}>
        <Form
          id="form.edit-item"
          onSubmit={(v) => all.update(item.id, { name: v["name"] ?? item.name, unit: v["unit"] ?? item.unit, reorder: Number(v["reorder"] ?? item.reorder), priceCents: Math.round(Number(v["price"] ?? "0") * 100) })}
          actions={<Button id="btn.save-item" label="Save changes" emphasis="primary" submit />}
        >
          <Field id="field.item-name" name="name" label="Name" defaultValue={item.name} required />
          <Field id="field.item-unit" name="unit" label="Unit of measure" defaultValue={item.unit} required />
          <Field id="field.item-reorder" name="reorder" label="Reorder level" type="number" defaultValue={String(item.reorder)} required />
          <Field id="field.item-price" name="price" label="Unit price" type="number" defaultValue={String(item.priceCents / 100)} required error={state === "state.validation-error" ? "Price must be zero or more" : undefined} />
        </Form>
        <Button id="btn.toggle-active" label={item.active ? "Deactivate item" : "Reactivate item"} emphasis={item.active ? "danger" : undefined} onPress={() => all.update(item.id, { active: !item.active })} />
      </Section>
      <Section id="section.item-ledger" title="Ledger" count={entries.length} subtitle="Every stock change of this item, newest first. Entries cannot be edited.">
        <Table
          id="table.item-ledger"
          columns={["Time", { label: "Change", kind: "number" }, { label: "Resulting stock", kind: "number" }, "By", "Receipt"]}
          rows={entries.map((l) => ({ id: `ledger.${l.id}`, cells: [l.at, l.change > 0 ? `+${l.change}` : String(l.change), String(l.resulting), l.actor, l.receipt] }))}
          empty={<EmptyState id="empty.item-ledger" title="No ledger entries" text="Entries appear when goods are received." />}
        />
      </Section>
    </Shell>
  );
}

function LowStock() {
  const role = useRole();
  const state = useDisplayState();
  const all = useCollection<Item>("items");
  const [sort, setSort] = useState("Shortfall");
  const low = state === "state.empty" ? [] : all.items.filter((i) => i.active && i.stock < i.reorder);
  const sorted = [...low].sort((a, b) => (sort === "Name" ? a.name.localeCompare(b.name) : (b.reorder - b.stock) - (a.reorder - a.stock)));
  const requester = role === "Requester";
  return (
    <Shell>
      <Heading id="heading.low-stock" text="Low stock" />
      <FailedAlert />
      <Section id="section.low-stock" title="Items below reorder level" count={sorted.length} subtitle="Active items whose stock is strictly below their reorder level.">
        <Filters id="filters.low-stock">
          <Field id="field.sort" label="Sort by" type="select" options={["Shortfall", "Name"]} value={sort} onChange={setSort} />
        </Filters>
        <Table
          id="table.low-stock"
          columns={["SKU", "Name", { label: "Stock", kind: "number" }, { label: "Reorder level", kind: "number" }, { label: "Shortfall", kind: "number" }]}
          rows={sorted.map((i) => ({
            id: `low.${i.id}`,
            cells: [i.sku, i.name, String(i.stock), String(i.reorder), String(i.reorder - i.stock)],
            actions: requester ? [{ id: `low.${i.id}.request`, label: "Request this item", to: "screen.request-new", params: { item: i.id } }] : [],
          }))}
          empty={<EmptyState id="empty.low-stock" title="Nothing is running low" text="Every active item is at or above its reorder level." />}
        />
      </Section>
    </Shell>
  );
}

function Requests() {
  const state = useDisplayState();
  const all = useCollection<Req>("requests");
  const mine = state === "state.empty" ? [] : all.items.filter((r) => r.requester === RITA).slice().reverse();
  return (
    <Shell>
      <Heading id="heading.requests" text="My requests" />
      <FailedAlert />
      <Section
        id="section.requests"
        title="Requests"
        count={mine.length}
        subtitle="Newest first. You see only your own requests."
        actions={<Button id="btn.new-request" label="New request" emphasis="primary" to="screen.request-new" />}
      >
        <Table
          id="table.requests"
          columns={["Request", "Items", { label: "Total", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={mine.map((r) => ({
            id: `request.${r.id}`,
            cells: [r.id, r.lines.map((l) => `${l.qty} x ${l.itemName}`).join(", "), money(total(r))],
            status: { text: r.status, tone: statusTone(r.status) },
            to: "screen.request-detail",
            params: { request: r.id },
          }))}
          empty={<EmptyState id="empty.requests" title="No requests yet" text="Raise your first purchase request." actions={<Button id="btn.empty-new" label="New request" emphasis="primary" to="screen.request-new" />} />}
        />
      </Section>
    </Shell>
  );
}

function RequestNew() {
  const { item: presetId } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const stock = useCollection<Item>("items");
  const reqs = useCollection<Req>("requests");
  const preset = presetId ? stock.get(presetId) : undefined;
  const active = stock.items.filter((i) => i.active);
  const [chosen, setChosen] = useState(preset?.name ?? active[0]?.name ?? "");
  const [qty, setQty] = useState("1");
  const [picked, setPicked] = useState<{ itemId: string; itemName: string; qty: number; priceCents: number }[]>(
    preset ? [{ itemId: preset.id, itemName: preset.name, qty: 1, priceCents: preset.priceCents }] : [],
  );
  const sum = picked.reduce((s, l) => s + l.qty * l.priceCents, 0);
  const addLine = () => {
    const it = active.find((i) => i.name === chosen);
    if (!it || Number(qty) < 1) return;
    setPicked([...picked, { itemId: it.id, itemName: it.name, qty: Number(qty), priceCents: it.priceCents }]);
  };
  const save = (v: Record<string, string>, submit: boolean) => {
    if (picked.length === 0) return;
    const id = reqs.create({
      requester: RITA, status: submit ? "pending" : "draft", justification: v["justification"] ?? "", submitted: submit ? "2026-01-15" : "", decidedBy: "", reason: "",
      lines: picked.map((p, n) => ({ id: `l-new-${n}`, itemId: p.itemId, itemName: p.itemName, qty: p.qty, priceCents: p.priceCents, received: 0 })),
    });
    navigate.go("screen.request-detail", { request: id });
  };
  return (
    <Shell>
      <Breadcrumbs id="crumbs.new" items={[{ id: "crumb.requests", label: "My requests", to: "screen.requests" }, { id: "crumb.new", label: "New request" }]} />
      <Heading id="heading.new-request" text="New purchase request" />
      <FailedAlert />
      <Section id="section.lines" title="Items" count={picked.length} subtitle="Pick active catalogue items and quantities.">
        <Field id="field.item" label="Item" type="select" options={active.map((i) => i.name)} value={chosen} onChange={setChosen} />
        <Field id="field.qty" label="Quantity" type="number" value={qty} onChange={setQty} />
        <Button id="btn.add-line" label="Add line" onPress={addLine} />
        <Table
          id="table.lines"
          columns={["Item", { label: "Quantity", kind: "number" }, { label: "Line total", kind: "number" }]}
          rows={picked.map((p, n) => ({
            id: `line.${n}`,
            cells: [p.itemName, String(p.qty), money(p.qty * p.priceCents)],
            actions: [{ id: `line.${n}.remove`, label: "Remove", emphasis: "danger" as const, onPress: () => setPicked(picked.filter((_, k) => k !== n)) }],
          }))}
          empty={<EmptyState id="empty.lines" title="No items yet" text="Add at least one line." />}
        />
        <Text id="text.total" text={`Total: ${money(sum)}`} tone="primary" />
      </Section>
      {state === "state.validation-error" && <ValidationSummary id="summary.new-request" issues={["Add at least one item", "Quantity must be 1 or more"]} />}
      <Form
        id="form.new-request"
        onSubmit={(v) => save(v, true)}
        actions={
          <>
            <Button id="btn.save-draft" label="Save as draft" onPress={() => save({}, false)} />
            <Button id="btn.submit-request" label="Submit for approval" emphasis="primary" submit />
          </>
        }
      >
        <Field id="field.justification" name="justification" label="Justification" type="textarea" placeholder="Why is this needed?" />
      </Form>
    </Shell>
  );
}

function RequestDetail() {
  const { request: id } = useParams();
  const state = useDisplayState();
  const reqs = useCollection<Req>("requests");
  const [editing, setEditing] = useState(false);
  const mine = reqs.items.filter((r) => r.requester === RITA);
  const r = (id ? reqs.get(id) : undefined) ?? mine[0]!;
  const open = r.status === "draft" || r.status === "pending";
  return (
    <Shell>
      <Breadcrumbs id="crumbs.request" items={[{ id: "crumb.requests", label: "My requests", to: "screen.requests" }, { id: "crumb.request", label: r.id }]} />
      <Heading id="heading.request" text={`Request ${r.id}`} />
      <FailedAlert />
      {r.status === "rejected" && <Alert id="alert.rejected" tone="error" title={`Rejected by ${r.decidedBy}`} text={r.reason} />}
      {r.status === "approved" && <Alert id="alert.approved" tone="success" title={`Approved by ${r.decidedBy}`} text="Goods will be received by the warehouse." />}
      <Detail
        id="detail.request"
        fields={[
          { label: "Status", value: r.status },
          { label: "Requester", value: r.requester },
          { label: "Justification", value: r.justification || "None" },
          { label: "Total", value: money(total(r)) },
          { label: "Submitted", value: r.submitted || "Not yet submitted" },
        ]}
      />
      <Section id="section.request-lines" title="Lines" count={r.lines.length}>
        <Table
          id="table.request-lines"
          columns={["Item", { label: "Quantity", kind: "number" }, { label: "Unit price", kind: "number" }, { label: "Received", kind: "number" }]}
          rows={r.lines.map((l) => ({ id: `rline.${l.id}`, cells: [l.itemName, String(l.qty), money(l.priceCents), String(l.received)] }))}
        />
      </Section>
      {open && (
        <Section id="section.request-actions" title="Actions">
          {r.status === "draft" && <Button id="btn.submit" label="Submit for approval" emphasis="primary" onPress={() => reqs.update(r.id, { status: "pending", submitted: "2026-01-15" })} />}
          <Button id="btn.edit" label="Edit request" onPress={() => setEditing(true)} />
          <Button id="btn.withdraw" label="Withdraw" emphasis="danger" onPress={() => reqs.update(r.id, { status: "withdrawn" })} />
        </Section>
      )}
      <Dialog id="dialog.edit-request" title={`Edit request ${r.id}`} open={editing} onClose={() => setEditing(false)}>
        <Form
          id="form.edit-request"
          onSubmit={(v) => {
            reqs.update(r.id, {
              status: "draft",
              justification: v["justification"] ?? r.justification,
              lines: r.lines.map((l) => ({ ...l, qty: Number(v[`qty.${l.id}`] ?? l.qty) })),
            });
            setEditing(false);
          }}
          actions={<Button id="btn.edit.save" label="Save changes" emphasis="primary" submit />}
        >
          <Field id="field.edit-justification" name="justification" label="Justification" type="textarea" defaultValue={r.justification} />
          {r.lines.map((l) => (
            <Field key={l.id} id={`field.qty.${l.id}`} name={`qty.${l.id}`} label={`${l.itemName} quantity`} type="number" defaultValue={String(l.qty)} required error={state === "state.validation-error" ? "Quantity must be 1 or more" : undefined} />
          ))}
        </Form>
        <Text id="text.edit-note" text="Editing a pending request returns it to draft; submit it again for approval." />
      </Dialog>
    </Shell>
  );
}

function Approvals() {
  const state = useDisplayState();
  const reqs = useCollection<Req>("requests");
  const pending = state === "state.empty" ? [] : reqs.items.filter((r) => r.status === "pending" && total(r) <= APPROVAL_LIMIT && r.requester !== ALAN);
  return (
    <Shell>
      <Heading id="heading.approvals" text="Pending approvals" />
      <FailedAlert />
      <StatGroup>
        <Stat id="stat.awaiting" label="Awaiting you" value={String(pending.length)} hint="within your limit" icon="Inbox" tone="warning" />
        <Stat id="stat.limit" label="Your approval limit" value={money(APPROVAL_LIMIT)} hint="per request, set by configuration" icon="Wallet" />
      </StatGroup>
      <Section id="section.pending" title="Requests" count={pending.length} subtitle="Oldest first. Requests above your limit are not shown.">
        <Table
          id="table.pending"
          columns={["Request", "Requester", "Items", { label: "Total", kind: "number" }, "Submitted"]}
          rows={pending.slice().sort((a, b) => a.submitted.localeCompare(b.submitted)).map((r) => ({
            id: `pending.${r.id}`,
            cells: [r.id, r.requester, r.lines.map((l) => `${l.qty} x ${l.itemName}`).join(", "), money(total(r)), r.submitted],
            to: "screen.approval-detail",
            params: { request: r.id },
          }))}
          empty={<EmptyState id="empty.pending" title="Nothing to approve" text="New requests within your limit appear here." />}
        />
      </Section>
    </Shell>
  );
}

function ApprovalDetail() {
  const { request: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const reqs = useCollection<Req>("requests");
  const [rejecting, setRejecting] = useState(false);
  const r = (id ? reqs.get(id) : undefined) ?? reqs.items.find((x) => x.status === "pending")!;
  const decidable = r.status === "pending" && total(r) <= APPROVAL_LIMIT;
  return (
    <Shell>
      <Breadcrumbs id="crumbs.approval" items={[{ id: "crumb.approvals", label: "Pending approvals", to: "screen.approvals" }, { id: "crumb.approval", label: r.id }]} />
      <Heading id="heading.approval" text={`Request ${r.id}`} />
      <FailedAlert />
      {!decidable && <Alert id="alert.not-decidable" tone="warning" title="Cannot be decided" text="Only pending requests within your approval limit can be approved or rejected." />}
      <Detail
        id="detail.approval"
        fields={[
          { label: "Requester", value: r.requester },
          { label: "Justification", value: r.justification || "None" },
          { label: "Total", value: money(total(r)) },
          { label: "Status", value: r.status },
        ]}
      />
      <Section id="section.approval-lines" title="Lines" count={r.lines.length}>
        <Table
          id="table.approval-lines"
          columns={["Item", { label: "Quantity", kind: "number" }, { label: "Unit price", kind: "number" }, { label: "Line total", kind: "number" }]}
          rows={r.lines.map((l) => ({ id: `aline.${l.id}`, cells: [l.itemName, String(l.qty), money(l.priceCents), money(l.qty * l.priceCents)] }))}
        />
      </Section>
      <Button id="btn.approve" label="Approve" emphasis="primary" disabled={!decidable} onPress={() => { reqs.update(r.id, { status: "approved", decidedBy: ALAN }); navigate.go("screen.decisions"); }} />
      <Button id="btn.reject" label="Reject" emphasis="danger" disabled={!decidable} onPress={() => setRejecting(true)} />
      <Dialog id="dialog.reject" title={`Reject request ${r.id}`} open={rejecting} onClose={() => setRejecting(false)}>
        <Form
          id="form.reject"
          onSubmit={(v) => { reqs.update(r.id, { status: "rejected", decidedBy: ALAN, reason: v["reason"] ?? "" }); setRejecting(false); navigate.go("screen.decisions"); }}
          actions={<Button id="btn.reject.confirm" label="Reject request" emphasis="danger" submit />}
        >
          <Field id="field.reason" name="reason" label="Reason" type="textarea" required error={state === "state.validation-error" ? "Give the requester a reason" : undefined} />
        </Form>
      </Dialog>
    </Shell>
  );
}

function Decisions() {
  const state = useDisplayState();
  const reqs = useCollection<Req>("requests");
  const decided = state === "state.empty" ? [] : reqs.items.filter((r) => r.decidedBy === ALAN);
  return (
    <Shell>
      <Heading id="heading.decisions" text="My decisions" />
      <FailedAlert />
      <Section id="section.decisions" title="Decided requests" count={decided.length} subtitle="Requests you approved or rejected.">
        <Table
          id="table.decisions"
          columns={["Request", "Requester", { label: "Total", kind: "number" }, "Reason", { label: "Decision", kind: "status" }]}
          rows={decided.map((r) => ({
            id: `decision.${r.id}`,
            cells: [r.id, r.requester, money(total(r)), r.reason || "None"],
            status: { text: r.status === "rejected" ? "Rejected" : "Approved", tone: r.status === "rejected" ? ("error" as const) : ("success" as const) },
          }))}
          empty={<EmptyState id="empty.decisions" title="No decisions yet" text="Requests you decide appear here." />}
        />
      </Section>
    </Shell>
  );
}

function Receiving() {
  const state = useDisplayState();
  const reqs = useCollection<Req>("requests");
  const list = state === "state.empty" ? [] : reqs.items.filter((r) => r.status === "approved" && outstanding(r) > 0);
  return (
    <Shell>
      <Heading id="heading.receiving" text="Goods to receive" />
      <FailedAlert />
      <Section id="section.orders" title="Approved requests" count={list.length} subtitle="Oldest first. Open one to record a receipt.">
        <Table
          id="table.orders"
          columns={["Request", "Requester", "Items", { label: "Outstanding", kind: "number" }]}
          rows={list.slice().sort((a, b) => a.submitted.localeCompare(b.submitted)).map((r) => ({
            id: `order.${r.id}`,
            cells: [r.id, r.requester, r.lines.map((l) => `${l.qty} x ${l.itemName}`).join(", "), String(outstanding(r))],
            to: "screen.order-detail",
            params: { request: r.id },
          }))}
          empty={<EmptyState id="empty.orders" title="Nothing to receive" text="Approved requests with goods outstanding appear here." />}
        />
      </Section>
    </Shell>
  );
}

function OrderDetail() {
  const { request: id } = useParams();
  const state = useDisplayState();
  const reqs = useCollection<Req>("requests");
  const stock = useCollection<Item>("items");
  const rows = useCollection<LedgerRow>("ledger");
  const recs = useCollection<Receipt>("receipts");
  const [error, setError] = useState("");
  const order = (id ? reqs.get(id) : undefined) ?? reqs.items.find((r) => r.status === "approved") ?? reqs.items[0]!;
  const history = recs.items.filter((x) => x.requestId === order.id);
  const message = error || (state === "state.validation-error" ? "Received quantity cannot exceed the outstanding quantity" : "");
  const canReceive = order.status === "approved";
  const receive = (v: Record<string, string>) => {
    const qtys = order.lines.map((l) => ({ line: l, q: Number(v[`line.${l.id}`] ?? "0") }));
    if (qtys.some((x) => x.q > x.line.qty - x.line.received)) { setError("Received quantity cannot exceed the outstanding quantity"); return; }
    const given = qtys.filter((x) => x.q > 0);
    if (given.length === 0) { setError("Enter a quantity for at least one line"); return; }
    setError("");
    const receiptId = recs.create({ requestId: order.id, clerk: WANDA, at: "2026-01-15 10:00", summary: given.map((x) => `${x.q} x ${x.line.itemName}`).join(", ") });
    given.forEach((x) => {
      const it = stock.get(x.line.itemId);
      const resulting = (it?.stock ?? 0) + x.q;
      if (it) stock.update(it.id, { stock: resulting });
      rows.create({ itemId: x.line.itemId, itemName: x.line.itemName, change: x.q, resulting, actor: WANDA, receipt: receiptId, at: "2026-01-15 10:00" });
    });
    const lines = order.lines.map((l) => ({ ...l, received: l.received + (qtys.find((x) => x.line.id === l.id)?.q ?? 0) }));
    reqs.update(order.id, { lines, status: lines.every((l) => l.received >= l.qty) ? "received" : "approved" });
  };
  return (
    <Shell>
      <Breadcrumbs id="crumbs.order" items={[{ id: "crumb.orders", label: "Goods to receive", to: "screen.receiving" }, { id: "crumb.order", label: order.id }]} />
      <Heading id="heading.order" text={`Receive goods for ${order.id}`} actions={<Button id="btn.to-ledger" label="View stock ledger" to="screen.ledger" />} />
      <FailedAlert />
      {order.status === "received" && <Alert id="alert.received" tone="success" title="Fully received" text="Every line of this request has been received." />}
      <Section id="section.order-lines" title="Lines" count={order.lines.length} subtitle={`Requested by ${order.requester}.`}>
        <Table
          id="table.order-lines"
          columns={["Item", { label: "Ordered", kind: "number" }, { label: "Received", kind: "number" }, { label: "Outstanding", kind: "number" }]}
          rows={order.lines.map((l) => ({ id: `oline.${l.id}`, cells: [l.itemName, String(l.qty), String(l.received), String(l.qty - l.received)] }))}
        />
      </Section>
      {canReceive && (
        <Section id="section.receive" title="Record a receipt" subtitle="Enter what arrived. A saved receipt cannot be changed.">
          {message !== "" && <ValidationSummary id="summary.receive" issues={[message]} />}
          <Form
            id="form.receive"
            onSubmit={receive}
            actions={<Button id="btn.save-receipt" label="Save receipt" emphasis="primary" submit />}
          >
            {order.lines.filter((l) => l.qty > l.received).map((l) => (
              <Field key={l.id} id={`field.line.${l.id}`} name={`line.${l.id}`} label={`${l.itemName} received (outstanding ${l.qty - l.received})`} type="number" defaultValue="0" />
            ))}
          </Form>
        </Section>
      )}
      <Section id="section.receipts" title="Receipt history" count={history.length}>
        <Table
          id="table.receipts"
          columns={["Receipt", "Received", "By", "Items"]}
          rows={history.slice().reverse().map((x) => ({ id: `receipt.${x.id}`, cells: [x.id, x.at, x.clerk, x.summary] }))}
          empty={<EmptyState id="empty.receipts" title="No receipts yet" text="Receipts you save appear here." />}
        />
      </Section>
    </Shell>
  );
}

function LedgerScreen() {
  const state = useDisplayState();
  const rows = useCollection<LedgerRow>("ledger");
  const stock = useCollection<Item>("items");
  const [filter, setFilter] = useState("All items");
  const [from, setFrom] = useState("");
  const shown = state === "state.empty" ? [] : rows.items.filter((l) => (filter === "All items" || l.itemName === filter) && (from === "" || l.at >= from));
  return (
    <Shell>
      <Heading id="heading.ledger" text="Stock ledger" />
      <FailedAlert />
      <Section id="section.ledger" title="Ledger entries" count={shown.length} subtitle="Newest first. Entries are append-only; stock equals their sum.">
        <Filters id="filters.ledger">
          <Field id="field.ledger-item" label="Item" type="select" options={["All items", ...stock.items.map((i) => i.name)]} value={filter} onChange={setFilter} />
          <Field id="field.ledger-from" label="From date" type="date" value={from} onChange={setFrom} />
        </Filters>
        <Table
          id="table.ledger"
          columns={["Time", "Item", { label: "Change", kind: "number" }, { label: "Resulting stock", kind: "number" }, "By", "Receipt"]}
          rows={shown.map((l) => ({ id: `ledger.${l.id}`, cells: [l.at, l.itemName, l.change > 0 ? `+${l.change}` : String(l.change), String(l.resulting), l.actor, l.receipt] }))}
          empty={<EmptyState id="empty.ledger" title="No ledger entries" text="Entries appear when goods are received." />}
        />
      </Section>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const u = users[role] ?? users["Requester"]!;
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail id="detail.account" fields={[{ label: "Name", value: u.name }, { label: "Email", value: u.email }]} />
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
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to="screen.home" />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.home": Home,
    "screen.catalogue": Catalogue,
    "screen.item-detail": ItemDetail,
    "screen.low-stock": LowStock,
    "screen.requests": Requests,
    "screen.request-new": RequestNew,
    "screen.request-detail": RequestDetail,
    "screen.approvals": Approvals,
    "screen.approval-detail": ApprovalDetail,
    "screen.decisions": Decisions,
    "screen.receiving": Receiving,
    "screen.order-detail": OrderDetail,
    "screen.ledger": LedgerScreen,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { items, requests, ledger, receipts },
});
