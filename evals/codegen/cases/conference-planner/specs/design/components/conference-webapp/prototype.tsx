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
  Alert, AppShell, Breadcrumbs, Button, Detail, EmptyState, Field, Filters, Form, Heading, Screen, Section,
  Stat, StatGroup, Table, Text, ValidationSummary, defineApp, useCollection, useDisplayState, useNav, useParams, useRole,
} from "@wso2/prototype-kit";

interface EventRec { id: string; name: string; venue: string; startDate: string; endDate: string }
interface RoomRec { id: string; eventId: string; name: string; capacity: string }
interface SessionRec { id: string; eventId: string; title: string; room: string; time: string; capacity: number; seatsRemaining: number; waitlistCount: number }
interface ProposalRec { id: string; eventId: string; speaker: string; title: string; abstract: string; status: string; score: string; reviews: number }
interface RegistrationRec { id: string; eventId: string; sessionId: string; item: string; status: string; position: string }
interface AttendeeRec { id: string; sessionId: string; attendee: string; status: string; position: string }

const events: EventRec[] = [
  { id: "e1", name: "DevSummit 2026", venue: "Colombo", startDate: "2026-11-12", endDate: "2026-11-14" },
  { id: "e2", name: "CloudDays", venue: "Kandy", startDate: "2026-12-03", endDate: "2026-12-04" },
  { id: "e3", name: "DataConf", venue: "Galle", startDate: "2027-02-18", endDate: "2027-02-19" },
];
const rooms: RoomRec[] = [
  { id: "r1", eventId: "e1", name: "Hall A", capacity: "120" },
  { id: "r2", eventId: "e1", name: "Hall B", capacity: "80" },
  { id: "r3", eventId: "e2", name: "Main Auditorium", capacity: "200" },
];
const sessions: SessionRec[] = [
  { id: "s1", eventId: "e1", title: "Intro to APIs", room: "Hall A", time: "2026-11-12 10:00", capacity: 100, seatsRemaining: 3, waitlistCount: 0 },
  { id: "s2", eventId: "e1", title: "Scaling Queues", room: "Hall B", time: "2026-11-12 11:00", capacity: 60, seatsRemaining: 0, waitlistCount: 4 },
  { id: "s3", eventId: "e1", title: "Observability in Practice", room: "Hall A", time: "2026-11-13 09:30", capacity: 100, seatsRemaining: 42, waitlistCount: 0 },
  { id: "s4", eventId: "e2", title: "Edge Functions", room: "Main Auditorium", time: "2026-12-03 14:00", capacity: 150, seatsRemaining: 87, waitlistCount: 0 },
];
const proposals: ProposalRec[] = [
  { id: "p1", eventId: "e1", speaker: "Amara Perera", title: "Scaling Queues", abstract: "How we moved a job queue from thousands to millions of messages a day without losing ordering.", status: "Accepted", score: "4.2", reviews: 5 },
  { id: "p2", eventId: "e2", speaker: "Amara Perera", title: "Intro to APIs", abstract: "A practical tour of designing, versioning and securing REST APIs for small teams.", status: "Submitted", score: "-", reviews: 0 },
  { id: "p3", eventId: "e1", speaker: "Kasun Silva", title: "Resilient Event Pipelines", abstract: "Retries, idempotency and dead letters for event-driven systems.", status: "Submitted", score: "3.8", reviews: 4 },
  { id: "p4", eventId: "e1", speaker: "Nadia Rahman", title: "Designing Fair Waitlists", abstract: "Ordering, promotion and edge cases when a session is full.", status: "Submitted", score: "-", reviews: 0 },
];
const registrations: RegistrationRec[] = [
  { id: "g1", eventId: "e1", sessionId: "", item: "DevSummit 2026", status: "Confirmed", position: "-" },
  { id: "g2", eventId: "e1", sessionId: "s2", item: "Scaling Queues", status: "Waitlisted", position: "2" },
];
const attendees: AttendeeRec[] = [
  { id: "a1", sessionId: "s1", attendee: "Dan Fernando", status: "Confirmed", position: "-" },
  { id: "a2", sessionId: "s1", attendee: "Erin Silva", status: "Confirmed", position: "-" },
  { id: "a3", sessionId: "s2", attendee: "Frank Perera", status: "Confirmed", position: "-" },
  { id: "a4", sessionId: "s2", attendee: "Erin Silva", status: "Waitlisted", position: "1" },
  { id: "a5", sessionId: "s2", attendee: "Kamal Silva", status: "Waitlisted", position: "2" },
];

const users: Record<string, { name: string; email: string }> = {
  Organizer: { name: "Olivia Jayasuriya", email: "olivia@devsummit.example" },
  Speaker: { name: "Amara Perera", email: "amara@speakers.example" },
  Reviewer: { name: "Rita Gunawardena", email: "rita@reviewers.example" },
  Attendee: { name: "Dan Fernando", email: "dan@attendees.example" },
};
const SPEAKER = "Amara Perera";

function tone(status: string): "success" | "warning" | "error" | "info" | "default" {
  const s = status.toLowerCase();
  if (s === "accepted" || s === "confirmed") return "success";
  if (s === "submitted" || s === "waitlisted") return "warning";
  if (s === "rejected" || s === "cancelled") return "error";
  return "default";
}

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  return (
    <AppShell
      id="shell"
      user={users[role] ?? users.Attendee!}
      nav={[
        { id: "nav.home", label: "Home", to: "screen.home" },
        { id: "nav.events", label: "Events", to: "screen.events" },
        { id: "nav.my-registrations", label: "My registrations", to: "screen.my-registrations" },
        { id: "nav.my-proposals", label: "My proposals", to: "screen.my-proposals" },
        { id: "nav.submit-proposal", label: "Submit proposal", to: "screen.submit-proposal" },
        { id: "nav.review-queue", label: "Review queue", to: "screen.review-queue" },
        { id: "nav.manage-events", label: "Manage events", to: "screen.manage-events" },
        { id: "nav.organizer-proposals", label: "Proposals", to: "screen.organizer-proposals" },
      ]}
      account="screen.account"
      settings="screen.settings"
      signOut="screen.signed-out"
    >
      {children}
    </AppShell>
  );
}

function FailedAlert({ text }: { text: string }) {
  const state = useDisplayState();
  if (state === "state.failed") return <Alert id="alert.failed" tone="error" title="Request failed" text={text} />;
  if (state === "state.delayed") return <Alert id="alert.delayed" tone="info" title="Still working" text="The registration service is taking longer than usual. Your result will appear here shortly." />;
  return null;
}

function Home() {
  const role = useRole();
  const user = users[role] ?? users.Attendee!;
  return (
    <Shell>
      <Heading id="heading.home" text={`Welcome, ${user.name}`} />
      <Section id="section.start" title="Where to start" subtitle={`You are signed in as ${role}.`}>
        {role === "Attendee" && (
          <>
            <Button id="btn.home-events" label="Browse events" emphasis="primary" to="screen.events" />
            <Button id="btn.home-registrations" label="My registrations" to="screen.my-registrations" />
          </>
        )}
        {role === "Speaker" && (
          <>
            <Button id="btn.home-proposals" label="My proposals" emphasis="primary" to="screen.my-proposals" />
            <Button id="btn.home-submit" label="Submit a proposal" to="screen.submit-proposal" />
          </>
        )}
        {role === "Reviewer" && <Button id="btn.home-queue" label="Open review queue" emphasis="primary" to="screen.review-queue" />}
        {role === "Organizer" && (
          <>
            <Button id="btn.home-manage" label="Manage events" emphasis="primary" to="screen.manage-events" />
            <Button id="btn.home-proposals" label="Review proposals" to="screen.organizer-proposals" />
          </>
        )}
      </Section>
    </Shell>
  );
}

function Events() {
  const state = useDisplayState();
  const all = useCollection<EventRec>("events");
  const items = state === "state.empty" ? [] : all.items;
  return (
    <Shell>
      <Heading id="heading.events" text="Events" />
      <FailedAlert text="Events could not be loaded. Try again in a moment." />
      <Section id="section.events" title="Upcoming events" count={items.length} subtitle="Open an event to see its sessions and register.">
        <Table
          id="table.events"
          columns={["Event", "Venue", "Dates"]}
          rows={items.map((e) => ({ id: `event.${e.id}`, cells: [e.name, e.venue, `${e.startDate} to ${e.endDate}`], to: "screen.event-detail", params: { event: e.id } }))}
          empty={<EmptyState id="empty.events" title="No events yet" text="Published events appear here." />}
        />
      </Section>
    </Shell>
  );
}

function EventDetail() {
  const { event: id } = useParams();
  const state = useDisplayState();
  const evs = useCollection<EventRec>("events");
  const ses = useCollection<SessionRec>("sessions");
  const regs = useCollection<RegistrationRec>("registrations");
  const [notice, setNotice] = useState("");
  const ev = (id ? evs.get(id) : undefined) ?? evs.items[0]!;
  const mine = regs.items.find((r) => r.eventId === ev.id && r.sessionId === "" && r.status !== "Cancelled");
  const list = state === "state.empty" ? [] : ses.items.filter((s) => s.eventId === ev.id);
  const registerEvent = () => {
    if (!mine) regs.create({ eventId: ev.id, sessionId: "", item: ev.name, status: "Confirmed", position: "-" });
  };
  const registerSession = (s: SessionRec) => {
    if (!mine) {
      setNotice("Register for the event first (assumed rule: sessions need an event registration).");
      return;
    }
    if (regs.items.some((r) => r.sessionId === s.id && r.status !== "Cancelled")) {
      setNotice(`You already have a place in ${s.title}.`);
      return;
    }
    setNotice("");
    if (s.seatsRemaining > 0) {
      regs.create({ eventId: ev.id, sessionId: s.id, item: s.title, status: "Confirmed", position: "-" });
      ses.update(s.id, { seatsRemaining: s.seatsRemaining - 1 });
    } else {
      regs.create({ eventId: ev.id, sessionId: s.id, item: s.title, status: "Waitlisted", position: String(s.waitlistCount + 1) });
      ses.update(s.id, { waitlistCount: s.waitlistCount + 1 });
    }
  };
  return (
    <Shell>
      <Breadcrumbs id="crumbs.event" items={[{ id: "crumb.events", label: "Events", to: "screen.events" }, { id: "crumb.current", label: ev.name }]} />
      <Heading
        id="heading.event"
        text={ev.name}
        actions={
          mine
            ? <Button id="btn.registered" label="Registered" disabled />
            : <Button id="btn.register-event" label="Register for event" emphasis="primary" onPress={registerEvent} />
        }
      />
      <FailedAlert text="The registration could not be completed. Try again." />
      {notice !== "" && <Alert id="alert.notice" tone="warning" text={notice} />}
      <Detail id="detail.event" fields={[
        { label: "Venue", value: ev.venue },
        { label: "Dates", value: `${ev.startDate} to ${ev.endDate}` },
        { label: "Your registration", value: mine ? "Confirmed" : "Not registered" },
      ]} />
      <Section id="section.sessions" title="Sessions" count={list.length} subtitle="Full sessions put you on the waitlist in order of arrival.">
        <Table
          id="table.sessions"
          columns={["Session", "Room", "Time", { label: "Seats left", kind: "number" }, { label: "Waitlist", kind: "number" }]}
          rows={list.map((s) => ({
            id: `session.${s.id}`,
            cells: [s.title, s.room, s.time, String(s.seatsRemaining), String(s.waitlistCount)],
            actions: [{ id: `session.${s.id}.register`, label: s.seatsRemaining > 0 ? "Register for session" : "Join waitlist", onPress: () => registerSession(s) }],
          }))}
          empty={<EmptyState id="empty.sessions" title="No sessions yet" text="The organizer has not scheduled sessions." />}
        />
      </Section>
    </Shell>
  );
}

function MyRegistrations() {
  const state = useDisplayState();
  const regs = useCollection<RegistrationRec>("registrations");
  const ses = useCollection<SessionRec>("sessions");
  const items = state === "state.empty" ? [] : regs.items;
  const cancel = (r: RegistrationRec) => {
    regs.update(r.id, { status: "Cancelled", position: "-" });
    const s = r.sessionId ? ses.get(r.sessionId) : undefined;
    if (s && r.status === "Confirmed") {
      if (s.waitlistCount > 0) ses.update(s.id, { waitlistCount: s.waitlistCount - 1 });
      else ses.update(s.id, { seatsRemaining: s.seatsRemaining + 1 });
    }
  };
  return (
    <Shell>
      <Heading id="heading.registrations" text="My registrations" />
      <FailedAlert text="Your registrations could not be loaded." />
      <Section id="section.registrations" title="Registrations and waitlist" count={items.length} subtitle="When a seat frees, the first waitlisted person is promoted automatically.">
        <Table
          id="table.registrations"
          columns={["Item", { label: "Waitlist position", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={items.map((r) => ({
            id: `registration.${r.id}`,
            cells: [r.item, r.position],
            status: { text: r.status, tone: tone(r.status) },
            actions: r.status === "Cancelled" ? [] : [{ id: `registration.${r.id}.cancel`, label: "Cancel", emphasis: "danger" as const, onPress: () => cancel(r) }],
          }))}
          empty={<EmptyState id="empty.registrations" title="No registrations" text="Register for an event to see it here." actions={<Button id="btn.browse" label="Browse events" to="screen.events" />} />}
        />
      </Section>
    </Shell>
  );
}

function MyProposals() {
  const state = useDisplayState();
  const props = useCollection<ProposalRec>("proposals");
  const evs = useCollection<EventRec>("events");
  const items = state === "state.empty" ? [] : props.items.filter((p) => p.speaker === SPEAKER);
  return (
    <Shell>
      <Heading id="heading.proposals" text="My proposals" actions={<Button id="btn.new-proposal" label="New proposal" emphasis="primary" to="screen.submit-proposal" />} />
      <FailedAlert text="Your proposals could not be loaded." />
      <Section id="section.proposals" title="Submitted talks" count={items.length} subtitle="Status changes appear here; there are no notifications.">
        <Table
          id="table.proposals"
          columns={["Title", "Event", { label: "Status", kind: "status" }]}
          rows={items.map((p) => ({
            id: `proposal.${p.id}`,
            cells: [p.title, evs.get(p.eventId)?.name ?? ""],
            status: { text: p.status, tone: tone(p.status) },
          }))}
          empty={<EmptyState id="empty.proposals" title="No proposals yet" text="Submit a talk to an event." actions={<Button id="btn.empty-submit" label="Submit a proposal" to="screen.submit-proposal" />} />}
        />
      </Section>
    </Shell>
  );
}

function SubmitProposal() {
  const state = useDisplayState();
  const navigate = useNav();
  const props = useCollection<ProposalRec>("proposals");
  const evs = useCollection<EventRec>("events");
  const bad = state === "state.validation-error";
  return (
    <Shell>
      <Heading id="heading.submit" text="Submit a proposal" />
      <FailedAlert text="The proposal could not be submitted. Try again." />
      {bad && <ValidationSummary id="summary.proposal" issues={["Talk title is required", "Abstract is required"]} />}
      <Form
        id="form.proposal"
        onSubmit={(v) => {
          const ev = evs.items.find((e) => e.name === v.event) ?? evs.items[0]!;
          props.create({ eventId: ev.id, speaker: SPEAKER, title: v.title ?? "", abstract: v.abstract ?? "", status: "Submitted", score: "-", reviews: 0 });
          navigate.go("screen.my-proposals");
        }}
        actions={
          <>
            <Button id="btn.proposal-cancel" label="Cancel" to="screen.my-proposals" />
            <Button id="btn.proposal-submit" label="Submit" emphasis="primary" submit />
          </>
        }
      >
        <Field id="field.event" name="event" label="Event" type="select" options={evs.items.map((e) => e.name)} defaultValue={evs.items[0]!.name} required />
        <Field id="field.title" name="title" label="Talk title" required error={bad ? "Enter a title" : undefined} />
        <Field id="field.abstract" name="abstract" label="Abstract" type="textarea" required error={bad ? "Enter an abstract" : undefined} />
      </Form>
    </Shell>
  );
}

function ReviewQueue() {
  const state = useDisplayState();
  const props = useCollection<ProposalRec>("proposals");
  const evs = useCollection<EventRec>("events");
  const [eventName, setEventName] = useState("All events");
  const items = state === "state.empty" ? [] : props.items.filter((p) => eventName === "All events" || evs.get(p.eventId)?.name === eventName);
  return (
    <Shell>
      <Heading id="heading.queue" text="Review queue" />
      <FailedAlert text="Proposals could not be loaded." />
      <Section id="section.queue" title="Proposals to score" count={items.length} subtitle="All reviewers see all proposals of an event (assumed).">
        <Filters id="filters.queue">
          <Field id="field.filter-event" label="Event" type="select" options={["All events", ...evs.items.map((e) => e.name)]} value={eventName} onChange={setEventName} />
        </Filters>
        <Table
          id="table.queue"
          columns={["Title", "Speaker", { label: "Average score", kind: "number" }, { label: "Reviews", kind: "number" }]}
          rows={items.map((p) => ({ id: `proposal.${p.id}`, cells: [p.title, p.speaker, p.score, String(p.reviews)], to: "screen.review-proposal", params: { proposal: p.id } }))}
          empty={<EmptyState id="empty.queue" title="Nothing to review" text="Submitted proposals appear here." />}
        />
      </Section>
    </Shell>
  );
}

function ReviewProposal() {
  const { proposal: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const props = useCollection<ProposalRec>("proposals");
  const p = (id ? props.get(id) : undefined) ?? props.items[0]!;
  const bad = state === "state.validation-error";
  return (
    <Shell>
      <Breadcrumbs id="crumbs.review" items={[{ id: "crumb.queue", label: "Review queue", to: "screen.review-queue" }, { id: "crumb.current", label: p.title }]} />
      <Heading id="heading.review" text={p.title} />
      {state === "state.failed" && <Alert id="alert.scored" tone="error" title="Already scored" text="You have already scored this proposal. Each reviewer scores once." />}
      <Detail id="detail.proposal" fields={[
        { label: "Speaker", value: p.speaker },
        { label: "Abstract", value: p.abstract },
        { label: "Average score", value: p.score },
        { label: "Reviews", value: String(p.reviews) },
      ]} />
      {bad && <ValidationSummary id="summary.score" issues={["Score must be a whole number from 1 to 5"]} />}
      <Form
        id="form.score"
        title="Your score"
        onSubmit={(v) => {
          const value = Number(v.score ?? "3");
          const avg = p.score === "-" ? 0 : Number(p.score);
          const next = (avg * p.reviews + value) / (p.reviews + 1);
          props.update(p.id, { score: next.toFixed(1), reviews: p.reviews + 1 });
          navigate.go("screen.review-queue");
        }}
        actions={
          <>
            <Button id="btn.score-back" label="Back" to="screen.review-queue" />
            <Button id="btn.score-submit" label="Submit score" emphasis="primary" submit />
          </>
        }
      >
        <Field id="field.score" name="score" label="Score 1 to 5" type="select" options={["1", "2", "3", "4", "5"]} defaultValue="4" required error={bad ? "Pick a score from 1 to 5" : undefined} />
      </Form>
    </Shell>
  );
}

function ManageEvents() {
  const state = useDisplayState();
  const all = useCollection<EventRec>("events");
  const items = state === "state.empty" ? [] : all.items;
  return (
    <Shell>
      <Heading id="heading.manage" text="Events" />
      <FailedAlert text="Events could not be loaded." />
      <Section id="section.manage" title="All events" count={items.length} actions={<Button id="btn.new-event" label="New event" emphasis="primary" to="screen.event-form" />}>
        <Table
          id="table.manage"
          columns={["Event", "Venue", "Dates"]}
          rows={items.map((e) => ({ id: `event.${e.id}`, cells: [e.name, e.venue, `${e.startDate} to ${e.endDate}`], to: "screen.event-admin", params: { event: e.id } }))}
          empty={<EmptyState id="empty.manage" title="No events" text="Create your first event." actions={<Button id="btn.empty-new-event" label="New event" to="screen.event-form" />} />}
        />
      </Section>
    </Shell>
  );
}

function EventForm() {
  const { event: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<EventRec>("events");
  const existing = id ? all.get(id) : undefined;
  const bad = state === "state.validation-error";
  return (
    <Shell>
      <Heading id="heading.event-form" text={existing ? "Edit event" : "New event"} />
      <FailedAlert text="The event could not be saved." />
      {bad && <ValidationSummary id="summary.event" issues={["Name is required", "End date must not be before start date"]} />}
      <Form
        id="form.event"
        onSubmit={(v) => {
          const rec = { name: v.name ?? "", venue: v.venue ?? "", startDate: v.start ?? "", endDate: v.end ?? "" };
          if (existing) all.update(existing.id, rec);
          else all.create(rec);
          navigate.go("screen.manage-events");
        }}
        actions={
          <>
            <Button id="btn.event-cancel" label="Cancel" to="screen.manage-events" />
            <Button id="btn.event-save" label="Save" emphasis="primary" submit />
          </>
        }
      >
        <Field id="field.name" name="name" label="Name" required defaultValue={existing?.name ?? ""} error={bad ? "Enter a name" : undefined} />
        <Field id="field.venue" name="venue" label="Venue" defaultValue={existing?.venue ?? ""} />
        <Field id="field.start" name="start" label="Start date" type="date" required defaultValue={existing?.startDate ?? ""} error={bad ? "Pick a start date" : undefined} />
        <Field id="field.end" name="end" label="End date" type="date" required defaultValue={existing?.endDate ?? ""} />
      </Form>
    </Shell>
  );
}

function EventAdmin() {
  const { event: id } = useParams();
  const state = useDisplayState();
  const evs = useCollection<EventRec>("events");
  const rms = useCollection<RoomRec>("rooms");
  const ses = useCollection<SessionRec>("sessions");
  const ev = (id ? evs.get(id) : undefined) ?? evs.items[0]!;
  const roomList = state === "state.empty" ? [] : rms.items.filter((r) => r.eventId === ev.id);
  const sessionList = state === "state.empty" ? [] : ses.items.filter((s) => s.eventId === ev.id);
  return (
    <Shell>
      <Breadcrumbs id="crumbs.admin" items={[{ id: "crumb.events", label: "Events", to: "screen.manage-events" }, { id: "crumb.current", label: ev.name }]} />
      <Heading id="heading.admin" text={ev.name} actions={<Button id="btn.edit-event" label="Edit event" to="screen.event-form" params={{ event: ev.id }} />} />
      <FailedAlert text="The event could not be loaded." />
      <Section id="section.rooms" title="Rooms" count={roomList.length} actions={<Button id="btn.add-room" label="Add room" to="screen.room-form" params={{ event: ev.id }} />}>
        <Table
          id="table.rooms"
          columns={["Room", { label: "Capacity", kind: "number" }]}
          rows={roomList.map((r) => ({ id: `room.${r.id}`, cells: [r.name, r.capacity] }))}
          empty={<EmptyState id="empty.rooms" title="No rooms" text="Add a room so sessions have a venue." />}
        />
      </Section>
      <Section id="section.admin-sessions" title="Sessions" count={sessionList.length} subtitle="Open a session to see seats and waitlist." actions={<Button id="btn.add-session" label="Add session" emphasis="primary" to="screen.session-form" params={{ event: ev.id }} />}>
        <Table
          id="table.admin-sessions"
          columns={["Session", "Room", "Time", { label: "Capacity", kind: "number" }, { label: "Waitlist", kind: "number" }]}
          rows={sessionList.map((s) => ({ id: `session.${s.id}`, cells: [s.title, s.room, s.time, String(s.capacity), String(s.waitlistCount)], to: "screen.session-registrations", params: { session: s.id } }))}
          empty={<EmptyState id="empty.admin-sessions" title="No sessions" text="Create a session with a room, time and capacity." />}
        />
      </Section>
    </Shell>
  );
}

function RoomForm() {
  const { event: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const evs = useCollection<EventRec>("events");
  const rms = useCollection<RoomRec>("rooms");
  const ev = (id ? evs.get(id) : undefined) ?? evs.items[0]!;
  const bad = state === "state.validation-error";
  return (
    <Shell>
      <Heading id="heading.room" text={`Add room to ${ev.name}`} />
      <FailedAlert text="The room could not be saved." />
      {bad && <ValidationSummary id="summary.room" issues={["Room name is required", "Capacity must be a positive number"]} />}
      <Form
        id="form.room"
        onSubmit={(v) => {
          rms.create({ eventId: ev.id, name: v.name ?? "", capacity: v.capacity ?? "0" });
          navigate.go("screen.event-admin", { event: ev.id });
        }}
        actions={
          <>
            <Button id="btn.room-cancel" label="Cancel" to="screen.event-admin" params={{ event: ev.id }} />
            <Button id="btn.room-save" label="Save" emphasis="primary" submit />
          </>
        }
      >
        <Field id="field.room-name" name="name" label="Room name" required error={bad ? "Enter a room name" : undefined} />
        <Field id="field.room-capacity" name="capacity" label="Capacity" type="number" required error={bad ? "Enter a capacity" : undefined} />
      </Form>
    </Shell>
  );
}

function SessionForm() {
  const { event: eventParam, proposal: proposalParam } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const evs = useCollection<EventRec>("events");
  const rms = useCollection<RoomRec>("rooms");
  const ses = useCollection<SessionRec>("sessions");
  const props = useCollection<ProposalRec>("proposals");
  const proposal = proposalParam ? props.get(proposalParam) : undefined;
  const ev = (eventParam ? evs.get(eventParam) : undefined) ?? (proposal ? evs.get(proposal.eventId) : undefined) ?? evs.items[0]!;
  const roomOptions = rms.items.filter((r) => r.eventId === ev.id).map((r) => r.name);
  const bad = state === "state.validation-error";
  return (
    <Shell>
      <Heading id="heading.session" text={proposal ? `Schedule "${proposal.title}"` : `New session for ${ev.name}`} />
      {state === "state.failed" && <Alert id="alert.conflict" tone="error" title="Room is booked" text="Another session uses this room in that time slot. Pick a different room or time." />}
      {state === "state.delayed" && <Alert id="alert.capacity" tone="info" text="Setting the session's capacity with the registration service is taking longer than usual." />}
      {bad && <ValidationSummary id="summary.session" issues={["Title is required", "Choose a room", "Capacity must be a positive number"]} />}
      <Form
        id="form.session"
        onSubmit={(v) => {
          const cap = Number(v.capacity ?? "0");
          ses.create({ eventId: ev.id, title: v.title ?? "", room: v.room ?? "", time: v.start ?? "", capacity: cap, seatsRemaining: cap, waitlistCount: 0 });
          navigate.go("screen.event-admin", { event: ev.id });
        }}
        actions={
          <>
            <Button id="btn.session-cancel" label="Cancel" to="screen.event-admin" params={{ event: ev.id }} />
            <Button id="btn.session-save" label="Save" emphasis="primary" submit />
          </>
        }
      >
        <Field id="field.session-title" name="title" label="Title" required defaultValue={proposal?.title ?? ""} error={bad ? "Enter a title" : undefined} />
        <Field id="field.session-room" name="room" label="Room" type="select" options={roomOptions.length ? roomOptions : ["No rooms yet"]} defaultValue={roomOptions[0] ?? "No rooms yet"} required error={bad ? "Choose a room" : undefined} />
        <Field id="field.session-start" name="start" label="Start time" placeholder="2026-11-12 10:00" required />
        <Field id="field.session-end" name="end" label="End time" placeholder="2026-11-12 11:00" required />
        <Field id="field.session-capacity" name="capacity" label="Capacity" type="number" required error={bad ? "Enter a capacity" : undefined} />
      </Form>
    </Shell>
  );
}

function SessionRegistrations() {
  const { session: id } = useParams();
  const state = useDisplayState();
  const ses = useCollection<SessionRec>("sessions");
  const evs = useCollection<EventRec>("events");
  const att = useCollection<AttendeeRec>("attendees");
  const s = (id ? ses.get(id) : undefined) ?? ses.items[0]!;
  const ev = evs.get(s.eventId);
  const list = state === "state.empty" ? [] : att.items.filter((a) => a.sessionId === s.id);
  return (
    <Shell>
      <Breadcrumbs id="crumbs.session" items={[
        { id: "crumb.event", label: ev?.name ?? "Event", to: "screen.event-admin", params: { event: s.eventId } },
        { id: "crumb.current", label: s.title },
      ]} />
      <Heading id="heading.session-regs" text={s.title} />
      <FailedAlert text="Registrations could not be loaded." />
      <StatGroup>
        <Stat id="stat.seats" label="Seats left" value={String(s.seatsRemaining)} hint={`of ${s.capacity}`} icon="Ticket" tone={s.seatsRemaining === 0 ? "warning" : "success"} />
        <Stat id="stat.waitlist" label="Waitlist" value={String(s.waitlistCount)} hint="waiting" icon="Hourglass" />
      </StatGroup>
      <Section id="section.attendees" title="Attendees" count={list.length}>
        <Table
          id="table.attendees"
          columns={["Attendee", { label: "Waitlist position", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={list.map((a) => ({ id: `attendee.${a.id}`, cells: [a.attendee, a.position], status: { text: a.status, tone: tone(a.status) } }))}
          empty={<EmptyState id="empty.attendees" title="No registrations" text="Nobody has registered for this session yet." />}
        />
      </Section>
    </Shell>
  );
}

function OrganizerProposals() {
  const state = useDisplayState();
  const props = useCollection<ProposalRec>("proposals");
  const evs = useCollection<EventRec>("events");
  const [eventName, setEventName] = useState("All events");
  const items = state === "state.empty" ? [] : props.items.filter((p) => eventName === "All events" || evs.get(p.eventId)?.name === eventName);
  return (
    <Shell>
      <Heading id="heading.org-proposals" text="Proposals" />
      <FailedAlert text="Proposals could not be loaded." />
      <Section id="section.org-proposals" title="Scored proposals" count={items.length} subtitle="Open a proposal to accept or reject it.">
        <Filters id="filters.org-proposals">
          <Field id="field.filter-event" label="Event" type="select" options={["All events", ...evs.items.map((e) => e.name)]} value={eventName} onChange={setEventName} />
        </Filters>
        <Table
          id="table.org-proposals"
          columns={["Title", "Speaker", { label: "Average score", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={items.map((p) => ({ id: `proposal.${p.id}`, cells: [p.title, p.speaker, p.score], status: { text: p.status, tone: tone(p.status) }, to: "screen.proposal-decision", params: { proposal: p.id } }))}
          empty={<EmptyState id="empty.org-proposals" title="No proposals" text="Submitted proposals appear here." />}
        />
      </Section>
    </Shell>
  );
}

function ProposalDecision() {
  const { proposal: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const props = useCollection<ProposalRec>("proposals");
  const p = (id ? props.get(id) : undefined) ?? props.items[0]!;
  return (
    <Shell>
      <Breadcrumbs id="crumbs.decision" items={[{ id: "crumb.proposals", label: "Proposals", to: "screen.organizer-proposals" }, { id: "crumb.current", label: p.title }]} />
      <Heading
        id="heading.decision"
        text={p.title}
        actions={
          <>
            <Button id="btn.reject" label="Reject" emphasis="danger" onPress={() => { props.update(p.id, { status: "Rejected" }); navigate.go("screen.organizer-proposals"); }} />
            <Button id="btn.accept" label="Accept and schedule" emphasis="primary" disabled={p.status === "Rejected"} onPress={() => { props.update(p.id, { status: "Accepted" }); navigate.go("screen.session-form", { event: p.eventId, proposal: p.id }); }} />
          </>
        }
      />
      {state === "state.failed" && <Alert id="alert.decided" tone="error" title="Decision refused" text="This proposal was already decided. Reload to see its current status." />}
      <StatGroup>
        <Stat id="stat.score" label="Average score" value={p.score} hint={`from ${p.reviews} reviewers`} icon="Star" tone="warning" />
      </StatGroup>
      <Detail id="detail.decision" fields={[
        { label: "Speaker", value: p.speaker },
        { label: "Status", value: p.status },
      ]} />
      <Text id="text.abstract" text={p.abstract} />
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const user = users[role] ?? users.Attendee!;
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
    "screen.events": Events,
    "screen.event-detail": EventDetail,
    "screen.my-registrations": MyRegistrations,
    "screen.my-proposals": MyProposals,
    "screen.submit-proposal": SubmitProposal,
    "screen.review-queue": ReviewQueue,
    "screen.review-proposal": ReviewProposal,
    "screen.manage-events": ManageEvents,
    "screen.event-form": EventForm,
    "screen.event-admin": EventAdmin,
    "screen.room-form": RoomForm,
    "screen.session-form": SessionForm,
    "screen.session-registrations": SessionRegistrations,
    "screen.organizer-proposals": OrganizerProposals,
    "screen.proposal-decision": ProposalDecision,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { events, rooms, sessions, proposals, registrations, attendees },
});
