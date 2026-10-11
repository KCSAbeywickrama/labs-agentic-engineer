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
  Alert, AppShell, Breadcrumbs, Button, Detail, Dialog, EmptyState, Field, Form,
  Heading, Screen, Section, Stat, StatGroup, Table, ValidationSummary, defineApp,
  useCollection, useDisplayState, useNav, useParams, useRole, useValue,
} from "@wso2/prototype-kit";

interface Item {
  id: string;
  sku: string;
  name: string;
  unit: string;
  unitPrice: number;
  onHand: number;
  reorderLevel: number;
}

interface LedgerEntry {
  id: string;
  itemId: string;
  quantityChange: number;
  balanceAfter: number;
  reason: string;
  reference: string;
  createdBy: string;
  createdAt: string;
}

interface RequestLine {
  itemId: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  receivedQuantity: number;
}

interface PurchaseRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  status: "pending" | "approved" | "rejected" | "partially-received" | "received";
  totalValue: number;
  decidedBy?: string;
  decisionReason?: string;
  lines: RequestLine[];
  createdAt: string;
}

const items: Item[] = [
  { id: "item-1", sku: "SKU-1001", name: "A4 Paper Ream", unit: "ream", unitPrice: 4.5, onHand: 120, reorderLevel: 50 },
  { id: "item-2", sku: "SKU-1002", name: "Laptop Stand", unit: "unit", unitPrice: 32, onHand: 8, reorderLevel: 10 },
  { id: "item-3", sku: "SKU-1003", name: "Printer Toner Cartridge", unit: "cartridge", unitPrice: 85, onHand: 15, reorderLevel: 5 },
  { id: "item-4", sku: "SKU-1004", name: "Whiteboard Markers (Pack of 12)", unit: "pack", unitPrice: 9.75, onHand: 40, reorderLevel: 15 },
  { id: "item-5", sku: "SKU-1005", name: "Office Chair", unit: "unit", unitPrice: 145, onHand: 3, reorderLevel: 5 },
];

const ledgerEntries: LedgerEntry[] = [
  { id: "ledger-1", itemId: "item-2", quantityChange: 10, balanceAfter: 8, reason: "goods-receipt", reference: "req-1032", createdBy: "Wanda Silva", createdAt: "2026-01-10T09:30:00Z" },
  { id: "ledger-2", itemId: "item-3", quantityChange: 20, balanceAfter: 15, reason: "goods-receipt", reference: "req-1028", createdBy: "Wanda Silva", createdAt: "2026-01-05T14:00:00Z" },
  { id: "ledger-3", itemId: "item-5", quantityChange: 3, balanceAfter: 3, reason: "goods-receipt", reference: "req-1020", createdBy: "Wanda Silva", createdAt: "2025-12-20T11:15:00Z" },
];

const purchaseRequests: PurchaseRequest[] = [
  { id: "req-1042", requesterId: "rita", requesterName: "Rita Fernando", status: "pending", totalValue: 320, lines: [{ itemId: "item-2", itemName: "Laptop Stand", quantity: 10, unitPrice: 32, receivedQuantity: 0 }], createdAt: "2026-01-14T10:00:00Z" },
  { id: "req-1050", requesterId: "ravi", requesterName: "Ravi Perera", status: "pending", totalValue: 5800, lines: [{ itemId: "item-5", itemName: "Office Chair", quantity: 40, unitPrice: 145, receivedQuantity: 0 }], createdAt: "2026-01-13T09:00:00Z" },
  { id: "req-1055", requesterId: "alan", requesterName: "Alan Peris", status: "pending", totalValue: 300, lines: [{ itemId: "item-4", itemName: "Whiteboard Markers (Pack of 12)", quantity: 30, unitPrice: 9.75, receivedQuantity: 0 }], createdAt: "2026-01-12T08:30:00Z" },
  { id: "req-1039", requesterId: "rita", requesterName: "Rita Fernando", status: "approved", totalValue: 425, decidedBy: "Alan Peris", lines: [{ itemId: "item-3", itemName: "Printer Toner Cartridge", quantity: 5, unitPrice: 85, receivedQuantity: 0 }], createdAt: "2026-01-08T10:00:00Z" },
  { id: "req-1031", requesterId: "rita", requesterName: "Rita Fernando", status: "partially-received", totalValue: 450, decidedBy: "Alan Peris", lines: [{ itemId: "item-1", itemName: "A4 Paper Ream", quantity: 100, unitPrice: 4.5, receivedQuantity: 40 }], createdAt: "2026-01-02T10:00:00Z" },
  { id: "req-1025", requesterId: "ravi", requesterName: "Ravi Perera", status: "rejected", totalValue: 48.75, decidedBy: "Alan Peris", decisionReason: "Not budgeted this quarter", lines: [{ itemId: "item-4", itemName: "Whiteboard Markers (Pack of 12)", quantity: 5, unitPrice: 9.75, receivedQuantity: 0 }], createdAt: "2025-12-28T10:00:00Z" },
];

const approvalLimit = 5000;

const users: Record<string, { name: string; email: string }> = {
  Requester: { name: "Rita Fernando", email: "rita.fernando@acme.example" },
  Approver: { name: "Alan Peris", email: "alan.peris@acme.example" },
  "Warehouse Clerk": { name: "Wanda Silva", email: "wanda.silva@acme.example" },
};

function statusTone(status: PurchaseRequest["status"]): { text: string; tone: "default" | "info" | "success" | "warning" | "error" } {
  switch (status) {
    case "pending":
      return { text: "Pending", tone: "warning" };
    case "approved":
      return { text: "Approved", tone: "info" };
    case "rejected":
      return { text: "Rejected", tone: "error" };
    case "partially-received":
      return { text: "Partially received", tone: "info" };
    case "received":
      return { text: "Received", tone: "success" };
  }
}

function roleHome(role: string): string {
  if (role === "Requester") return "screen.catalogue";
  if (role === "Approver") return "screen.approval-queue";
  return "screen.orders";
}

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  const user = users[role] ?? users.Requester;
  const nav =
    role === "Requester"
      ? [
          { id: "nav.catalogue", label: "Catalogue", to: "screen.catalogue" },
          { id: "nav.my-requests", label: "My requests", to: "screen.my-requests" },
        ]
      : role === "Approver"
      ? [{ id: "nav.approval-queue", label: "Approval queue", to: "screen.approval-queue" }]
      : [
          { id: "nav.orders", label: "Orders to receive", to: "screen.orders" },
          { id: "nav.stock", label: "Stock & low stock", to: "screen.stock" },
          { id: "nav.catalogue-manage", label: "Catalogue", to: "screen.catalogue-manage" },
        ];
  return (
    <AppShell id="shell" user={{ ...user, role }} nav={nav} account="screen.account" settings="screen.settings" signOut="screen.signed-out">
      {children}
    </AppShell>
  );
}

function Catalogue() {
  const all = useCollection<Item>("items");
  return (
    <Shell>
      <Heading id="heading.catalogue" text="Catalogue" actions={<Button id="btn.new-request" label="New request" emphasis="primary" to="screen.new-request" />} />
      <Section id="section.items" title="Items" count={all.items.length} subtitle="Items available to request.">
        <Table
          id="table.items"
          columns={["Name", "Unit", { label: "Unit price", kind: "number" }, { label: "On hand", kind: "number" }]}
          rows={all.items.map((it) => ({
            id: `item.${it.id}`,
            cells: [it.name, it.unit, `$${it.unitPrice.toFixed(2)}`, String(it.onHand)],
            actions: [{ id: `item.${it.id}.request`, label: "Request", to: "screen.new-request", params: { item: it.id } }],
          }))}
          empty={<EmptyState id="empty.items" title="No items" text="No catalogue items yet." />}
        />
      </Section>
    </Shell>
  );
}

function NewRequest() {
  const { item: itemParam } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const itemsAll = useCollection<Item>("items");
  const requests = useCollection<PurchaseRequest>("purchaseRequests");
  const defaultItem = (itemParam ? itemsAll.get(itemParam) : undefined) ?? itemsAll.items[0]!;
  const submit = (values: Record<string, string>) => {
    const item = itemsAll.items.find((it) => it.name === values.item) ?? defaultItem;
    const quantity = Number(values.quantity) || 0;
    requests.create({
      requesterId: "rita",
      requesterName: users.Requester.name,
      status: "pending",
      totalValue: item.unitPrice * quantity,
      lines: [{ itemId: item.id, itemName: item.name, quantity, unitPrice: item.unitPrice, receivedQuantity: 0 }],
      createdAt: "2026-01-15T09:00:00Z",
    });
    navigate.go("screen.my-requests");
  };
  return (
    <Shell>
      <Heading id="heading.new-request" text="Raise a purchase request" />
      <Section id="section.new-request" title="Request details" subtitle="Choose an item and the quantity you need.">
        {state === "state.validation-error" && (
          <ValidationSummary id="summary.new-request" issues={["Choose an item", "Enter a quantity of at least 1"]} />
        )}
        <Form id="form.new-request" onSubmit={submit} actions={<Button id="btn.submit-request" label="Raise request" emphasis="primary" submit />}>
          <Field
            id="field.item"
            name="item"
            label="Item"
            type="select"
            options={itemsAll.items.map((it) => it.name)}
            defaultValue={defaultItem.name}
            required
          />
          <Field
            id="field.quantity"
            name="quantity"
            label="Quantity"
            type="number"
            defaultValue="1"
            required
            error={state === "state.validation-error" ? "Enter a quantity of at least 1" : undefined}
          />
        </Form>
      </Section>
    </Shell>
  );
}

function MyRequests() {
  const state = useDisplayState();
  const requests = useCollection<PurchaseRequest>("purchaseRequests");
  const mine = state === "state.empty" ? [] : requests.items.filter((r) => r.requesterId === "rita");
  return (
    <Shell>
      <Heading id="heading.my-requests" text="My requests" />
      <Section id="section.my-requests" title="Requests" count={mine.length} subtitle="Status of the requests you have raised.">
        <Table
          id="table.my-requests"
          columns={["Item", { label: "Total value", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={mine.map((r) => ({
            id: `request.${r.id}`,
            cells: [r.lines.map((l) => l.itemName).join(", "), `$${r.totalValue.toFixed(2)}`],
            status: statusTone(r.status),
            to: "screen.request-detail",
            params: { request: r.id },
          }))}
          empty={<EmptyState id="empty.my-requests" title="No requests yet" text="Requests you raise appear here." />}
        />
      </Section>
    </Shell>
  );
}

function RequestDetail() {
  const { request: id } = useParams();
  const requests = useCollection<PurchaseRequest>("purchaseRequests");
  const request = (id ? requests.get(id) : undefined) ?? requests.items[0]!;
  const tone = statusTone(request.status);
  return (
    <Shell>
      <Breadcrumbs
        id="breadcrumbs.request"
        items={[
          { id: "crumb.my-requests", label: "My requests", to: "screen.my-requests" },
          { id: "crumb.request", label: request.id },
        ]}
      />
      <Heading id="heading.request-detail" text={`Request ${request.id}`} />
      <Detail
        id="detail.request"
        fields={[
          { label: "Status", value: tone.text },
          { label: "Total value", value: `$${request.totalValue.toFixed(2)}` },
          { label: "Decided by", value: request.decidedBy ?? "—" },
          { label: "Reason", value: request.decisionReason ?? "—" },
        ]}
      />
      <Section id="section.request-lines" title="Items" count={request.lines.length}>
        <Table
          id="table.request-lines"
          columns={["Item", { label: "Quantity", kind: "number" }, { label: "Unit price", kind: "number" }, { label: "Received", kind: "number" }]}
          rows={request.lines.map((l, i) => ({
            id: `line.${i}`,
            cells: [l.itemName, String(l.quantity), `$${l.unitPrice.toFixed(2)}`, String(l.receivedQuantity)],
          }))}
        />
      </Section>
    </Shell>
  );
}

function ApprovalQueue() {
  const state = useDisplayState();
  const requests = useCollection<PurchaseRequest>("purchaseRequests");
  const pending = state === "state.empty" ? [] : requests.items.filter((r) => r.status === "pending");
  return (
    <Shell>
      <Heading id="heading.approval-queue" text="Approval queue" />
      <StatGroup>
        <Stat id="stat.pending" label="Awaiting decision" value={String(pending.length)} hint="requests to review" icon="ClipboardList" tone="warning" />
      </StatGroup>
      <Section id="section.pending" title="Pending requests" count={pending.length} subtitle="Oldest first. Open a request to approve or reject it.">
        <Table
          id="table.pending"
          columns={["Requester", { label: "Total value", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={pending.map((r) => ({
            id: `request.${r.id}`,
            cells: [r.requesterName, `$${r.totalValue.toFixed(2)}`],
            status: statusTone(r.status),
            to: "screen.approval-detail",
            params: { request: r.id },
          }))}
          empty={<EmptyState id="empty.pending" title="Nothing pending" text="New requests appear here." />}
        />
      </Section>
    </Shell>
  );
}

function ApprovalDetail() {
  const { request: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const requests = useCollection<PurchaseRequest>("purchaseRequests");
  const [rejecting, setRejecting] = useState(false);
  const fallback = requests.items.find((r) => r.status === "pending") ?? requests.items[0]!;
  const request =
    state === "state.refused"
      ? requests.items.find((r) => r.totalValue > approvalLimit) ?? fallback
      : (id ? requests.get(id) : undefined) ?? fallback;
  const overLimit = request.totalValue > approvalLimit;
  const selfApproval = request.requesterId === "alan";
  const refused = overLimit || selfApproval;
  const approve = () => {
    if (refused) return;
    requests.update(request.id, { status: "approved", decidedBy: "Alan Peris" });
    navigate.go("screen.approval-queue");
  };
  const reject = (values: Record<string, string>) => {
    requests.update(request.id, { status: "rejected", decidedBy: "Alan Peris", decisionReason: values.reason });
    navigate.go("screen.approval-queue");
  };
  return (
    <Shell>
      <Breadcrumbs
        id="breadcrumbs.approval"
        items={[
          { id: "crumb.queue", label: "Approval queue", to: "screen.approval-queue" },
          { id: "crumb.request", label: request.id },
        ]}
      />
      <Heading id="heading.approval-detail" text={`Request ${request.id}`} />
      {refused && (
        <Alert
          id="alert.refused"
          tone="error"
          title="Cannot approve"
          text={
            selfApproval
              ? "You raised this request; you cannot approve your own request."
              : `The total $${request.totalValue.toFixed(2)} is above the approval limit of $${approvalLimit.toFixed(2)}.`
          }
        />
      )}
      <Detail
        id="detail.approval"
        fields={[
          { label: "Requester", value: request.requesterName },
          { label: "Total value", value: `$${request.totalValue.toFixed(2)}` },
          { label: "Status", value: statusTone(request.status).text },
        ]}
      />
      <Section id="section.approval-lines" title="Items" count={request.lines.length}>
        <Table
          id="table.approval-lines"
          columns={["Item", { label: "Quantity", kind: "number" }, { label: "Unit price", kind: "number" }]}
          rows={request.lines.map((l, i) => ({ id: `line.${i}`, cells: [l.itemName, String(l.quantity), `$${l.unitPrice.toFixed(2)}`] }))}
        />
      </Section>
      <Button id="btn.approve" label="Approve" emphasis="primary" disabled={refused} onPress={approve} />
      <Button id="btn.reject" label="Reject" emphasis="danger" onPress={() => setRejecting(true)} />
      <Dialog id="dialog.reject" title={`Reject request ${request.id}`} open={rejecting} onClose={() => setRejecting(false)}>
        <Form id="form.reject" onSubmit={reject} actions={<Button id="btn.reject-confirm" label="Reject" emphasis="danger" submit />}>
          <Field
            id="field.reject-reason"
            name="reason"
            label="Reason"
            type="textarea"
            required
            error={state === "state.validation-error" ? "Give the requester a reason" : undefined}
          />
        </Form>
      </Dialog>
    </Shell>
  );
}

function Orders() {
  const state = useDisplayState();
  const requests = useCollection<PurchaseRequest>("purchaseRequests");
  const openOrders = state === "state.empty" ? [] : requests.items.filter((r) => r.status === "approved" || r.status === "partially-received");
  return (
    <Shell>
      <Heading id="heading.orders" text="Orders to receive" />
      <Section id="section.orders" title="Approved orders" count={openOrders.length} subtitle="Open an order to record what arrived.">
        <Table
          id="table.orders"
          columns={["Requester", "Item", { label: "Status", kind: "status" }]}
          rows={openOrders.map((r) => ({
            id: `order.${r.id}`,
            cells: [r.requesterName, r.lines.map((l) => l.itemName).join(", ")],
            status: statusTone(r.status),
            to: "screen.receive",
            params: { request: r.id },
          }))}
          empty={<EmptyState id="empty.orders" title="Nothing to receive" text="Approved orders appear here." />}
        />
      </Section>
    </Shell>
  );
}

function Receive() {
  const { request: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const requests = useCollection<PurchaseRequest>("purchaseRequests");
  const itemsAll = useCollection<Item>("items");
  const ledger = useCollection<LedgerEntry>("ledgerEntries");
  const openOrders = requests.items.filter((r) => r.status === "approved" || r.status === "partially-received");
  const request = (id ? requests.get(id) : undefined) ?? openOrders[0]!;
  const line = request.lines[0]!;
  const outstanding = line.quantity - line.receivedQuantity;
  const submit = (values: Record<string, string>) => {
    const quantity = Number(values.quantity) || 0;
    if (quantity <= 0 || quantity > outstanding) return;
    const item = itemsAll.get(line.itemId)!;
    const newOnHand = item.onHand + quantity;
    itemsAll.update(item.id, { onHand: newOnHand });
    ledger.create({
      itemId: item.id,
      quantityChange: quantity,
      balanceAfter: newOnHand,
      reason: "goods-receipt",
      reference: request.id,
      createdBy: "Wanda Silva",
      createdAt: "2026-01-15T09:00:00Z",
    });
    const receivedQuantity = line.receivedQuantity + quantity;
    const newStatus = receivedQuantity >= line.quantity ? "received" : "partially-received";
    requests.update(request.id, { status: newStatus, lines: [{ ...line, receivedQuantity }] });
    navigate.go("screen.orders");
  };
  return (
    <Shell>
      <Breadcrumbs
        id="breadcrumbs.receive"
        items={[
          { id: "crumb.orders", label: "Orders to receive", to: "screen.orders" },
          { id: "crumb.request", label: request.id },
        ]}
      />
      <Heading id="heading.receive" text={`Receive ${request.id}`} />
      <Detail
        id="detail.receive"
        fields={[
          { label: "Item", value: line.itemName },
          { label: "Ordered", value: String(line.quantity) },
          { label: "Received so far", value: String(line.receivedQuantity) },
          { label: "Outstanding", value: String(outstanding) },
        ]}
      />
      {state === "state.validation-error" && (
        <ValidationSummary id="summary.receive" issues={[`Quantity must be between 1 and ${outstanding}`]} />
      )}
      <Form id="form.receive" onSubmit={submit} actions={<Button id="btn.receive-submit" label="Record receipt" emphasis="primary" submit />}>
        <Field
          id="field.receive-quantity"
          name="quantity"
          label="Quantity received"
          type="number"
          required
          defaultValue={String(outstanding)}
          error={state === "state.validation-error" ? `Must be 1–${outstanding}` : undefined}
        />
      </Form>
    </Shell>
  );
}

function Stock() {
  const state = useDisplayState();
  const itemsAll = useCollection<Item>("items");
  const all = state === "state.failed" ? [] : itemsAll.items;
  const lowStock = all.filter((it) => it.onHand < it.reorderLevel);
  return (
    <Shell>
      <Heading id="heading.stock" text="Stock" />
      {state === "state.failed" && (
        <Alert id="alert.stock-failed" tone="error" title="Stock levels unavailable" text="The inventory service did not respond. Try again shortly." />
      )}
      <Section id="section.stock" title="Stock levels" count={all.length} subtitle="Every catalogue item and how much is on hand.">
        <Table
          id="table.stock"
          columns={["Item", { label: "On hand", kind: "number" }, { label: "Reorder level", kind: "number" }]}
          rows={all.map((it) => ({
            id: `stock.${it.id}`,
            cells: [it.name, String(it.onHand), String(it.reorderLevel)],
            to: "screen.item-ledger",
            params: { item: it.id },
          }))}
          empty={<EmptyState id="empty.stock" title="No items" text="No catalogue items yet." />}
        />
      </Section>
      <Section id="section.low-stock" title="Low stock" count={lowStock.length} subtitle="Items below their reorder level.">
        <Table
          id="table.low-stock"
          columns={["Item", { label: "On hand", kind: "number" }, { label: "Reorder level", kind: "number" }]}
          rows={lowStock.map((it) => ({
            id: `low.${it.id}`,
            cells: [it.name, String(it.onHand), String(it.reorderLevel)],
            to: "screen.item-ledger",
            params: { item: it.id },
          }))}
          empty={<EmptyState id="empty.low-stock" title="Nothing low" text="No item is below its reorder level." />}
        />
      </Section>
    </Shell>
  );
}

function ItemLedger() {
  const { item: itemParam } = useParams();
  const state = useDisplayState();
  const itemsAll = useCollection<Item>("items");
  const ledger = useCollection<LedgerEntry>("ledgerEntries");
  const item = (itemParam ? itemsAll.get(itemParam) : undefined) ?? itemsAll.items[0]!;
  const entries = state === "state.empty" ? [] : ledger.items.filter((e) => e.itemId === item.id);
  return (
    <Shell>
      <Breadcrumbs id="breadcrumbs.ledger" items={[{ id: "crumb.stock", label: "Stock", to: "screen.stock" }, { id: "crumb.item", label: item.name }]} />
      <Heading id="heading.ledger" text={`Ledger — ${item.name}`} />
      <Detail id="detail.ledger-item" fields={[{ label: "On hand", value: String(item.onHand) }, { label: "Reorder level", value: String(item.reorderLevel) }]} />
      <Section id="section.ledger" title="Ledger entries" count={entries.length} subtitle="Newest first.">
        <Table
          id="table.ledger"
          columns={[{ label: "Change", kind: "number" }, { label: "Balance after", kind: "number" }, "Reason", "Reference", "Recorded by"]}
          rows={entries.map((e) => ({
            id: `entry.${e.id}`,
            cells: [e.quantityChange > 0 ? `+${e.quantityChange}` : String(e.quantityChange), String(e.balanceAfter), e.reason, e.reference, e.createdBy],
          }))}
          empty={<EmptyState id="empty.ledger" title="No ledger entries" text="Stock changes for this item appear here." />}
        />
      </Section>
    </Shell>
  );
}

function CatalogueManage() {
  const state = useDisplayState();
  const itemsAll = useCollection<Item>("items");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingItem = editingId ? itemsAll.get(editingId) : undefined;
  const addItem = (values: Record<string, string>) => {
    itemsAll.create({
      sku: `SKU-${1000 + itemsAll.items.length + 1}`,
      name: values.name,
      unit: values.unit,
      unitPrice: Number(values.unitPrice) || 0,
      onHand: 0,
      reorderLevel: Number(values.reorderLevel) || 0,
    });
    setAdding(false);
  };
  const saveEdit = (values: Record<string, string>) => {
    if (!editingItem) return;
    itemsAll.update(editingItem.id, {
      name: values.name,
      unit: values.unit,
      unitPrice: Number(values.unitPrice) || editingItem.unitPrice,
      reorderLevel: Number(values.reorderLevel) || editingItem.reorderLevel,
    });
    setEditingId(null);
  };
  return (
    <Shell>
      <Heading
        id="heading.catalogue-manage"
        text="Catalogue"
        actions={<Button id="btn.add-item" label="Add item" emphasis="primary" onPress={() => setAdding(true)} />}
      />
      <Section id="section.catalogue-manage" title="Items" count={itemsAll.items.length} subtitle="Add and edit the items staff can request.">
        <Table
          id="table.catalogue-manage"
          columns={["Name", "Unit", { label: "Unit price", kind: "number" }, { label: "Reorder level", kind: "number" }, { label: "On hand", kind: "number" }]}
          rows={itemsAll.items.map((it) => ({
            id: `catalogue.${it.id}`,
            cells: [it.name, it.unit, `$${it.unitPrice.toFixed(2)}`, String(it.reorderLevel), String(it.onHand)],
            actions: [{ id: `catalogue.${it.id}.edit`, label: "Edit", onPress: () => setEditingId(it.id) }],
          }))}
          empty={<EmptyState id="empty.catalogue-manage" title="No items" text="Add the first catalogue item." />}
        />
      </Section>
      <Dialog id="dialog.add-item" title="Add item" open={adding} onClose={() => setAdding(false)}>
        {state === "state.validation-error" && (
          <ValidationSummary id="summary.add-item" issues={["Name is required", "Unit price must be at least 0"]} />
        )}
        <Form id="form.add-item" onSubmit={addItem} actions={<Button id="btn.add-item-save" label="Add item" emphasis="primary" submit />}>
          <Field id="field.add-name" name="name" label="Name" required />
          <Field id="field.add-unit" name="unit" label="Unit" required defaultValue="unit" />
          <Field id="field.add-price" name="unitPrice" label="Unit price" type="number" required />
          <Field id="field.add-reorder" name="reorderLevel" label="Reorder level" type="number" required defaultValue="0" />
        </Form>
      </Dialog>
      <Dialog id="dialog.edit-item" title={`Edit ${editingItem?.name ?? "item"}`} open={!!editingItem} onClose={() => setEditingId(null)}>
        {editingItem && (
          <Form id="form.edit-item" onSubmit={saveEdit} actions={<Button id="btn.edit-item-save" label="Save" emphasis="primary" submit />}>
            <Field id="field.edit-name" name="name" label="Name" defaultValue={editingItem.name} required />
            <Field id="field.edit-unit" name="unit" label="Unit" defaultValue={editingItem.unit} required />
            <Field id="field.edit-price" name="unitPrice" label="Unit price" type="number" defaultValue={String(editingItem.unitPrice)} required />
            <Field id="field.edit-reorder" name="reorderLevel" label="Reorder level" type="number" defaultValue={String(editingItem.reorderLevel)} required />
          </Form>
        )}
      </Dialog>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const user = users[role] ?? users.Requester;
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail id="detail.account" fields={[{ label: "Name", value: user.name }, { label: "Email", value: user.email }, { label: "Role", value: role }]} />
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
        onSubmit={() => navigate.go(roleHome(role))}
        actions={<Button id="btn.save-settings" label="Save settings" emphasis="primary" submit />}
      >
        <Field id="field.email-notifications" label="Email me when a request I follow changes" type="switch" defaultValue="on" />
      </Form>
    </Shell>
  );
}

function SignedOut() {
  const role = useRole();
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to={roleHome(role)} />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.catalogue": Catalogue,
    "screen.new-request": NewRequest,
    "screen.my-requests": MyRequests,
    "screen.request-detail": RequestDetail,
    "screen.approval-queue": ApprovalQueue,
    "screen.approval-detail": ApprovalDetail,
    "screen.orders": Orders,
    "screen.receive": Receive,
    "screen.stock": Stock,
    "screen.item-ledger": ItemLedger,
    "screen.catalogue-manage": CatalogueManage,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { items, ledgerEntries, purchaseRequests },
});
