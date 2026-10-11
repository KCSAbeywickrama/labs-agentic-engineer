import { useState, type ReactNode } from "react";
import {
  AppShell, Breadcrumbs, Button, Detail, Dialog, EmptyState, Field, Form, Heading,
  Screen, Section, Stat, StatGroup, Table, ValidationSummary, defineApp, useCollection,
  useDisplayState, useNav, useParams,
} from "@wso2/prototype-kit";

interface Round {
  id: string;
  restaurant: string;
  notes: string;
  cutoffAt: string;
  closedAt: string;
  openedByName: string;
}

interface Item {
  id: string;
  roundId: string;
  description: string;
  quantity: number;
  priceCents: number;
  addedByName: string;
}

const rounds: Round[] = [
  { id: "round-104", restaurant: "Thai Orchid", notes: "Call when you arrive; ask for extra chili on the side.", cutoffAt: "13:00", closedAt: "", openedByName: "Priya Shah" },
  { id: "round-103", restaurant: "Burrito Bar", notes: "", cutoffAt: "12:30", closedAt: "12:30", openedByName: "Dinesh Kumar" },
];

const items: Item[] = [
  { id: "item-1", roundId: "round-104", description: "Pad Thai", quantity: 1, priceCents: 1200, addedByName: "Priya Shah" },
  { id: "item-2", roundId: "round-104", description: "Green Curry", quantity: 2, priceCents: 1400, addedByName: "Dinesh Kumar" },
  { id: "item-3", roundId: "round-103", description: "Burrito Bowl", quantity: 1, priceCents: 1100, addedByName: "Dinesh Kumar" },
  { id: "item-4", roundId: "round-103", description: "Burrito Bowl", quantity: 1, priceCents: 1100, addedByName: "Maya Lopez" },
  { id: "item-5", roundId: "round-103", description: "Chips & Guac", quantity: 1, priceCents: 400, addedByName: "Maya Lopez" },
];

const currentUser = { name: "Priya Shah", email: "priya@acme.example" };

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <AppShell
      id="shell"
      user={{ name: currentUser.name, email: currentUser.email, role: "Teammate" }}
      nav={[
        { id: "nav.round", label: "Today's round", to: "screen.round" },
        { id: "nav.history", label: "Past rounds", to: "screen.history" },
      ]}
      account="screen.account"
      settings="screen.settings"
      signOut="screen.signed-out"
    >
      {children}
    </AppShell>
  );
}

function TodayRound() {
  const state = useDisplayState();
  const roundsData = useCollection<Round>("rounds");
  const itemsData = useCollection<Item>("items");
  const [editingId, setEditingId] = useState<string | null>(null);

  const openRound = state === "state.empty" ? undefined : roundsData.items.find((r) => !r.closedAt);
  const roundItems = openRound ? itemsData.items.filter((i) => i.roundId === openRound.id) : [];
  const editingItem = editingId ? itemsData.get(editingId) : undefined;
  const isOpener = openRound?.openedByName === currentUser.name;

  return (
    <Shell>
      <Heading id="heading.round" text="Today's round" />
      {!openRound && (
        <Section id="section.open" title="Open today's round" subtitle="Name a restaurant and a cutoff time; the team is notified in Slack.">
          <Form
            id="form.open-round"
            onSubmit={(values) => {
              roundsData.create({
                restaurant: values.restaurant,
                notes: values.notes ?? "",
                cutoffAt: values.cutoff,
                closedAt: "",
                openedByName: currentUser.name,
              });
            }}
            actions={<Button id="btn.open-round" label="Open round" emphasis="primary" submit />}
          >
            {state === "state.validation-error" && (
              <ValidationSummary id="validation.open-round" issues={["The cutoff must be later than now"]} />
            )}
            <Field id="field.restaurant" label="Restaurant" required />
            <Field
              id="field.cutoff"
              label="Cutoff time (HH:MM)"
              required
              error={state === "state.validation-error" ? "Must be later than now" : undefined}
            />
            <Field id="field.notes" label="Notes for whoever orders" type="textarea" />
          </Form>
          <EmptyState id="empty.round" title="No round is open" text="Open one above to start today's order." />
        </Section>
      )}
      {openRound && (
        <>
          <Detail
            id="detail.round"
            title={openRound.restaurant}
            fields={[
              { label: "Opened by", value: openRound.openedByName },
              { label: "Cutoff", value: openRound.cutoffAt },
              { label: "Notes", value: openRound.notes || "None" },
            ]}
          />
          {isOpener && (
            <Button
              id="btn.close-early"
              label="Close round early"
              emphasis="danger"
              onPress={() => roundsData.update(openRound.id, { closedAt: openRound.cutoffAt })}
            />
          )}
          <Section id="section.items" title="Items" count={roundItems.length} subtitle="Everyone's items for this round.">
            <Table
              id="table.items"
              columns={["Teammate", "Description", { label: "Qty", kind: "number" }, { label: "Price", kind: "number" }]}
              rows={roundItems.map((i) => ({
                id: `item.${i.id}`,
                cells: [i.addedByName, i.description, String(i.quantity), money(i.priceCents)],
                actions:
                  i.addedByName === currentUser.name
                    ? [
                        { id: `item.${i.id}.edit`, label: "Edit", onPress: () => setEditingId(i.id) },
                        { id: `item.${i.id}.remove`, label: "Remove", emphasis: "danger", onPress: () => itemsData.remove(i.id) },
                      ]
                    : [],
              }))}
              empty={<EmptyState id="empty.items" title="No items yet" text="Add the first item below." />}
            />
          </Section>
          <Section id="section.add-item" title="Add an item" subtitle="Your description, quantity and price.">
            <Form
              id="form.add-item"
              onSubmit={(values) => {
                itemsData.create({
                  roundId: openRound.id,
                  description: values.description,
                  quantity: Number(values.quantity),
                  priceCents: Math.round(Number(values.price) * 100),
                  addedByName: currentUser.name,
                });
              }}
              actions={<Button id="btn.add-item" label="Add item" emphasis="primary" submit />}
            >
              {state === "state.validation-error" && (
                <ValidationSummary id="validation.add-item" issues={["Quantity and price must be greater than zero"]} />
              )}
              <Field id="field.description" label="Description" required />
              <Field
                id="field.quantity"
                label="Quantity"
                type="number"
                required
                defaultValue="1"
                error={state === "state.validation-error" ? "Must be greater than zero" : undefined}
              />
              <Field
                id="field.price"
                label="Price"
                type="number"
                required
                error={state === "state.validation-error" ? "Must be greater than zero" : undefined}
              />
            </Form>
          </Section>
          <Dialog
            id="dialog.edit-item"
            title={editingItem ? `Edit ${editingItem.description}` : "Edit item"}
            open={!!editingItem}
            onClose={() => setEditingId(null)}
          >
            {editingItem && (
              <Form
                id="form.edit-item"
                onSubmit={(values) => {
                  itemsData.update(editingItem.id, {
                    quantity: Number(values.quantity),
                    priceCents: Math.round(Number(values.price) * 100),
                  });
                  setEditingId(null);
                }}
                actions={<Button id="btn.edit-item.save" label="Save" emphasis="primary" submit />}
              >
                <Field id="field.edit-quantity" name="quantity" label="Quantity" type="number" required defaultValue={String(editingItem.quantity)} />
                <Field id="field.edit-price" name="price" label="Price" type="number" required defaultValue={(editingItem.priceCents / 100).toFixed(2)} />
              </Form>
            )}
          </Dialog>
        </>
      )}
    </Shell>
  );
}

function History() {
  const state = useDisplayState();
  const roundsData = useCollection<Round>("rounds");
  const closedRounds = state === "state.empty" ? [] : roundsData.items.filter((r) => r.closedAt);

  return (
    <Shell>
      <Heading id="heading.history" text="Past rounds" />
      <Section id="section.history" title="Past rounds" count={closedRounds.length} subtitle="Who ordered what, from where, on which day.">
        <Table
          id="table.history"
          columns={["Restaurant", "Opened by", { label: "Cutoff", kind: "text" }]}
          rows={closedRounds.map((r) => ({
            id: `round.${r.id}`,
            cells: [r.restaurant, r.openedByName, r.cutoffAt],
            to: "screen.consolidated",
            params: { round: r.id },
          }))}
          empty={<EmptyState id="empty.history" title="No past rounds yet" text="Closed rounds appear here." />}
        />
      </Section>
    </Shell>
  );
}

function Consolidated() {
  const { round: roundId } = useParams();
  const roundsData = useCollection<Round>("rounds");
  const itemsData = useCollection<Item>("items");
  const closed = roundsData.items.filter((r) => r.closedAt);
  const round = (roundId ? roundsData.get(roundId) : undefined) ?? closed[0]!;
  const roundItems = itemsData.items.filter((i) => i.roundId === round.id);

  const byDescription = new Map<string, number>();
  for (const i of roundItems) byDescription.set(i.description, (byDescription.get(i.description) ?? 0) + i.quantity);

  const byPerson = new Map<string, number>();
  for (const i of roundItems) byPerson.set(i.addedByName, (byPerson.get(i.addedByName) ?? 0) + i.quantity * i.priceCents);

  const grandTotal = roundItems.reduce((sum, i) => sum + i.quantity * i.priceCents, 0);

  return (
    <Shell>
      <Breadcrumbs
        id="breadcrumbs.consolidated"
        items={[
          { id: "crumb.history", label: "Past rounds", to: "screen.history" },
          { id: "crumb.round", label: round.restaurant },
        ]}
      />
      <Heading id="heading.consolidated" text={`Consolidated order — ${round.restaurant}`} />
      <StatGroup>
        <Stat id="stat.grand-total" label="Grand total" value={money(grandTotal)} hint="to pay the restaurant" icon="Receipt" />
      </StatGroup>
      <Section id="section.order" title="Order to place" subtitle="Grouped by item, with total quantities.">
        <Table
          id="table.order"
          columns={["Item", { label: "Qty", kind: "number" }]}
          rows={[...byDescription.entries()].map(([description, qty]) => ({
            id: `order.${description}`,
            cells: [description, String(qty)],
          }))}
          empty={<EmptyState id="empty.order" title="No items" text="This round closed with nothing ordered." />}
        />
      </Section>
      <Section id="section.totals" title="Who owes what" subtitle="Each teammate's cost total.">
        <Table
          id="table.totals"
          columns={["Teammate", { label: "Total", kind: "number" }]}
          rows={[...byPerson.entries()].map(([name, cents]) => ({
            id: `total.${name}`,
            cells: [name, money(cents)],
          }))}
        />
      </Section>
    </Shell>
  );
}

function Account() {
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail id="detail.account" fields={[{ label: "Name", value: currentUser.name }, { label: "Email", value: currentUser.email }]} />
    </Shell>
  );
}

function Settings() {
  const navigate = useNav();
  return (
    <Shell>
      <Heading id="heading.settings" text="Settings" />
      <Form id="form.settings" onSubmit={() => navigate.go("screen.round")} actions={<Button id="btn.save-settings" label="Save settings" emphasis="primary" submit />}>
        <Field id="field.digest" label="Notify me in Slack when a round opens" type="switch" defaultValue="on" />
      </Form>
    </Shell>
  );
}

function SignedOut() {
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to="screen.round" />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.round": TodayRound,
    "screen.history": History,
    "screen.consolidated": Consolidated,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { rounds, items },
});
