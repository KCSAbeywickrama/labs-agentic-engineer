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
  Alert, AppShell, Badge, Button, Detail, Dialog, EmptyState, Field, Form, Heading, Screen, Section, Stat,
  StatGroup, Table, defineApp, useCollection, useDisplayState, useNav, useParams, useRole,
} from "@wso2/prototype-kit";

interface EventRec { id: string; name: string; venue: string; startDate: string; endDate: string }

interface RoomRec { id: string; eventId: string; name: string; capacity: number }

interface SessionRec {
  id: string;
  eventId: string;
  roomId: string;
  title: string;
  speakerName: string;
  startTime: string;
  endTime: string;
  capacity: number;
  seatsRemaining: number;
  waitlistCount: number;
}

interface ProposalRec {
  id: string;
  eventId: string;
  speakerName: string;
  title: string;
  abstract: string;
  status: string;
  averageScore: number | null;
  scoreCount: number;
  sessionId: string | null;
}

interface RegistrationRec {
  id: string;
  userId: string;
  userName: string;
  eventId: string;
  sessionId: string | null;
  status: string;
  waitlistPosition: number | null;
}

const events: EventRec[] = [
  { id: "ev.1", name: "API Summit 2026", venue: "Colombo", startDate: "2026-11-12", endDate: "2026-11-14" },
  { id: "ev.2", name: "DevConf Asia", venue: "Kandy", startDate: "2026-03-05", endDate: "2026-03-06" },
];

const rooms: RoomRec[] = [
  { id: "room.1", eventId: "ev.1", name: "Hall A", capacity: 120 },
  { id: "room.2", eventId: "ev.1", name: "Hall B", capacity: 60 },
  { id: "room.3", eventId: "ev.2", name: "Auditorium", capacity: 200 },
];

const sessions: SessionRec[] = [
  {
    id: "session.1", eventId: "ev.1", roomId: "room.1", title: "Intro to APIs", speakerName: "Sam Fernando",
    startTime: "2026-11-12T10:00", endTime: "2026-11-12T11:00", capacity: 3, seatsRemaining: 1, waitlistCount: 0,
  },
  {
    id: "session.2", eventId: "ev.1", roomId: "room.2", title: "Scaling Queues", speakerName: "Sam Fernando",
    startTime: "2026-11-12T13:00", endTime: "2026-11-12T14:00", capacity: 50, seatsRemaining: 47, waitlistCount: 0,
  },
  {
    id: "session.3", eventId: "ev.1", roomId: "room.1", title: "Closing Keynote", speakerName: "Priya Jayasuriya",
    startTime: "2026-11-14T16:00", endTime: "2026-11-14T17:00", capacity: 1, seatsRemaining: 0, waitlistCount: 2,
  },
];

const proposals: ProposalRec[] = [
  {
    id: "proposal.1", eventId: "ev.1", speakerName: "Sam Fernando", title: "Scaling Queues",
    abstract: "How we moved a million messages a day without losing one.", status: "accepted",
    averageScore: 4, scoreCount: 1, sessionId: "session.2",
  },
  {
    id: "proposal.2", eventId: "ev.1", speakerName: "Sam Fernando", title: "Monitoring at Scale",
    abstract: "Dashboards that tell you something before the pager does.", status: "submitted",
    averageScore: null, scoreCount: 0, sessionId: null,
  },
  {
    id: "proposal.3", eventId: "ev.1", speakerName: "Sara Wickrama", title: "Building Resilient APIs",
    abstract: "Timeouts, retries and circuit breakers that actually help.", status: "submitted",
    averageScore: 3.5, scoreCount: 2, sessionId: null,
  },
  {
    id: "proposal.4", eventId: "ev.1", speakerName: "Sara Wickrama", title: "Legacy Migration Patterns",
    abstract: "Strangling a monolith without strangling the team.", status: "rejected",
    averageScore: 2, scoreCount: 2, sessionId: null,
  },
];

const registrations: RegistrationRec[] = [
  { id: "reg.1", userId: "dan", userName: "Dan Perera", eventId: "ev.1", sessionId: null, status: "confirmed", waitlistPosition: null },
  { id: "reg.2", userId: "dan", userName: "Dan Perera", eventId: "ev.1", sessionId: "session.1", status: "confirmed", waitlistPosition: null },
  { id: "reg.3", userId: "dan", userName: "Dan Perera", eventId: "ev.1", sessionId: "session.3", status: "confirmed", waitlistPosition: null },
  { id: "reg.4", userId: "erin", userName: "Erin Silva", eventId: "ev.1", sessionId: "session.3", status: "waitlisted", waitlistPosition: 1 },
  { id: "reg.5", userId: "frank", userName: "Frank Dias", eventId: "ev.1", sessionId: "session.3", status: "waitlisted", waitlistPosition: 2 },
];

const users: Record<string, { name: string; email: string }> = {
  Organizer: { name: "Olivia Jayawardena", email: "olivia@conf.example" },
  Speaker: { name: "Sam Fernando", email: "sam@conf.example" },
  Reviewer: { name: "Rita Gunasekara", email: "rita@conf.example" },
  Attendee: { name: "Dan Perera", email: "dan@conf.example" },
};

const navByRole: Record<string, { id: string; label: string; to: string }[]> = {
  Organizer: [
    { id: "nav.events", label: "Events", to: "screen.events" },
    { id: "nav.decisions", label: "Proposal decisions", to: "screen.decisions" },
  ],
  Speaker: [{ id: "nav.proposals", label: "My proposals", to: "screen.proposals" }],
  Reviewer: [{ id: "nav.review", label: "Review queue", to: "screen.review-queue" }],
  Attendee: [
    { id: "nav.events", label: "Events", to: "screen.events" },
    { id: "nav.registrations", label: "My registrations", to: "screen.my-registrations" },
  ],
};

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  return (
    <AppShell
      id="shell"
      user={users[role]}
      nav={navByRole[role] ?? []}
      account="screen.account"
      settings="screen.settings"
      signOut="screen.signed-out"
    >
      {children}
    </AppShell>
  );
}

function Events() {
  const state = useDisplayState();
  const role = useRole();
  const all = useCollection<EventRec>("events");
  const sessionsAll = useCollection<SessionRec>("sessions");
  const [creating, setCreating] = useState(false);
  const list = state === "state.empty" ? [] : all.items;
  const openSessions = sessionsAll.items.filter((s) => s.seatsRemaining > 0).length;

  return (
    <Shell>
      <Heading
        id="heading.events"
        text="Events"
        actions={
          role === "Organizer" ? (
            <Button id="btn.new-event" label="New event" emphasis="primary" onPress={() => setCreating(true)} />
          ) : undefined
        }
      />
      {state === "state.failed" && (
        <Alert id="alert.events-failed" tone="error" title="Events feed unavailable" text="Try again in a few minutes." />
      )}
      <StatGroup>
        <Stat id="stat.events" label="Events" value={String(all.items.length)} hint="listed" icon="Calendar" />
        <Stat id="stat.open-sessions" label="Open sessions" value={String(openSessions)} hint="still taking seats" icon="ListChecks" tone="success" />
      </StatGroup>
      <Section id="section.events" title="Events" count={list.length} subtitle="Browse upcoming conferences and their schedules.">
        <Table
          id="table.events"
          columns={["Name", "Venue", "Dates"]}
          rows={list.map((e) => ({
            id: `event.${e.id}`,
            cells: [e.name, e.venue, `${e.startDate} – ${e.endDate}`],
            to: "screen.event-detail",
            params: { event: e.id },
          }))}
          empty={<EmptyState id="empty.events" title="No events yet" text="Create the first event to get started." />}
        />
      </Section>
      <Dialog id="dialog.new-event" title="New event" open={creating} onClose={() => setCreating(false)}>
        <Form
          id="form.new-event"
          onSubmit={(values) => {
            all.create({ name: values.name, venue: values.venue, startDate: values.startDate, endDate: values.endDate });
            setCreating(false);
          }}
          actions={<Button id="btn.new-event.save" label="Create event" emphasis="primary" submit />}
        >
          <Field id="field.event-name" label="Name" required />
          <Field id="field.event-venue" label="Venue" required />
          <Field id="field.event-start" label="Start date" type="date" required />
          <Field
            id="field.event-end"
            label="End date"
            type="date"
            required
            error={state === "state.validation-error" ? "End date must be after the start date" : undefined}
          />
        </Form>
      </Dialog>
    </Shell>
  );
}

function EventDetail() {
  const { event: paramEventId } = useParams();
  const state = useDisplayState();
  const role = useRole();
  const eventsAll = useCollection<EventRec>("events");
  const roomsAll = useCollection<RoomRec>("rooms");
  const sessionsAll = useCollection<SessionRec>("sessions");
  const regsAll = useCollection<RegistrationRec>("registrations");
  const [addingRoom, setAddingRoom] = useState(false);
  const [addingSession, setAddingSession] = useState(false);

  const event = (paramEventId ? eventsAll.get(paramEventId) : undefined) ?? eventsAll.items[0]!;
  const eventRooms = roomsAll.items.filter((r) => r.eventId === event.id);
  const eventSessions = state === "state.empty" ? [] : sessionsAll.items.filter((s) => s.eventId === event.id);
  const myRegistration = regsAll.items.find(
    (r) => r.eventId === event.id && r.sessionId === null && r.userId === "dan" && r.status !== "cancelled",
  );

  return (
    <Shell>
      <Heading
        id="heading.event-detail"
        text={event.name}
        actions={
          role === "Attendee" && !myRegistration ? (
            <Button
              id="btn.register-event"
              label="Register for event"
              emphasis="primary"
              onPress={() =>
                regsAll.create({
                  userId: "dan",
                  userName: "Dan Perera",
                  eventId: event.id,
                  sessionId: null,
                  status: "confirmed",
                  waitlistPosition: null,
                })
              }
            />
          ) : undefined
        }
      />
      <Detail
        id="detail.event"
        fields={[
          { label: "Venue", value: event.venue },
          { label: "Dates", value: `${event.startDate} – ${event.endDate}` },
          ...(role === "Attendee"
            ? [{ label: "Your registration", value: myRegistration ? "Confirmed" : "Not registered" }]
            : []),
        ]}
      />
      {state === "state.failed" && (
        <Alert id="alert.schedule-failed" tone="error" title="Schedule unavailable" text="Rooms and sessions may be out of date." />
      )}
      <Section
        id="section.rooms"
        title="Rooms"
        count={eventRooms.length}
        subtitle="Venues available for this event's sessions."
        actions={
          role === "Organizer" ? <Button id="btn.new-room" label="Add room" onPress={() => setAddingRoom(true)} /> : undefined
        }
      >
        <Table
          id="table.rooms"
          columns={["Name", { label: "Capacity", kind: "number" }]}
          rows={eventRooms.map((r) => ({ id: `room.${r.id}`, cells: [r.name, String(r.capacity)] }))}
          empty={<EmptyState id="empty.rooms" title="No rooms yet" text="Add a room before scheduling sessions." />}
        />
      </Section>
      <Section
        id="section.sessions"
        title="Sessions"
        count={eventSessions.length}
        subtitle="The event schedule. Open a session to register or review its seats."
        actions={
          role === "Organizer" ? (
            <Button id="btn.new-session" label="New session" onPress={() => setAddingSession(true)} disabled={eventRooms.length === 0} />
          ) : undefined
        }
      >
        <Table
          id="table.sessions"
          columns={["Title", "Room", "Time", { label: "Seats remaining", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={eventSessions.map((s) => {
            const room = roomsAll.get(s.roomId);
            return {
              id: `session.${s.id}`,
              cells: [s.title, room?.name ?? "—", `${s.startTime.slice(11, 16)}–${s.endTime.slice(11, 16)}`, String(s.seatsRemaining)],
              status: { text: s.seatsRemaining > 0 ? "Open" : "Full", tone: s.seatsRemaining > 0 ? "success" : "warning" },
              to: "screen.session-detail",
              params: { session: s.id },
            };
          })}
          empty={<EmptyState id="empty.sessions" title="No sessions yet" text="Create a session once rooms are set up." />}
        />
      </Section>
      <Dialog id="dialog.new-room" title="Add room" open={addingRoom} onClose={() => setAddingRoom(false)}>
        <Form
          id="form.new-room"
          onSubmit={(values) => {
            roomsAll.create({ eventId: event.id, name: values.name, capacity: Number(values.capacity) });
            setAddingRoom(false);
          }}
          actions={<Button id="btn.new-room.save" label="Add room" emphasis="primary" submit />}
        >
          <Field id="field.room-name" label="Name" required />
          <Field
            id="field.room-capacity"
            label="Capacity"
            type="number"
            required
            error={state === "state.validation-error" ? "Capacity must be at least 1" : undefined}
          />
        </Form>
      </Dialog>
      <Dialog id="dialog.new-session" title="New session" open={addingSession} onClose={() => setAddingSession(false)}>
        <Form
          id="form.new-session"
          onSubmit={(values) => {
            const room = eventRooms.find((r) => r.name === values.room);
            const capacity = Number(values.capacity);
            sessionsAll.create({
              eventId: event.id,
              roomId: room?.id ?? eventRooms[0]?.id ?? "",
              title: values.title,
              speakerName: values.speaker,
              startTime: values.start,
              endTime: values.end,
              capacity,
              seatsRemaining: capacity,
              waitlistCount: 0,
            });
            setAddingSession(false);
          }}
          actions={<Button id="btn.new-session.save" label="Create session" emphasis="primary" submit />}
        >
          <Field id="field.session-room" label="Room" type="select" options={eventRooms.map((r) => r.name)} required />
          <Field id="field.session-title" label="Title" required />
          <Field id="field.session-speaker" label="Speaker" required />
          <Field id="field.session-start" label="Start time" placeholder="2026-11-12T10:00" required />
          <Field id="field.session-end" label="End time" placeholder="2026-11-12T11:00" required />
          <Field
            id="field.session-capacity"
            label="Capacity"
            type="number"
            required
            error={state === "state.validation-error" ? "Capacity must be at least 1" : undefined}
          />
        </Form>
      </Dialog>
    </Shell>
  );
}

function SessionDetail() {
  const { session: paramSessionId } = useParams();
  const state = useDisplayState();
  const role = useRole();
  const sessionsAll = useCollection<SessionRec>("sessions");
  const roomsAll = useCollection<RoomRec>("rooms");
  const regsAll = useCollection<RegistrationRec>("registrations");

  const session = (paramSessionId ? sessionsAll.get(paramSessionId) : undefined) ?? sessionsAll.items[0]!;
  const room = roomsAll.get(session.roomId);
  const sessionRegs = state === "state.empty"
    ? []
    : regsAll.items.filter((r) => r.sessionId === session.id && r.status !== "cancelled");
  const myReg = regsAll.items.find((r) => r.sessionId === session.id && r.userId === "dan" && r.status !== "cancelled");

  const registerForSession = () => {
    if (session.seatsRemaining > 0) {
      regsAll.create({
        userId: "dan", userName: "Dan Perera", eventId: session.eventId, sessionId: session.id,
        status: "confirmed", waitlistPosition: null,
      });
      sessionsAll.update(session.id, { seatsRemaining: session.seatsRemaining - 1 });
    } else {
      const position = sessionRegs.filter((r) => r.status === "waitlisted").length + 1;
      regsAll.create({
        userId: "dan", userName: "Dan Perera", eventId: session.eventId, sessionId: session.id,
        status: "waitlisted", waitlistPosition: position,
      });
      sessionsAll.update(session.id, { waitlistCount: session.waitlistCount + 1 });
    }
  };

  const cancelMyRegistration = () => {
    if (!myReg) return;
    regsAll.update(myReg.id, { status: "cancelled" });
    if (myReg.status === "confirmed") {
      sessionsAll.update(session.id, { seatsRemaining: session.seatsRemaining + 1 });
    } else {
      sessionsAll.update(session.id, { waitlistCount: Math.max(0, session.waitlistCount - 1) });
    }
  };

  return (
    <Shell>
      <Heading id="heading.session-detail" text={session.title} />
      <Detail
        id="detail.session"
        fields={[
          { label: "Room", value: room?.name ?? "—" },
          { label: "Time", value: `${session.startTime} – ${session.endTime}` },
          { label: "Speaker", value: session.speakerName },
          { label: "Capacity", value: String(session.capacity) },
          { label: "Seats remaining", value: String(session.seatsRemaining) },
          { label: "Waitlist", value: String(session.waitlistCount) },
        ]}
      />
      {state === "state.failed" && (
        <Alert id="alert.registration-failed" tone="error" title="Registration unavailable" text="Try again in a moment." />
      )}
      {role === "Attendee" && !myReg && (
        <Button
          id="btn.register-session"
          label={session.seatsRemaining > 0 ? "Register" : "Join waitlist"}
          emphasis="primary"
          onPress={registerForSession}
        />
      )}
      {role === "Attendee" && myReg && (
        <Section id="section.my-status" title="Your registration">
          <Badge
            id="badge.my-status"
            label={myReg.status === "confirmed" ? "Confirmed" : `Waitlisted #${myReg.waitlistPosition}`}
            tone={myReg.status === "confirmed" ? "success" : "warning"}
          />
          <Button id="btn.cancel-session" label="Cancel registration" emphasis="danger" onPress={cancelMyRegistration} />
        </Section>
      )}
      {role === "Organizer" && (
        <Section
          id="section.session-registrations"
          title="Registrations"
          count={sessionRegs.length}
          subtitle="Every confirmed seat and waitlist entry for this session."
        >
          <Table
            id="table.session-registrations"
            columns={["Attendee", { label: "Status", kind: "status" }]}
            rows={sessionRegs.map((r) => ({
              id: `reg.${r.id}`,
              cells: [r.userName],
              status: {
                text: r.status === "confirmed" ? "Confirmed" : `Waitlisted #${r.waitlistPosition}`,
                tone: r.status === "confirmed" ? "success" : "warning",
              },
            }))}
            empty={<EmptyState id="empty.session-registrations" title="No registrations yet" text="Nobody has registered for this session." />}
          />
        </Section>
      )}
    </Shell>
  );
}

function MyProposals() {
  const state = useDisplayState();
  const eventsAll = useCollection<EventRec>("events");
  const proposalsAll = useCollection<ProposalRec>("proposals");
  const [submitting, setSubmitting] = useState(false);
  const mine = state === "state.empty" ? [] : proposalsAll.items.filter((p) => p.speakerName === "Sam Fernando");

  return (
    <Shell>
      <Heading
        id="heading.proposals"
        text="My proposals"
        actions={<Button id="btn.submit-proposal" label="Submit proposal" emphasis="primary" onPress={() => setSubmitting(true)} />}
      />
      {state === "state.failed" && (
        <Alert id="alert.proposals-failed" tone="error" title="Could not load proposals" text="Refresh in a few minutes." />
      )}
      <Section id="section.proposals" title="Proposals" count={mine.length} subtitle="Your submitted talks and their outcome.">
        <Table
          id="table.proposals"
          columns={["Title", { label: "Score", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={mine.map((p) => ({
            id: `proposal.${p.id}`,
            cells: [p.title, p.averageScore !== null ? p.averageScore.toFixed(1) : "—"],
            status: {
              text: p.status === "submitted" ? "Submitted" : p.status === "accepted" ? "Accepted" : "Rejected",
              tone: p.status === "submitted" ? "info" : p.status === "accepted" ? "success" : "error",
            },
          }))}
          empty={<EmptyState id="empty.proposals" title="No proposals yet" text="Submit a talk to be considered for the program." />}
        />
      </Section>
      <Dialog id="dialog.submit-proposal" title="Submit a proposal" open={submitting} onClose={() => setSubmitting(false)}>
        <Form
          id="form.submit-proposal"
          onSubmit={(values) => {
            const event = eventsAll.items.find((e) => e.name === values.event) ?? eventsAll.items[0]!;
            proposalsAll.create({
              eventId: event.id,
              speakerName: "Sam Fernando",
              title: values.title,
              abstract: values.abstract,
              status: "submitted",
              averageScore: null,
              scoreCount: 0,
              sessionId: null,
            });
            setSubmitting(false);
          }}
          actions={<Button id="btn.submit-proposal.save" label="Submit" emphasis="primary" submit />}
        >
          <Field id="field.proposal-event" label="Event" type="select" options={eventsAll.items.map((e) => e.name)} required />
          <Field id="field.proposal-title" label="Title" required />
          <Field
            id="field.proposal-abstract"
            label="Abstract"
            type="textarea"
            required
            error={state === "state.validation-error" ? "Give the committee an abstract" : undefined}
          />
        </Form>
      </Dialog>
    </Shell>
  );
}

function ReviewQueue() {
  const state = useDisplayState();
  const proposalsAll = useCollection<ProposalRec>("proposals");
  const [scoringId, setScoringId] = useState<string | null>(null);
  const list = state === "state.empty" ? [] : proposalsAll.items.filter((p) => p.status === "submitted");
  const scoring = scoringId ? proposalsAll.get(scoringId) : undefined;

  return (
    <Shell>
      <Heading id="heading.review-queue" text="Review queue" />
      {state === "state.failed" && (
        <Alert id="alert.review-failed" tone="error" title="Could not load proposals" text="Try again shortly." />
      )}
      <Section
        id="section.review-queue"
        title="Proposals awaiting review"
        count={list.length}
        subtitle="Score each proposal once, from 1 to 5."
      >
        <Table
          id="table.review-queue"
          columns={["Title", "Speaker", { label: "Average", kind: "number" }, { label: "Reviews", kind: "number" }]}
          rows={list.map((p) => ({
            id: `proposal.${p.id}`,
            cells: [p.title, p.speakerName, p.averageScore !== null ? p.averageScore.toFixed(1) : "—", String(p.scoreCount)],
            actions: [{ id: `proposal.${p.id}.score`, label: "Score", onPress: () => setScoringId(p.id) }],
          }))}
          empty={<EmptyState id="empty.review-queue" title="Nothing to review" text="New proposals appear here as they are submitted." />}
        />
      </Section>
      <Dialog
        id="dialog.score"
        title={scoring ? `Score "${scoring.title}"` : "Score proposal"}
        open={Boolean(scoring)}
        onClose={() => setScoringId(null)}
      >
        <Form
          id="form.score"
          onSubmit={(values) => {
            if (!scoring) return;
            const value = Number(values.value);
            const totalPoints = (scoring.averageScore ?? 0) * scoring.scoreCount + value;
            const count = scoring.scoreCount + 1;
            proposalsAll.update(scoring.id, { averageScore: totalPoints / count, scoreCount: count });
            setScoringId(null);
          }}
          actions={<Button id="btn.score.save" label="Submit score" emphasis="primary" submit />}
        >
          <Field
            id="field.score-value"
            label="Score (1–5)"
            type="number"
            required
            pattern="^[1-5]$"
            patternMessage="Score must be between 1 and 5"
            error={state === "state.validation-error" ? "Enter a score between 1 and 5" : undefined}
          />
        </Form>
      </Dialog>
    </Shell>
  );
}

function Decisions() {
  const state = useDisplayState();
  const proposalsAll = useCollection<ProposalRec>("proposals");
  const roomsAll = useCollection<RoomRec>("rooms");
  const sessionsAll = useCollection<SessionRec>("sessions");
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const list = state === "state.empty" ? [] : proposalsAll.items;
  const scheduling = schedulingId ? proposalsAll.get(schedulingId) : undefined;
  const eventRooms = scheduling ? roomsAll.items.filter((r) => r.eventId === scheduling.eventId) : [];
  const awaiting = proposalsAll.items.filter((p) => p.status === "submitted").length;
  const accepted = proposalsAll.items.filter((p) => p.status === "accepted").length;

  return (
    <Shell>
      <Heading id="heading.decisions" text="Proposal decisions" />
      {state === "state.failed" && (
        <Alert id="alert.decisions-failed" tone="error" title="Could not load proposals" text="Scores may be stale." />
      )}
      <StatGroup>
        <Stat id="stat.awaiting" label="Awaiting decision" value={String(awaiting)} hint="scored or not" icon="ClipboardList" tone="warning" />
        <Stat id="stat.accepted" label="Accepted" value={String(accepted)} hint="into the program" icon="CircleCheck" tone="success" />
      </StatGroup>
      <Section
        id="section.decisions"
        title="Proposals"
        count={list.length}
        subtitle="Accept or reject scored proposals, then schedule the accepted ones."
      >
        <Table
          id="table.decisions"
          columns={["Title", "Speaker", { label: "Average", kind: "number" }, { label: "Status", kind: "status" }]}
          rows={list.map((p) => ({
            id: `proposal.${p.id}`,
            cells: [p.title, p.speakerName, p.averageScore !== null ? p.averageScore.toFixed(1) : "—"],
            status: {
              text: p.status === "submitted" ? "Submitted" : p.status === "accepted" ? "Accepted" : "Rejected",
              tone: p.status === "submitted" ? "info" : p.status === "accepted" ? "success" : "error",
            },
            actions:
              p.status === "submitted"
                ? [
                    { id: `proposal.${p.id}.accept`, label: "Accept", onPress: () => proposalsAll.update(p.id, { status: "accepted" }) },
                    {
                      id: `proposal.${p.id}.reject`,
                      label: "Reject",
                      emphasis: "danger" as const,
                      onPress: () => proposalsAll.update(p.id, { status: "rejected" }),
                    },
                  ]
                : p.status === "accepted" && !p.sessionId
                ? [{ id: `proposal.${p.id}.schedule`, label: "Schedule session", onPress: () => setSchedulingId(p.id) }]
                : [],
          }))}
          empty={<EmptyState id="empty.decisions" title="No proposals yet" text="Proposals appear here once speakers submit them." />}
        />
      </Section>
      <Dialog
        id="dialog.schedule"
        title={scheduling ? `Schedule "${scheduling.title}"` : "Schedule session"}
        open={Boolean(scheduling)}
        onClose={() => setSchedulingId(null)}
      >
        <Form
          id="form.schedule"
          onSubmit={(values) => {
            if (!scheduling) return;
            const room = eventRooms.find((r) => r.name === values.room);
            const capacity = Number(values.capacity);
            const sessionId = sessionsAll.create({
              eventId: scheduling.eventId,
              roomId: room?.id ?? eventRooms[0]?.id ?? "",
              title: scheduling.title,
              speakerName: scheduling.speakerName,
              startTime: values.start,
              endTime: values.end,
              capacity,
              seatsRemaining: capacity,
              waitlistCount: 0,
            });
            proposalsAll.update(scheduling.id, { sessionId });
            setSchedulingId(null);
          }}
          actions={<Button id="btn.schedule.save" label="Schedule" emphasis="primary" submit />}
        >
          <Field id="field.schedule-room" label="Room" type="select" options={eventRooms.map((r) => r.name)} required />
          <Field id="field.schedule-start" label="Start time" placeholder="2026-11-14T16:00" required />
          <Field id="field.schedule-end" label="End time" placeholder="2026-11-14T17:00" required />
          <Field
            id="field.schedule-capacity"
            label="Capacity"
            type="number"
            required
            error={state === "state.validation-error" ? "Capacity must be at least 1" : undefined}
          />
        </Form>
      </Dialog>
    </Shell>
  );
}

function MyRegistrations() {
  const state = useDisplayState();
  const regsAll = useCollection<RegistrationRec>("registrations");
  const sessionsAll = useCollection<SessionRec>("sessions");
  const eventsAll = useCollection<EventRec>("events");
  const mine = state === "state.empty" ? [] : regsAll.items.filter((r) => r.userId === "dan" && r.status !== "cancelled");

  const cancel = (reg: RegistrationRec) => {
    regsAll.update(reg.id, { status: "cancelled" });
    if (reg.sessionId) {
      const session = sessionsAll.get(reg.sessionId);
      if (session) {
        if (reg.status === "confirmed") {
          sessionsAll.update(session.id, { seatsRemaining: session.seatsRemaining + 1 });
        } else {
          sessionsAll.update(session.id, { waitlistCount: Math.max(0, session.waitlistCount - 1) });
        }
      }
    }
  };

  return (
    <Shell>
      <Heading id="heading.my-registrations" text="My registrations" />
      {state === "state.failed" && (
        <Alert id="alert.registrations-failed" tone="error" title="Could not load registrations" text="Try again shortly." />
      )}
      <Section
        id="section.my-registrations"
        title="Registrations"
        count={mine.length}
        subtitle="Events and sessions you are registered or waitlisted for."
      >
        <Table
          id="table.my-registrations"
          columns={["Event", "Session", { label: "Status", kind: "status" }]}
          rows={mine.map((r) => {
            const event = eventsAll.get(r.eventId);
            const session = r.sessionId ? sessionsAll.get(r.sessionId) : undefined;
            return {
              id: `reg.${r.id}`,
              cells: [event?.name ?? "—", session?.title ?? "Event only"],
              status: {
                text: r.status === "confirmed" ? "Confirmed" : `Waitlisted #${r.waitlistPosition}`,
                tone: r.status === "confirmed" ? "success" : "warning",
              },
              actions: [{ id: `reg.${r.id}.cancel`, label: "Cancel", emphasis: "danger" as const, onPress: () => cancel(r) }],
            };
          })}
          empty={<EmptyState id="empty.my-registrations" title="No registrations yet" text="Browse events to register for one." />}
        />
      </Section>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail
        id="detail.account"
        fields={[
          { label: "Name", value: users[role].name },
          { label: "Email", value: users[role].email },
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
        onSubmit={() => navigate.go("screen.account")}
        actions={<Button id="btn.save-settings" label="Save settings" emphasis="primary" submit />}
      >
        <Field id="field.notify" label="Notify me of schedule changes" type="switch" defaultValue="on" />
      </Form>
    </Shell>
  );
}

function SignedOut() {
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to="screen.account" />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.events": Events,
    "screen.event-detail": EventDetail,
    "screen.session-detail": SessionDetail,
    "screen.proposals": MyProposals,
    "screen.review-queue": ReviewQueue,
    "screen.decisions": Decisions,
    "screen.my-registrations": MyRegistrations,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { events, rooms, sessions, proposals, registrations },
});
