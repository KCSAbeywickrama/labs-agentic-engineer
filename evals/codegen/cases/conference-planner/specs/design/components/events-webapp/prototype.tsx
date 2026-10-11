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
  Alert, AppShell, Breadcrumbs, Button, Detail, Dialog, Drawer, EmptyState, Field, Filters, Form, Heading,
  Screen, Section, Stat, StatGroup, Table, ValidationSummary, defineApp, useCollection, useDisplayState,
  useNav, useParams, useRole,
} from "@wso2/prototype-kit";

type Tone = "default" | "info" | "success" | "warning" | "error";

interface Ev { id: string; name: string; startDate: string; endDate: string; venue: string; timeZone: string; capacity: number; cfpOpen: boolean }
interface Room { id: string; eventId: string; name: string; capacity: number }
interface Sess { id: string; eventId: string; roomId: string; title: string; day: string; start: string; end: string; capacity: number; speaker: string }
interface Prop { id: string; eventId: string; title: string; abstract: string; format: string; duration: number; speaker: string; status: string; comment: string; avg: number; reviewCount: number; myScore: number; myComment: string }
interface Review { id: string; proposalId: string; reviewer: string; score: number; comment: string }
interface Reg { id: string; targetType: string; targetId: string; target: string; eventId: string; person: string; status: string }
interface Reviewer { id: string; eventId: string; name: string; bound: boolean }

const events: Ev[] = [
  { id: "event.1", name: "DevSummit 2027", startDate: "2027-03-10", endDate: "2027-03-12", venue: "Riverside Hall", timeZone: "Europe/Lisbon", capacity: 2, cfpOpen: true },
  { id: "event.2", name: "Cloud Native Days", startDate: "2027-06-04", endDate: "2027-06-05", venue: "Harbour Conference Centre", timeZone: "Europe/Berlin", capacity: 200, cfpOpen: false },
  { id: "event.3", name: "Data Forum", startDate: "2027-09-21", endDate: "2027-09-22", venue: "Lakeside Congress Hall", timeZone: "America/Toronto", capacity: 150, cfpOpen: true },
];
const rooms: Room[] = [
  { id: "room.1", eventId: "event.1", name: "Hall A", capacity: 100 },
  { id: "room.2", eventId: "event.1", name: "Hall B", capacity: 40 },
];
const sessions: Sess[] = [
  { id: "session.1", eventId: "event.1", roomId: "room.1", title: "Opening Keynote", day: "2027-03-10", start: "09:00", end: "10:00", capacity: 2, speaker: "Mei Tanaka" },
  { id: "session.2", eventId: "event.1", roomId: "room.2", title: "Scaling Waitlists", day: "2027-03-10", start: "10:30", end: "11:15", capacity: 30, speaker: "Sara Jensen" },
  { id: "session.3", eventId: "event.1", roomId: "room.1", title: "Panel: Open Source Funding", day: "2027-03-11", start: "14:00", end: "15:00", capacity: 80, speaker: "" },
];
const proposals: Prop[] = [
  { id: "proposal.1", eventId: "event.1", title: "Scaling Waitlists", abstract: "How a registration service promotes the next person without overbooking.", format: "Talk", duration: 45, speaker: "Sara Jensen", status: "Accepted", comment: "Great fit for the main track", avg: 4.5, reviewCount: 2, myScore: 4, myComment: "Clear and timely" },
  { id: "proposal.2", eventId: "event.1", title: "Event Sourcing in Practice", abstract: "Lessons from three production migrations.", format: "Workshop", duration: 90, speaker: "Sara Jensen", status: "Under review", comment: "", avg: 3, reviewCount: 1, myScore: 3, myComment: "Needs a sharper outline" },
  { id: "proposal.3", eventId: "event.1", title: "Accessible Dashboards", abstract: "Designing charts everyone can read.", format: "Talk", duration: 30, speaker: "Noor Rahman", status: "Submitted", comment: "", avg: 0, reviewCount: 0, myScore: 0, myComment: "" },
  { id: "proposal.4", eventId: "event.1", title: "Rust for Platform Teams", abstract: "When a rewrite pays off.", format: "Talk", duration: 30, speaker: "Luca Moretti", status: "Rejected", comment: "Overlaps another talk", avg: 2.5, reviewCount: 2, myScore: 0, myComment: "" },
];
const reviews: Review[] = [
  { id: "review.1", proposalId: "proposal.1", reviewer: "Rita Patel", score: 4, comment: "Clear and timely" },
  { id: "review.2", proposalId: "proposal.1", reviewer: "Kofi Mensah", score: 5, comment: "Best proposal this year" },
  { id: "review.3", proposalId: "proposal.2", reviewer: "Rita Patel", score: 3, comment: "Needs a sharper outline" },
];
const registrations: Reg[] = [
  { id: "reg.1", targetType: "event", targetId: "event.1", target: "DevSummit 2027", eventId: "event.1", person: "Dan Okafor", status: "confirmed" },
  { id: "reg.2", targetType: "event", targetId: "event.1", target: "DevSummit 2027", eventId: "event.1", person: "Eve Lindqvist", status: "confirmed" },
  { id: "reg.3", targetType: "event", targetId: "event.1", target: "DevSummit 2027", eventId: "event.1", person: "Finn Aalto", status: "waitlisted" },
  { id: "reg.4", targetType: "session", targetId: "session.1", target: "Opening Keynote", eventId: "event.1", person: "Dan Okafor", status: "confirmed" },
  { id: "reg.5", targetType: "session", targetId: "session.1", target: "Opening Keynote", eventId: "event.1", person: "Eve Lindqvist", status: "confirmed" },
  { id: "reg.6", targetType: "session", targetId: "session.1", target: "Opening Keynote", eventId: "event.1", person: "Finn Aalto", status: "waitlisted" },
];
const reviewers: Reviewer[] = [
  { id: "reviewer.1", eventId: "event.1", name: "Rita Patel", bound: true },
  { id: "reviewer.2", eventId: "event.1", name: "Kofi Mensah", bound: true },
  { id: "reviewer.3", eventId: "event.1", name: "noor.haddad", bound: false },
];

const people: Record<string, { name: string; email: string }> = {
  Organizer: { name: "Olivia Marsh", email: "olivia@conf.example" },
  Speaker: { name: "Sara Jensen", email: "sara@conf.example" },
  Reviewer: { name: "Rita Patel", email: "rita@conf.example" },
  Attendee: { name: "Dan Okafor", email: "dan@conf.example" },
};

const statusTone = (s: string): Tone =>
  s === "Accepted" || s === "confirmed" ? "success" : s === "Rejected" ? "error" : s === "Under review" || s === "waitlisted" ? "warning" : "info";

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  const user = people[role] ?? people.Attendee!;
  return (
    <AppShell
      id="shell"
      user={user}
      nav={[
        { id: "nav.events", label: "Events", to: "screen.events" },
        { id: "nav.my-proposals", label: "My proposals", to: "screen.my-proposals" },
        { id: "nav.review-queue", label: "Review queue", to: "screen.review-queue" },
        { id: "nav.event-proposals", label: "Event proposals", to: "screen.event-proposals" },
        { id: "nav.reviewers", label: "Reviewers", to: "screen.reviewers" },
        { id: "nav.my-registrations", label: "My registrations", to: "screen.my-registrations" },
        { id: "nav.event-registrations", label: "Registrations", to: "screen.event-registrations" },
      ]}
      account="screen.account"
      signOut="screen.signed-out"
    >
      {children}
    </AppShell>
  );
}

function Banner() {
  const state = useDisplayState();
  return state === "state.failed" ? (
    <Alert id="alert.failed" tone="error" title="Events service unavailable" text="The list may be out of date. Try again in a few minutes." />
  ) : null;
}

/** Seat counting, registering, cancelling and waitlist promotion, as the registration service does it. */
function useSeating() {
  const evs = useCollection<Ev>("events");
  const sess = useCollection<Sess>("sessions");
  const regs = useCollection<Reg>("registrations");
  const me = "Dan Okafor";
  const capacityOf = (t: string, id: string) => (t === "event" ? evs.get(id)?.capacity : sess.get(id)?.capacity) ?? 0;
  const same = (r: Reg, t: string, id: string) => r.targetType === t && r.targetId === id;
  const confirmed = (t: string, id: string) => regs.items.filter((r) => same(r, t, id) && r.status === "confirmed").length;
  const waiting = (t: string, id: string) => regs.items.filter((r) => same(r, t, id) && r.status === "waitlisted");
  const position = (r: Reg) => waiting(r.targetType, r.targetId).findIndex((x) => x.id === r.id) + 1;
  const promote = (t: string, id: string, gone: string[], cap?: number) => {
    const keep = regs.items.filter((r) => same(r, t, id) && !gone.includes(r.id));
    const free = (cap ?? capacityOf(t, id)) - keep.filter((r) => r.status === "confirmed").length;
    keep.filter((r) => r.status === "waitlisted").slice(0, Math.max(free, 0)).forEach((r) => regs.update(r.id, { status: "confirmed" }));
  };
  const register = (t: string, id: string, eventId: string, name: string): string => {
    if (regs.items.some((r) => r.person === me && same(r, t, id))) return "You are already registered.";
    if (t === "session" && !regs.items.some((r) => r.person === me && same(r, "event", eventId) && r.status === "confirmed")) {
      return "Register for the event before its sessions.";
    }
    const seat = confirmed(t, id) < capacityOf(t, id) ? "confirmed" : "waitlisted";
    regs.create({ targetType: t, targetId: id, target: name, eventId, person: me, status: seat });
    return seat === "confirmed" ? `Confirmed for ${name}.` : `${name} is full. You are on the waitlist.`;
  };
  const cancel = (r: Reg) => {
    const cascade = r.targetType === "event" ? regs.items.filter((x) => x.person === r.person && x.eventId === r.eventId && x.targetType === "session") : [];
    const gone = [r.id, ...cascade.map((x) => x.id)];
    gone.forEach((id) => regs.remove(id));
    promote(r.targetType, r.targetId, gone);
    cascade.forEach((x) => promote("session", x.targetId, gone));
  };
  return { regs, me, capacityOf, confirmed, waiting, position, promote, register, cancel };
}

function Events() {
  const state = useDisplayState();
  const role = useRole();
  const all = useCollection<Ev>("events");
  const seat = useSeating();
  const [openOnly, setOpenOnly] = useState(false);
  const [msg, setMsg] = useState("");
  const list = state === "state.empty" ? [] : all.items.filter((e) => !openOnly || e.cfpOpen);
  return (
    <Shell>
      <Heading
        id="heading.events"
        text="Events"
        actions={role === "Organizer" ? <Button id="btn.new-event" label="New event" emphasis="primary" to="screen.event-form" /> : undefined}
      />
      <Banner />
      {msg !== "" && <Alert id="alert.msg" tone="info" text={msg} />}
      <Section id="section.events" title="All events" count={list.length} subtitle="Open an event to see its sessions by day.">
        <Filters id="filters.events">
          <Field id="field.open-only" label="Open for proposals only" type="switch" value={openOnly ? "on" : "off"} onChange={(v) => setOpenOnly(v === "on")} />
        </Filters>
        <Table
          id="table.events"
          columns={["Event", "Dates", "Venue", { label: "Seats taken", kind: "number" }, { label: "Call for proposals", kind: "status" }]}
          rows={list.map((e) => ({
            id: `event.${e.id}`,
            cells: [e.name, `${e.startDate} to ${e.endDate}`, e.venue, `${seat.confirmed("event", e.id)} of ${e.capacity}`],
            status: { text: e.cfpOpen ? "Open" : "Closed", tone: e.cfpOpen ? "success" : "default" },
            to: "screen.event-detail",
            params: { event: e.id },
            actions:
              role === "Organizer"
                ? [
                    { id: `event.${e.id}.edit`, label: "Edit", to: "screen.event-form", params: { event: e.id } },
                    {
                      id: `event.${e.id}.delete`,
                      label: "Delete",
                      emphasis: "danger" as const,
                      onPress: () =>
                        seat.regs.items.some((r) => r.eventId === e.id)
                          ? setMsg(`${e.name} has registrations. Cancel them before deleting the event.`)
                          : all.remove(e.id),
                    },
                  ]
                : undefined,
          }))}
          empty={<EmptyState id="empty.events" title="No events yet" text="Events created by organizers appear here." />}
        />
      </Section>
    </Shell>
  );
}

function EventForm() {
  const { event: id } = useParams();
  const state = useDisplayState();
  const nav = useNav();
  const all = useCollection<Ev>("events");
  const seat = useSeating();
  const existing = id ? all.get(id) : undefined;
  const [error, setError] = useState("");
  const submit = (v: Record<string, string>) => {
    const capacity = Number(v.capacity);
    const taken = existing ? seat.confirmed("event", existing.id) : 0;
    if (capacity < taken) {
      setError(`Capacity cannot drop below the ${taken} confirmed seats.`);
      return;
    }
    const rec = { name: v.name ?? "", startDate: v.start ?? "", endDate: v.end ?? "", venue: v.venue ?? "", timeZone: v.zone ?? "", capacity };
    if (existing) {
      all.update(existing.id, rec);
      seat.promote("event", existing.id, [], capacity);
    } else {
      all.create({ ...rec, cfpOpen: false });
    }
    nav.go("screen.events");
  };
  const invalid = state === "state.validation-error";
  return (
    <Shell>
      <Breadcrumbs id="crumbs.event-form" items={[{ id: "crumb.events", label: "Events", to: "screen.events" }, { id: "crumb.here", label: existing ? "Edit event" : "New event" }]} />
      <Heading id="heading.event-form" text={existing ? `Edit ${existing.name}` : "New event"} />
      {(invalid || error !== "") && (
        <ValidationSummary id="summary.event" issues={error !== "" ? [error] : ["Give the event a name", "Capacity must be a number"]} />
      )}
      <Form
        id="form.event"
        onSubmit={submit}
        actions={
          <Stack2>
            <Button id="btn.cancel-event" label="Cancel" to="screen.events" />
            <Button id="btn.save-event" label="Save event" emphasis="primary" submit />
          </Stack2>
        }
      >
        <Field id="field.name" name="name" label="Name" required defaultValue={existing?.name} error={invalid ? "Give the event a name" : undefined} />
        <Field id="field.start" name="start" label="Start date" type="date" required defaultValue={existing?.startDate ?? "2027-03-10"} />
        <Field id="field.end" name="end" label="End date" type="date" required defaultValue={existing?.endDate ?? "2027-03-12"} />
        <Field id="field.venue" name="venue" label="Venue" required defaultValue={existing?.venue} />
        <Field id="field.zone" name="zone" label="Time zone" defaultValue={existing?.timeZone ?? "Europe/Lisbon"} />
        <Field id="field.capacity" name="capacity" label="Event capacity (seats)" type="number" required defaultValue={String(existing?.capacity ?? 100)} error={invalid ? "Capacity must be a number" : undefined} />
      </Form>
    </Shell>
  );
}

function Stack2({ children }: { children: ReactNode }) {
  return <Section id="section.form-actions" title="">{children}</Section>;
}

function EventDetail() {
  const { event: id } = useParams();
  const state = useDisplayState();
  const role = useRole();
  const evs = useCollection<Ev>("events");
  const rms = useCollection<Room>("rooms");
  const sess = useCollection<Sess>("sessions");
  const props = useCollection<Prop>("proposals");
  const seat = useSeating();
  const ev = (id ? evs.get(id) : undefined) ?? evs.items[0]!;
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<Sess | "new" | null>(null);
  const [roomOpen, setRoomOpen] = useState(false);
  const [assigning, setAssigning] = useState<Sess | null>(null);
  const [formError, setFormError] = useState("");
  const evRooms = rms.items.filter((r) => r.eventId === ev.id);
  const evSessions = state === "state.empty" ? [] : sess.items.filter((s) => s.eventId === ev.id);
  const accepted = props.items.filter((p) => p.eventId === ev.id && p.status === "Accepted");
  const roomName = (rid: string) => rms.get(rid)?.name ?? "";
  const myEventReg = seat.regs.items.find((r) => r.person === seat.me && r.targetType === "event" && r.targetId === ev.id);
  const editingSession = editing && editing !== "new" ? editing : undefined;

  const saveSession = (v: Record<string, string>) => {
    const room = evRooms.find((r) => r.name === v.room);
    const cap = Number(v.capacity);
    if (!room) return setFormError("Pick a room.");
    if (cap > room.capacity) return setFormError(`Capacity cannot exceed the room's ${room.capacity} seats.`);
    const clash = sess.items.some((s) => s.roomId === room.id && s.day === v.day && s.id !== editingSession?.id && (v.start ?? "") < s.end && s.start < (v.end ?? ""));
    if (clash) return setFormError("That room is already booked at that time.");
    const rec = { eventId: ev.id, roomId: room.id, title: v.title ?? "", day: v.day ?? "", start: v.start ?? "", end: v.end ?? "", capacity: cap };
    if (editingSession) {
      sess.update(editingSession.id, rec);
      seat.promote("session", editingSession.id, [], cap);
    } else {
      sess.create({ ...rec, speaker: "" });
    }
    setFormError("");
    setEditing(null);
  };

  const headerActions =
    role === "Organizer" ? (
      <Section id="section.header-actions" title="">
        <Button id="btn.edit-event" label="Edit event" to="screen.event-form" params={{ event: ev.id }} />
        <Button id="btn.toggle-cfp" label={ev.cfpOpen ? "Close call for proposals" : "Open call for proposals"} onPress={() => evs.update(ev.id, { cfpOpen: !ev.cfpOpen })} />
      </Section>
    ) : role === "Attendee" ? (
      myEventReg ? (
        <Button id="btn.cancel-event-reg" label={myEventReg.status === "waitlisted" ? "Leave waitlist" : "Cancel registration"} emphasis="danger" onPress={() => seat.cancel(myEventReg)} />
      ) : (
        <Button id="btn.register-event" label="Register for event" emphasis="primary" onPress={() => setMsg(seat.register("event", ev.id, ev.id, ev.name))} />
      )
    ) : role === "Speaker" && ev.cfpOpen ? (
      <Button id="btn.submit-proposal" label="Submit a proposal" emphasis="primary" to="screen.submit-proposal" />
    ) : undefined;

  return (
    <Shell>
      <Breadcrumbs id="crumbs.event" items={[{ id: "crumb.events", label: "Events", to: "screen.events" }, { id: "crumb.here", label: ev.name }]} />
      <Heading id="heading.event" text={ev.name} actions={headerActions} />
      <Banner />
      {msg !== "" && <Alert id="alert.msg" tone="info" text={msg} />}
      <StatGroup>
        <Stat id="stat.seats" label="Seats taken" value={String(seat.confirmed("event", ev.id))} hint={`of ${ev.capacity}`} icon="Users" tone="success" />
        <Stat id="stat.waitlist" label="Waitlisted" value={String(seat.waiting("event", ev.id).length)} hint="promoted when a seat frees up" icon="Hourglass" tone="warning" />
        <Stat id="stat.sessions" label="Sessions" value={String(sess.items.filter((s) => s.eventId === ev.id).length)} hint={`${ev.venue}, ${ev.timeZone}`} icon="CalendarDays" />
      </StatGroup>
      <Section
        id="section.sessions"
        title="Sessions"
        count={evSessions.length}
        subtitle="By day, with room and time shown in the event's time zone."
        actions={role === "Organizer" ? <Button id="btn.add-session" label="Add session" emphasis="primary" onPress={() => { setFormError(""); setEditing("new"); }} /> : undefined}
      >
        <Table
          id="table.sessions"
          columns={["Day", "Time", "Session", "Room", "Speaker", { label: "Seats taken", kind: "number" }]}
          rows={evSessions.map((s) => {
            const mine = seat.regs.items.find((r) => r.person === seat.me && r.targetType === "session" && r.targetId === s.id);
            const wait = seat.waiting("session", s.id).length;
            return {
              id: `session.${s.id}`,
              cells: [s.day, `${s.start} to ${s.end}`, s.title, roomName(s.roomId), s.speaker || "To be announced", `${seat.confirmed("session", s.id)} of ${s.capacity}${wait > 0 ? ` (${wait} waiting)` : ""}`],
              actions:
                role === "Organizer"
                  ? [
                      { id: `session.${s.id}.edit`, label: "Edit or move", onPress: () => { setFormError(""); setEditing(s); } },
                      { id: `session.${s.id}.speaker`, label: "Assign speaker", onPress: () => setAssigning(s) },
                      {
                        id: `session.${s.id}.remove`,
                        label: "Remove",
                        emphasis: "danger" as const,
                        onPress: () => (seat.regs.items.some((r) => r.targetType === "session" && r.targetId === s.id) ? setMsg(`${s.title} has registrations. Cancel them first.`) : sess.remove(s.id)),
                      },
                    ]
                  : role === "Attendee"
                    ? [
                        mine
                          ? { id: `session.${s.id}.leave`, label: mine.status === "waitlisted" ? "Leave waitlist" : "Cancel", onPress: () => seat.cancel(mine) }
                          : { id: `session.${s.id}.register`, label: "Register", onPress: () => setMsg(seat.register("session", s.id, ev.id, s.title)) },
                      ]
                    : undefined,
            };
          })}
          empty={<EmptyState id="empty.sessions" title="No sessions scheduled" text="Organizers add sessions to rooms." />}
        />
      </Section>
      <Section
        id="section.rooms"
        title="Rooms"
        count={evRooms.length}
        actions={role === "Organizer" ? <Button id="btn.add-room" label="Add room" onPress={() => setRoomOpen(true)} /> : undefined}
      >
        <Table
          id="table.rooms"
          columns={["Room", { label: "Seating capacity", kind: "number" }]}
          rows={evRooms.map((r) => ({
            id: `room.${r.id}`,
            cells: [r.name, String(r.capacity)],
            actions:
              role === "Organizer"
                ? [{ id: `room.${r.id}.remove`, label: "Remove", emphasis: "danger" as const, onPress: () => (sess.items.some((s) => s.roomId === r.id) ? setMsg(`${r.name} hosts sessions. Move them first.`) : rms.remove(r.id)) }]
                : undefined,
          }))}
          empty={<EmptyState id="empty.rooms" title="No rooms" text="Add a room before scheduling sessions." />}
        />
      </Section>
      <Dialog id="dialog.session" title={editingSession ? "Edit or move session" : "Add session"} open={editing !== null} onClose={() => setEditing(null)}>
        {editing !== null && (
          <Form
            id="form.session"
            onSubmit={saveSession}
            actions={<Button id="btn.save-session" label="Save session" emphasis="primary" submit />}
          >
            {formError !== "" && <Alert id="alert.session-error" tone="error" text={formError} />}
            <Field id="field.session-title" name="title" label="Title" required defaultValue={editingSession?.title} error={state === "state.validation-error" ? "Give the session a title" : undefined} />
            <Field id="field.session-room" name="room" label="Room" type="select" options={evRooms.map((r) => r.name)} defaultValue={editingSession ? roomName(editingSession.roomId) : evRooms[0]?.name} />
            <Field id="field.session-day" name="day" label="Day" type="date" required defaultValue={editingSession?.day ?? ev.startDate} />
            <Field id="field.session-start" name="start" label="Starts" required placeholder="09:00" pattern="^[0-2][0-9]:[0-5][0-9]$" patternMessage="Use HH:MM" defaultValue={editingSession?.start} />
            <Field id="field.session-end" name="end" label="Ends" required placeholder="10:00" pattern="^[0-2][0-9]:[0-5][0-9]$" patternMessage="Use HH:MM" defaultValue={editingSession?.end} />
            <Field id="field.session-capacity" name="capacity" label="Capacity (at most the room's)" type="number" required defaultValue={String(editingSession?.capacity ?? 50)} />
          </Form>
        )}
      </Dialog>
      <Dialog id="dialog.room" title="Add room" open={roomOpen} onClose={() => setRoomOpen(false)}>
        <Form
          id="form.room"
          onSubmit={(v) => { rms.create({ eventId: ev.id, name: v.name ?? "", capacity: Number(v.capacity) }); setRoomOpen(false); }}
          actions={<Button id="btn.save-room" label="Add room" emphasis="primary" submit />}
        >
          <Field id="field.room-name" name="name" label="Room name" required />
          <Field id="field.room-capacity" name="capacity" label="Seating capacity" type="number" required />
        </Form>
      </Dialog>
      <Dialog id="dialog.speaker" title={assigning ? `Assign speaker to ${assigning.title}` : "Assign speaker"} open={assigning !== null} onClose={() => setAssigning(null)}>
        {assigning !== null && accepted.length === 0 && <Alert id="alert.no-accepted" tone="info" text="No accepted talks yet. Accept a proposal first." />}
        {assigning !== null && accepted.length > 0 && (
          <Form
            id="form.speaker"
            onSubmit={(v) => {
              const p = accepted.find((x) => `${x.title} (${x.speaker})` === v.talk);
              if (p) sess.update(assigning.id, { speaker: p.speaker });
              setAssigning(null);
            }}
            actions={<Button id="btn.save-speaker" label="Assign" emphasis="primary" submit />}
          >
            <Field id="field.talk" name="talk" label="Accepted talk" type="select" options={accepted.map((p) => `${p.title} (${p.speaker})`)} defaultValue={`${accepted[0]!.title} (${accepted[0]!.speaker})`} />
          </Form>
        )}
      </Dialog>
    </Shell>
  );
}

function MyProposals() {
  const state = useDisplayState();
  const props = useCollection<Prop>("proposals");
  const evs = useCollection<Ev>("events");
  const [editing, setEditing] = useState<Prop | null>(null);
  const mine = state === "state.empty" ? [] : props.items.filter((p) => p.speaker === "Sara Jensen");
  return (
    <Shell>
      <Heading id="heading.my-proposals" text="My proposals" actions={<Button id="btn.new-proposal" label="Submit a proposal" emphasis="primary" to="screen.submit-proposal" />} />
      <Banner />
      <Section id="section.my-proposals" title="Proposals" count={mine.length} subtitle="Decisions and organizer comments appear here.">
        <Table
          id="table.my-proposals"
          columns={["Title", "Event", "Format", { label: "Minutes", kind: "number" }, "Organizer comment", { label: "Status", kind: "status" }]}
          rows={mine.map((p) => ({
            id: `proposal.${p.id}`,
            cells: [p.title, evs.get(p.eventId)?.name ?? "", p.format, String(p.duration), p.comment || "No comment yet"],
            status: { text: p.status, tone: statusTone(p.status) },
            actions:
              p.status === "Submitted" && p.reviewCount === 0
                ? [
                    { id: `proposal.${p.id}.edit`, label: "Edit", onPress: () => setEditing(p) },
                    { id: `proposal.${p.id}.withdraw`, label: "Withdraw", emphasis: "danger" as const, onPress: () => props.remove(p.id) },
                  ]
                : undefined,
          }))}
          empty={<EmptyState id="empty.my-proposals" title="No proposals yet" text="Submit a talk to an event that is open for proposals." />}
        />
      </Section>
      <Dialog id="dialog.edit-proposal" title="Edit proposal" open={editing !== null} onClose={() => setEditing(null)}>
        {editing !== null && (
          <Form
            id="form.edit-proposal"
            onSubmit={(v) => { props.update(editing.id, { title: v.title ?? "", abstract: v.abstract ?? "", format: v.format ?? "Talk", duration: Number(v.duration) }); setEditing(null); }}
            actions={<Button id="btn.save-proposal" label="Save changes" emphasis="primary" submit />}
          >
            <Field id="field.edit-title" name="title" label="Title" required defaultValue={editing.title} />
            <Field id="field.edit-abstract" name="abstract" label="Abstract" type="textarea" required defaultValue={editing.abstract} />
            <Field id="field.edit-format" name="format" label="Format" type="select" options={["Talk", "Workshop", "Lightning talk"]} defaultValue={editing.format} />
            <Field id="field.edit-duration" name="duration" label="Duration (minutes)" type="number" required defaultValue={String(editing.duration)} />
          </Form>
        )}
      </Dialog>
    </Shell>
  );
}

function SubmitProposal() {
  const state = useDisplayState();
  const nav = useNav();
  const evs = useCollection<Ev>("events");
  const props = useCollection<Prop>("proposals");
  const open = evs.items.filter((e) => e.cfpOpen);
  const invalid = state === "state.validation-error";
  return (
    <Shell>
      <Breadcrumbs id="crumbs.submit" items={[{ id: "crumb.mine", label: "My proposals", to: "screen.my-proposals" }, { id: "crumb.here", label: "Submit a proposal" }]} />
      <Heading id="heading.submit" text="Submit a proposal" />
      {open.length === 0 && <Alert id="alert.closed" tone="warning" title="No call for proposals is open" text="Organizers open a call per event. Check back later." />}
      {invalid && <ValidationSummary id="summary.proposal" issues={["Give the talk a title", "Write a short abstract"]} />}
      {open.length > 0 && (
        <Form
          id="form.proposal"
          onSubmit={(v) => {
            const ev = open.find((e) => e.name === v.event) ?? open[0]!;
            props.create({ eventId: ev.id, title: v.title ?? "", abstract: v.abstract ?? "", format: v.format ?? "Talk", duration: Number(v.duration), speaker: "Sara Jensen", status: "Submitted", comment: "", avg: 0, reviewCount: 0, myScore: 0, myComment: "" });
            nav.go("screen.my-proposals");
          }}
          actions={<Button id="btn.send-proposal" label="Submit proposal" emphasis="primary" submit />}
        >
          <Field id="field.event" name="event" label="Event" type="select" options={open.map((e) => e.name)} defaultValue={open[0]!.name} />
          <Field id="field.title" name="title" label="Title" required error={invalid ? "Give the talk a title" : undefined} />
          <Field id="field.abstract" name="abstract" label="Abstract" type="textarea" required error={invalid ? "Write a short abstract" : undefined} />
          <Field id="field.format" name="format" label="Format" type="select" options={["Talk", "Workshop", "Lightning talk"]} defaultValue="Talk" />
          <Field id="field.duration" name="duration" label="Duration (minutes)" type="number" required defaultValue="30" />
        </Form>
      )}
    </Shell>
  );
}

function ReviewQueue() {
  const state = useDisplayState();
  const props = useCollection<Prop>("proposals");
  const evs = useCollection<Ev>("events");
  const asg = useCollection<Reviewer>("reviewers");
  const [unscored, setUnscored] = useState(true);
  const mineEvents = asg.items.filter((r) => r.name === "Rita Patel").map((r) => r.eventId);
  const list = state === "state.empty" ? [] : props.items.filter((p) => mineEvents.includes(p.eventId) && (p.status === "Submitted" || p.status === "Under review") && (!unscored || p.myScore === 0));
  return (
    <Shell>
      <Heading id="heading.queue" text="Review queue" />
      <Banner />
      <Section id="section.queue" title="Proposals to review" count={list.length} subtitle="Only events you are assigned to are shown.">
        <Filters id="filters.queue">
          <Field id="field.unscored" label="Not yet scored by me" type="switch" value={unscored ? "on" : "off"} onChange={(v) => setUnscored(v === "on")} />
        </Filters>
        <Table
          id="table.queue"
          columns={["Title", "Event", "Speaker", "My score", { label: "Status", kind: "status" }]}
          rows={list.map((p) => ({
            id: `proposal.${p.id}`,
            cells: [p.title, evs.get(p.eventId)?.name ?? "", p.speaker, p.myScore === 0 ? "Not scored" : `${p.myScore} of 5`],
            status: { text: p.status, tone: statusTone(p.status) },
            to: "screen.review-score",
            params: { proposal: p.id },
          }))}
          empty={<EmptyState id="empty.queue" title="Nothing to review" text="Proposals of your assigned events appear here." />}
        />
      </Section>
    </Shell>
  );
}

function ReviewScore() {
  const { proposal: id } = useParams();
  const state = useDisplayState();
  const nav = useNav();
  const props = useCollection<Prop>("proposals");
  const revs = useCollection<Review>("reviews");
  const p = (id ? props.get(id) : undefined) ?? props.items[0]!;
  const decided = p.status === "Accepted" || p.status === "Rejected";
  const invalid = state === "state.validation-error";
  const save = (v: Record<string, string>) => {
    const score = Number(v.score);
    if (score < 1 || score > 5) return;
    const count = p.myScore === 0 ? p.reviewCount + 1 : p.reviewCount;
    const total = p.avg * p.reviewCount - p.myScore + score;
    props.update(p.id, { myScore: score, myComment: v.comment ?? "", reviewCount: count, avg: Math.round((total / count) * 10) / 10, status: p.status === "Submitted" ? "Under review" : p.status });
    const mine = revs.items.find((r) => r.proposalId === p.id && r.reviewer === "Rita Patel");
    if (mine) revs.update(mine.id, { score, comment: v.comment ?? "" });
    else revs.create({ proposalId: p.id, reviewer: "Rita Patel", score, comment: v.comment ?? "" });
    nav.go("screen.review-queue");
  };
  return (
    <Shell>
      <Breadcrumbs id="crumbs.score" items={[{ id: "crumb.queue", label: "Review queue", to: "screen.review-queue" }, { id: "crumb.here", label: p.title }]} />
      <Heading id="heading.score" text={p.title} />
      <Detail id="detail.proposal" fields={[{ label: "Speaker", value: p.speaker }, { label: "Format", value: `${p.format}, ${p.duration} minutes` }, { label: "Abstract", value: p.abstract }, { label: "Status", value: p.status }]} />
      {decided ? (
        <Alert id="alert.locked" tone="info" title="Decision made" text="The organizer has decided on this proposal, so scores can no longer change." />
      ) : (
        <Form id="form.score" title="Your score" onSubmit={save} actions={<Button id="btn.save-score" label="Save score" emphasis="primary" submit />}>
          <Field id="field.score" name="score" label="Score (1 to 5)" type="select" options={["1", "2", "3", "4", "5"]} required defaultValue={p.myScore === 0 ? undefined : String(p.myScore)} error={invalid ? "Pick a score from 1 to 5" : undefined} />
          <Field id="field.comment" name="comment" label="Comment (optional)" type="textarea" defaultValue={p.myComment} />
        </Form>
      )}
    </Shell>
  );
}

function EventProposals() {
  const state = useDisplayState();
  const evs = useCollection<Ev>("events");
  const props = useCollection<Prop>("proposals");
  const revs = useCollection<Review>("reviews");
  const [eventName, setEventName] = useState(evs.items[0]!.name);
  const [status, setStatus] = useState("All");
  const [deciding, setDeciding] = useState<{ p: Prop; decision: string } | null>(null);
  const [viewing, setViewing] = useState<Prop | null>(null);
  const ev = evs.items.find((e) => e.name === eventName) ?? evs.items[0]!;
  const list = state === "state.empty" ? [] : props.items.filter((p) => p.eventId === ev.id && (status === "All" || p.status === status)).sort((a, b) => b.avg - a.avg);
  return (
    <Shell>
      <Heading id="heading.event-proposals" text="Event proposals" />
      <Banner />
      <Section id="section.event-proposals" title="Proposals, best average first" count={list.length} subtitle="Scores advise; only you accept or reject.">
        <Filters id="filters.event-proposals">
          <Field id="field.event" label="Event" type="select" options={evs.items.map((e) => e.name)} value={eventName} onChange={setEventName} />
          <Field id="field.status" label="Status" type="select" options={["All", "Submitted", "Under review", "Accepted", "Rejected"]} value={status} onChange={setStatus} />
        </Filters>
        <Table
          id="table.event-proposals"
          columns={["Title", "Speaker", { label: "Average", kind: "number" }, { label: "Reviews", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={list.map((p) => {
            const decided = p.status === "Accepted" || p.status === "Rejected";
            return {
              id: `proposal.${p.id}`,
              cells: [p.title, p.speaker, p.reviewCount === 0 ? "No scores" : String(p.avg), String(p.reviewCount)],
              status: { text: p.status, tone: statusTone(p.status) },
              actions: [
                { id: `proposal.${p.id}.scores`, label: "Scores", onPress: () => setViewing(p) },
                ...(decided
                  ? [{ id: `proposal.${p.id}.reopen`, label: "Reverse decision", onPress: () => props.update(p.id, { status: "Under review", comment: "" }) }]
                  : [
                      { id: `proposal.${p.id}.accept`, label: "Accept", onPress: () => setDeciding({ p, decision: "Accepted" }) },
                      { id: `proposal.${p.id}.reject`, label: "Reject", emphasis: "danger" as const, onPress: () => setDeciding({ p, decision: "Rejected" }) },
                    ]),
              ],
            };
          })}
          empty={<EmptyState id="empty.event-proposals" title="No proposals" text="Proposals submitted to this event appear here." />}
        />
      </Section>
      <Dialog id="dialog.decide" title={deciding ? `${deciding.decision === "Accepted" ? "Accept" : "Reject"} ${deciding.p.title}` : "Decide"} open={deciding !== null} onClose={() => setDeciding(null)}>
        {deciding !== null && (
          <Form
            id="form.decide"
            onSubmit={(v) => { props.update(deciding.p.id, { status: deciding.decision, comment: v.comment ?? "" }); setDeciding(null); }}
            actions={<Button id="btn.confirm-decision" label={deciding.decision === "Accepted" ? "Accept" : "Reject"} emphasis={deciding.decision === "Accepted" ? "primary" : "danger"} submit />}
          >
            <Field id="field.decision-comment" name="comment" label="Comment for the speaker (optional)" type="textarea" />
          </Form>
        )}
      </Dialog>
      <Drawer id="drawer.scores" title={viewing ? `Scores for ${viewing.title}` : "Scores"} open={viewing !== null} onClose={() => setViewing(null)}>
        <Table
          id="table.scores"
          columns={["Reviewer", { label: "Score", kind: "number" }, "Comment"]}
          rows={revs.items.filter((r) => r.proposalId === viewing?.id).map((r) => ({ id: `review.${r.id}`, cells: [r.reviewer, String(r.score), r.comment || "No comment"] }))}
          empty={<EmptyState id="empty.scores" title="No scores yet" text="Reviewers have not scored this proposal." />}
        />
      </Drawer>
    </Shell>
  );
}

function Reviewers() {
  const state = useDisplayState();
  const evs = useCollection<Ev>("events");
  const asg = useCollection<Reviewer>("reviewers");
  const [eventName, setEventName] = useState(evs.items[0]!.name);
  const ev = evs.items.find((e) => e.name === eventName) ?? evs.items[0]!;
  const list = state === "state.empty" ? [] : asg.items.filter((r) => r.eventId === ev.id);
  return (
    <Shell>
      <Heading id="heading.reviewers" text="Reviewers" />
      <Banner />
      <Section id="section.assign" title="Assign a reviewer" subtitle="Assign by username, even before the reviewer has signed in; the assignment binds to them on their first sign-in.">
        <Filters id="filters.reviewers">
          <Field id="field.event" label="Event" type="select" options={evs.items.map((e) => e.name)} value={eventName} onChange={setEventName} />
        </Filters>
        <Form
          id="form.assign"
          onSubmit={(v) => asg.create({ eventId: ev.id, name: v.username ?? "", bound: false })}
          actions={<Button id="btn.assign" label="Assign reviewer" emphasis="primary" submit />}
        >
          <Field id="field.username" name="username" label="Reviewer username" required error={state === "state.validation-error" ? "Enter the reviewer's username" : undefined} />
        </Form>
      </Section>
      <Section id="section.reviewers" title="Assigned reviewers" count={list.length}>
        <Table
          id="table.reviewers"
          columns={["Reviewer", { label: "Sign-in", kind: "status" }]}
          rows={list.map((r) => ({ id: `reviewer.${r.id}`, cells: [r.name], status: r.bound ? { text: "Signed in", tone: "success" as const } : { text: "Not signed in yet", tone: "default" as const }, actions: [{ id: `reviewer.${r.id}.remove`, label: "Unassign", emphasis: "danger" as const, onPress: () => asg.remove(r.id) }] }))}
          empty={<EmptyState id="empty.reviewers" title="No reviewers assigned" text="Assign a reviewer to start scoring." />}
        />
      </Section>
    </Shell>
  );
}

function MyRegistrations() {
  const state = useDisplayState();
  const seat = useSeating();
  const evs = useCollection<Ev>("events");
  const mine = state === "state.empty" ? [] : seat.regs.items.filter((r) => r.person === seat.me);
  return (
    <Shell>
      <Heading id="heading.my-registrations" text="My registrations" actions={<Button id="btn.browse" label="Browse events" to="screen.events" />} />
      <Banner />
      <Alert id="alert.promotion" tone="info" text="When a seat frees up, the next person on the waitlist is confirmed automatically. You will see it here the next time you look." />
      <Section id="section.my-registrations" title="Registrations" count={mine.length}>
        <Table
          id="table.my-registrations"
          columns={["Registered for", "Type", "Event", "Waitlist position", { label: "Status", kind: "status" }]}
          rows={mine.map((r) => ({
            id: `reg.${r.id}`,
            cells: [r.target, r.targetType === "event" ? "Event" : "Session", evs.get(r.eventId)?.name ?? "", r.status === "waitlisted" ? `#${seat.position(r)}` : "Not waiting"],
            status: { text: r.status === "confirmed" ? "Confirmed" : "Waitlisted", tone: statusTone(r.status) },
            actions: [{ id: `reg.${r.id}.cancel`, label: r.status === "waitlisted" ? "Leave waitlist" : "Cancel", emphasis: "danger" as const, onPress: () => seat.cancel(r) }],
          }))}
          empty={<EmptyState id="empty.my-registrations" title="No registrations" text="Register for an event, then for its sessions." actions={<Button id="btn.empty-browse" label="Browse events" emphasis="primary" to="screen.events" />} />}
        />
      </Section>
    </Shell>
  );
}

function EventRegistrations() {
  const state = useDisplayState();
  const evs = useCollection<Ev>("events");
  const seat = useSeating();
  const [eventName, setEventName] = useState(evs.items[0]!.name);
  const ev = evs.items.find((e) => e.name === eventName) ?? evs.items[0]!;
  const list = state === "state.empty" ? [] : seat.regs.items.filter((r) => r.eventId === ev.id);
  return (
    <Shell>
      <Heading id="heading.event-registrations" text="Registrations" actions={<Button id="btn.edit-capacity" label="Change capacity" to="screen.event-form" params={{ event: ev.id }} />} />
      <Banner />
      <Filters id="filters.registrations">
        <Field id="field.event" label="Event" type="select" options={evs.items.map((e) => e.name)} value={eventName} onChange={setEventName} />
      </Filters>
      <StatGroup>
        <Stat id="stat.taken" label="Seats taken" value={String(seat.confirmed("event", ev.id))} hint={`of ${ev.capacity} event seats`} icon="Users" tone="success" />
        <Stat id="stat.waiting" label="On the waitlist" value={String(seat.waiting("event", ev.id).length)} hint="for the event itself" icon="Hourglass" tone="warning" />
      </StatGroup>
      <Section id="section.registrations" title="Event and session registrations" count={list.length} subtitle="Removing a registration frees the seat and promotes the next person.">
        <Table
          id="table.registrations"
          columns={["Attendee", "Registered for", "Type", "Waitlist position", { label: "Status", kind: "status" }]}
          rows={list.map((r) => ({
            id: `reg.${r.id}`,
            cells: [r.person, r.target, r.targetType === "event" ? "Event" : "Session", r.status === "waitlisted" ? `#${seat.position(r)}` : "Not waiting"],
            status: { text: r.status === "confirmed" ? "Confirmed" : "Waitlisted", tone: statusTone(r.status) },
            actions: [{ id: `reg.${r.id}.remove`, label: "Remove", emphasis: "danger" as const, onPress: () => seat.cancel(r) }],
          }))}
          empty={<EmptyState id="empty.registrations" title="No registrations" text="Attendees who register appear here." />}
        />
      </Section>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const user = people[role] ?? people.Attendee!;
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail id="detail.account" fields={[{ label: "Name", value: user.name }, { label: "Email", value: user.email }, { label: "Role", value: role }]} />
    </Shell>
  );
}


function SignedOut() {
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to="screen.events" />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.events": Events,
    "screen.event-detail": EventDetail,
    "screen.event-form": EventForm,
    "screen.my-proposals": MyProposals,
    "screen.submit-proposal": SubmitProposal,
    "screen.review-queue": ReviewQueue,
    "screen.review-score": ReviewScore,
    "screen.event-proposals": EventProposals,
    "screen.reviewers": Reviewers,
    "screen.my-registrations": MyRegistrations,
    "screen.event-registrations": EventRegistrations,
    "screen.account": Account,
    "screen.signed-out": SignedOut,
  },
  data: { events, rooms, sessions, proposals, reviews, registrations, reviewers },
});
