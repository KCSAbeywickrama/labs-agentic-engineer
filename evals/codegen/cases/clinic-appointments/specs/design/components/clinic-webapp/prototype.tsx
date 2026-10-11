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
  Section, Stat, StatGroup, Table, Tabs, Text, ValidationSummary, defineApp, useCollection, useDisplayState,
  useNav, useParams, useRole, useToday,
} from "@wso2/prototype-kit";

interface Appointment {
  id: string;
  doctorName: string;
  patientName: string;
  date: string;
  time: string;
  status: string;
  within2h: boolean;
  note: string;
}

interface Slot {
  id: string;
  doctorName: string;
  date: string;
  time: string;
  status: string;
}

const appointments: Appointment[] = [
  { id: "a1", doctorName: "Dr. Rivera", patientName: "Pat Alvarez", date: "2026-01-20", time: "09:30", status: "Booked", within2h: false, note: "" },
  { id: "a2", doctorName: "Dr. Chen", patientName: "Pat Alvarez", date: "2025-12-02", time: "14:00", status: "Checked in", within2h: false, note: "" },
  { id: "a3", doctorName: "Dr. Rivera", patientName: "Sam Okafor", date: "2026-01-15", time: "10:00", status: "Booked", within2h: true, note: "" },
  { id: "a4", doctorName: "Dr. Rivera", patientName: "Jane Doe", date: "2026-01-15", time: "09:30", status: "Checked in", within2h: true, note: "Sore throat, rest advised." },
  { id: "a5", doctorName: "Dr. Chen", patientName: "Pat Alvarez", date: "2026-01-15", time: "16:00", status: "Booked", within2h: false, note: "" },
];

const slots: Slot[] = [
  { id: "s1", doctorName: "Dr. Rivera", date: "2026-01-20", time: "09:30", status: "Booked" },
  { id: "s2", doctorName: "Dr. Rivera", date: "2026-01-20", time: "10:30", status: "Available" },
  { id: "s3", doctorName: "Dr. Rivera", date: "2026-01-21", time: "11:00", status: "Available" },
  { id: "s4", doctorName: "Dr. Chen", date: "2026-01-21", time: "14:00", status: "Available" },
  { id: "s5", doctorName: "Dr. Chen", date: "2026-01-22", time: "09:00", status: "Available" },
];

const users: Record<string, { name: string; email: string }> = {
  Patient: { name: "Pat Alvarez", email: "pat@example.test" },
  Doctor: { name: "Dr. Rivera", email: "rivera@clinic.example" },
  Receptionist: { name: "Rita Gomez", email: "rita@clinic.example" },
};

const homes: Record<string, string> = {
  Patient: "screen.my-appointments",
  Doctor: "screen.schedule",
  Receptionist: "screen.front-desk",
};

const doctors = ["All doctors", "Dr. Rivera", "Dr. Chen"];

function tone(status: string) {
  if (status === "Checked in" || status === "Available") return "success" as const;
  if (status === "Cancelled") return "error" as const;
  return "warning" as const;
}

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  return (
    <AppShell
      id="shell"
      user={users[role] ?? users.Patient!}
      nav={[
        { id: "nav.my-appointments", label: "My appointments", to: "screen.my-appointments" },
        { id: "nav.browse-slots", label: "Book a slot", to: "screen.browse-slots" },
        { id: "nav.schedule", label: "My day", to: "screen.schedule" },
        { id: "nav.my-slots", label: "My slots", to: "screen.my-slots" },
        { id: "nav.front-desk", label: "Front desk", to: "screen.front-desk" },
        { id: "nav.book-for-patient", label: "Book for patient", to: "screen.book-for-patient" },
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
  const state = useDisplayState();
  if (state === "state.failed") {
    return <Alert id="alert.failed" tone="error" title="Clinic service unavailable" text="We could not reach the clinic service. Try again in a few minutes." />;
  }
  return null;
}

function MyAppointments() {
  const state = useDisplayState();
  const today = useToday();
  const all = useCollection<Appointment>("appointments");
  const [notice, setNotice] = useState("");
  const mine = state === "state.empty" ? [] : all.items.filter((a) => a.patientName === "Pat Alvarez");
  const upcoming = mine.filter((a) => a.status !== "Cancelled" && a.date >= today);
  const past = mine.filter((a) => a.status === "Cancelled" || a.date < today);
  const refused = notice || (state === "state.conflict" ? "Appointments cannot be cancelled or rescheduled within 2 hours of the start." : "");
  const cancel = (a: Appointment) => {
    if (a.within2h) {
      setNotice("Appointments cannot be cancelled or rescheduled within 2 hours of the start.");
      return;
    }
    setNotice("");
    all.update(a.id, { status: "Cancelled" });
  };
  const rows = (list: Appointment[], withActions: boolean) =>
    list.map((a) => ({
      id: `appointment.${a.id}`,
      cells: [a.doctorName, a.date, a.time],
      status: { text: a.status, tone: tone(a.status) },
      ...(withActions
        ? {
            to: "screen.reschedule",
            params: { appointment: a.id },
            actions: [
              { id: `appointment.${a.id}.reschedule`, label: "Reschedule", to: "screen.reschedule", params: { appointment: a.id } },
              { id: `appointment.${a.id}.cancel`, label: "Cancel", emphasis: "danger" as const, onPress: () => cancel(a) },
            ],
          }
        : {}),
    }));
  const columns = ["Doctor", "Date", "Time", { label: "Status", kind: "status" as const }];
  return (
    <Shell>
      <Heading id="heading.my-appointments" text="My appointments" />
      <FailedAlert />
      {refused !== "" && <Alert id="alert.cutoff" tone="warning" title="Not allowed" text={refused} />}
      <StatGroup>
        <Stat id="stat.upcoming" label="Upcoming" value={String(upcoming.length)} hint="appointments booked" icon="CalendarCheck" tone="success" />
        <Stat id="stat.past" label="Past" value={String(past.length)} hint="visits and cancellations" icon="Clock" />
      </StatGroup>
      <Section
        id="section.appointments"
        title="Appointments"
        count={mine.length}
        subtitle="Open an appointment to reschedule it."
        actions={<Button id="btn.book-slot" label="Book a slot" emphasis="primary" to="screen.browse-slots" />}
      >
        <Tabs
          id="tabs.appointments"
          tabs={[
            {
              id: "tab.upcoming",
              label: "Upcoming",
              content: (
                <Table
                  id="table.upcoming"
                  columns={columns}
                  rows={rows(upcoming, true)}
                  empty={<EmptyState id="empty.upcoming" title="No upcoming appointments" text="Book a slot to see it here." />}
                />
              ),
            },
            {
              id: "tab.past",
              label: "Past",
              content: (
                <Table
                  id="table.past"
                  columns={columns}
                  rows={rows(past, false)}
                  empty={<EmptyState id="empty.past" title="No past appointments" text="Completed visits appear here." />}
                />
              ),
            },
          ]}
        />
      </Section>
    </Shell>
  );
}

function BrowseSlots() {
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<Slot>("slots");
  const appts = useCollection<Appointment>("appointments");
  const [doctor, setDoctor] = useState("All doctors");
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");
  const available = state === "state.empty" ? [] : all.items.filter((s) =>
    s.status === "Available" &&
    (doctor === "All doctors" || s.doctorName === doctor) &&
    (date === "" || s.date === date) &&
    (search === "" || s.doctorName.toLowerCase().includes(search.toLowerCase())));
  const book = (s: Slot) => {
    if (state === "state.conflict") return;
    all.update(s.id, { status: "Booked" });
    appts.create({ doctorName: s.doctorName, patientName: "Pat Alvarez", date: s.date, time: s.time, status: "Booked", within2h: false, note: "" });
    navigate.go("screen.my-appointments");
  };
  return (
    <Shell>
      <Breadcrumbs id="crumbs.browse" items={[{ id: "crumb.appointments", label: "My appointments", to: "screen.my-appointments" }, { id: "crumb.browse", label: "Available slots" }]} />
      <Heading id="heading.browse" text="Available slots" />
      <FailedAlert />
      {state === "state.conflict" && <Alert id="alert.taken" tone="error" title="Slot already taken" text="Someone booked that slot first. Pick another one." />}
      <Section id="section.slots" title="Slots" count={available.length} subtitle="Pick a doctor and date, then book a slot.">
        <Filters id="filters.slots">
          <Field id="field.doctor" label="Doctor" type="select" options={doctors} value={doctor} onChange={setDoctor} />
          <Field id="field.date" label="Date" type="date" value={date} onChange={setDate} />
          <Field id="field.search" label="Search" value={search} onChange={setSearch} placeholder="Doctor name" />
        </Filters>
        <Table
          id="table.slots"
          columns={["Doctor", "Date", "Time"]}
          rows={available.map((s) => ({
            id: `slot.${s.id}`,
            cells: [s.doctorName, s.date, s.time],
            actions: [{ id: `slot.${s.id}.book`, label: "Book", onPress: () => book(s) }],
          }))}
          empty={<EmptyState id="empty.slots" title="No slots available" text="Try another doctor or date." />}
        />
      </Section>
    </Shell>
  );
}

function Reschedule() {
  const { appointment: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const appts = useCollection<Appointment>("appointments");
  const all = useCollection<Slot>("slots");
  const current = (id ? appts.get(id) : undefined) ?? appts.items.find((a) => a.patientName === "Pat Alvarez")!;
  const options = state === "state.empty" ? [] : all.items.filter((s) => s.status === "Available" && s.doctorName === current.doctorName);
  const move = (s: Slot) => {
    if (state === "state.conflict" || current.within2h) return;
    const old = all.items.find((o) => o.doctorName === current.doctorName && o.date === current.date && o.time === current.time);
    if (old) all.update(old.id, { status: "Available" });
    all.update(s.id, { status: "Booked" });
    appts.update(current.id, { date: s.date, time: s.time });
    navigate.go("screen.my-appointments");
  };
  return (
    <Shell>
      <Breadcrumbs id="crumbs.reschedule" items={[{ id: "crumb.appointments", label: "My appointments", to: "screen.my-appointments" }, { id: "crumb.reschedule", label: "Reschedule" }]} />
      <Heading id="heading.reschedule" text="Reschedule appointment" />
      <FailedAlert />
      {(state === "state.conflict" || current.within2h) && (
        <Alert id="alert.cutoff" tone="warning" title="Cannot reschedule" text="This appointment starts within 2 hours, or the slot was just taken." />
      )}
      <Detail id="detail.current" title="Current appointment" fields={[
        { label: "Doctor", value: current.doctorName },
        { label: "Date", value: current.date },
        { label: "Time", value: current.time },
      ]} />
      <Section id="section.options" title="New slot" count={options.length} subtitle="Choose another available slot with the same doctor." actions={<Button id="btn.back" label="Back" to="screen.my-appointments" />}>
        <Table
          id="table.options"
          columns={["Doctor", "Date", "Time"]}
          rows={options.map((s) => ({
            id: `slot.${s.id}`,
            cells: [s.doctorName, s.date, s.time],
            actions: [{ id: `slot.${s.id}.confirm`, label: "Confirm new slot", onPress: () => move(s) }],
          }))}
          empty={<EmptyState id="empty.options" title="No other slots" text="This doctor has nothing else available." />}
        />
      </Section>
    </Shell>
  );
}

function Schedule() {
  const state = useDisplayState();
  const today = useToday();
  const all = useCollection<Appointment>("appointments");
  const [date, setDate] = useState(today);
  const day = state === "state.empty" ? [] : all.items.filter((a) => a.doctorName === "Dr. Rivera" && a.date === date);
  return (
    <Shell>
      <Heading id="heading.schedule" text="My day" />
      <FailedAlert />
      <StatGroup>
        <Stat id="stat.today" label="Appointments" value={String(day.length)} hint="on the chosen day" icon="CalendarDays" />
        <Stat id="stat.arrived" label="Checked in" value={String(day.filter((a) => a.status === "Checked in").length)} hint="patients waiting" icon="UserCheck" tone="success" />
      </StatGroup>
      <Section
        id="section.schedule"
        title="Appointments"
        count={day.length}
        subtitle="Open one to write the visit note."
        actions={<Button id="btn.publish" label="Publish slots" emphasis="primary" to="screen.publish-slots" />}
      >
        <Filters id="filters.day">
          <Field id="field.date" label="Date" type="date" value={date} onChange={setDate} />
        </Filters>
        <Table
          id="table.schedule"
          columns={["Time", "Patient", { label: "Status", kind: "status" }]}
          rows={day.map((a) => ({
            id: `appointment.${a.id}`,
            cells: [a.time, a.patientName],
            status: { text: a.status, tone: tone(a.status) },
            to: "screen.visit-note",
            params: { appointment: a.id },
          }))}
          empty={<EmptyState id="empty.schedule" title="No appointments" text="Nothing is booked for this day." />}
        />
      </Section>
    </Shell>
  );
}

function MySlots() {
  const state = useDisplayState();
  const all = useCollection<Slot>("slots");
  const [date, setDate] = useState("");
  const mine = state === "state.empty" ? [] : all.items.filter((s) => s.doctorName === "Dr. Rivera" && (date === "" || s.date === date));
  return (
    <Shell>
      <Heading id="heading.my-slots" text="My slots" />
      <FailedAlert />
      {state === "state.conflict" && <Alert id="alert.booked" tone="error" title="Slot is booked" text="A booked slot cannot be removed. Cancel the appointment first." />}
      <Section
        id="section.slots"
        title="Published slots"
        count={mine.length}
        subtitle="Only unbooked slots can be removed."
        actions={<Button id="btn.publish" label="Publish slots" emphasis="primary" to="screen.publish-slots" />}
      >
        <Filters id="filters.slots">
          <Field id="field.date" label="Date" type="date" value={date} onChange={setDate} />
        </Filters>
        <Table
          id="table.slots"
          columns={["Date", "Time", { label: "Status", kind: "status" }]}
          rows={mine.map((s) => ({
            id: `slot.${s.id}`,
            cells: [s.date, s.time],
            status: { text: s.status, tone: tone(s.status) },
            actions: s.status === "Available"
              ? [{ id: `slot.${s.id}.remove`, label: "Remove", emphasis: "danger" as const, onPress: () => all.remove(s.id) }]
              : [],
          }))}
          empty={<EmptyState id="empty.slots" title="No slots published" text="Publish your availability so patients can book." actions={<Button id="btn.publish-empty" label="Publish slots" to="screen.publish-slots" />} />}
        />
      </Section>
    </Shell>
  );
}

function PublishSlots() {
  const state = useDisplayState();
  const navigate = useNav();
  const today = useToday();
  const all = useCollection<Slot>("slots");
  const invalid = state === "state.validation-error";
  return (
    <Shell>
      <Breadcrumbs id="crumbs.publish" items={[{ id: "crumb.slots", label: "My slots", to: "screen.my-slots" }, { id: "crumb.publish", label: "Publish slots" }]} />
      <Heading id="heading.publish" text="Publish slots" />
      <FailedAlert />
      {invalid && <ValidationSummary id="summary.publish" issues={["Window end must be after window start", "Choose a slot length"]} />}
      <Form
        id="form.publish"
        title="Availability window"
        onSubmit={(v) => {
          all.create({ doctorName: "Dr. Rivera", date: today, time: v.start ?? "09:00", status: "Available" });
          navigate.go("screen.my-slots");
        }}
        actions={
          <>
            <Button id="btn.cancel" label="Cancel" to="screen.my-slots" />
            <Button id="btn.publish-submit" label="Publish" emphasis="primary" submit />
          </>
        }
      >
        <Field id="field.start" name="start" label="Window start" required defaultValue="09:00" placeholder="HH:MM" />
        <Field id="field.end" name="end" label="Window end" required defaultValue="12:00" placeholder="HH:MM" error={invalid ? "Must be after the start" : undefined} />
        <Field id="field.length" name="length" label="Slot length (minutes)" type="select" options={["15", "30", "45", "60"]} defaultValue="30" error={invalid ? "Choose a slot length" : undefined} />
      </Form>
    </Shell>
  );
}

function VisitNote() {
  const { appointment: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<Appointment>("appointments");
  const appt = (id ? all.get(id) : undefined) ?? all.items.find((a) => a.doctorName === "Dr. Rivera")!;
  return (
    <Shell>
      <Breadcrumbs id="crumbs.note" items={[{ id: "crumb.day", label: "My day", to: "screen.schedule" }, { id: "crumb.note", label: "Visit note" }]} />
      <Heading id="heading.note" text="Visit note" />
      <FailedAlert />
      <Detail id="detail.appointment" fields={[
        { label: "Patient", value: appt.patientName },
        { label: "Date", value: appt.date },
        { label: "Time", value: appt.time },
      ]} />
      <Badge id="badge.status" label={appt.status} tone={tone(appt.status)} />
      <Form
        id="form.note"
        title="Visit notes (visible to doctors only)"
        onSubmit={(v) => {
          all.update(appt.id, { note: v.note ?? "" });
          navigate.go("screen.schedule");
        }}
        actions={
          <>
            <Button id="btn.back" label="Back" to="screen.schedule" />
            <Button id="btn.save-note" label="Save note" emphasis="primary" submit />
          </>
        }
      >
        <Field
          id="field.note"
          name="note"
          label="Note"
          type="textarea"
          required
          defaultValue={appt.note}
          error={state === "state.validation-error" ? "Write a note before saving" : undefined}
        />
      </Form>
    </Shell>
  );
}

function FrontDesk() {
  const state = useDisplayState();
  const today = useToday();
  const all = useCollection<Appointment>("appointments");
  const [date, setDate] = useState(today);
  const [status, setStatus] = useState("Any status");
  const [notice, setNotice] = useState("");
  const list = state === "state.empty" ? [] : all.items.filter((a) => a.date === date && (status === "Any status" || a.status === status));
  const message = notice || (state === "state.conflict" ? "Check-in is only allowed on the day of the appointment; cancel is refused within 2 hours of the start." : "");
  const checkIn = (a: Appointment) => {
    if (a.date !== today || a.status === "Cancelled") {
      setNotice("Check-in is only allowed on the day of the appointment.");
      return;
    }
    setNotice("");
    all.update(a.id, { status: "Checked in" });
  };
  const cancel = (a: Appointment) => {
    if (a.within2h) {
      setNotice("Cannot cancel within 2 hours of the start.");
      return;
    }
    setNotice("");
    all.update(a.id, { status: "Cancelled" });
  };
  return (
    <Shell>
      <Heading id="heading.front-desk" text="Front desk" />
      <FailedAlert />
      {message !== "" && <Alert id="alert.refused" tone="warning" title="Not allowed" text={message} />}
      <StatGroup>
        <Stat id="stat.booked" label="Awaiting arrival" value={String(list.filter((a) => a.status === "Booked").length)} hint="to check in" icon="Hourglass" tone="warning" />
        <Stat id="stat.arrived" label="Checked in" value={String(list.filter((a) => a.status === "Checked in").length)} hint="on the chosen day" icon="UserCheck" tone="success" />
      </StatGroup>
      <Section
        id="section.appointments"
        title="Appointments"
        count={list.length}
        subtitle="Check patients in on arrival."
        actions={<Button id="btn.book" label="Book for patient" emphasis="primary" to="screen.book-for-patient" />}
      >
        <Filters id="filters.desk">
          <Field id="field.date" label="Date" type="date" value={date} onChange={setDate} />
          <Field id="field.status" label="Status" type="select" options={["Any status", "Booked", "Checked in", "Cancelled"]} value={status} onChange={setStatus} />
        </Filters>
        <Table
          id="table.desk"
          columns={["Time", "Patient", "Doctor", { label: "Status", kind: "status" }]}
          rows={list.map((a) => ({
            id: `appointment.${a.id}`,
            cells: [a.time, a.patientName, a.doctorName],
            status: { text: a.status, tone: tone(a.status) },
            actions: [
              { id: `appointment.${a.id}.check-in`, label: "Check in", onPress: () => checkIn(a) },
              { id: `appointment.${a.id}.cancel`, label: "Cancel appointment", emphasis: "danger" as const, onPress: () => cancel(a) },
            ],
          }))}
          empty={<EmptyState id="empty.desk" title="No appointments" text="Nothing matches this day and status." />}
        />
      </Section>
    </Shell>
  );
}

function BookForPatient() {
  const state = useDisplayState();
  const navigate = useNav();
  const all = useCollection<Slot>("slots");
  const appts = useCollection<Appointment>("appointments");
  const [doctor, setDoctor] = useState("All doctors");
  const [date, setDate] = useState("");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const available = state === "state.empty" ? [] : all.items.filter((s) =>
    s.status === "Available" && (doctor === "All doctors" || s.doctorName === doctor) && (date === "" || s.date === date));
  const [chosen, setChosen] = useState("");
  const label = (s: Slot) => `${s.doctorName}, ${s.date} ${s.time}`;
  const invalid = state === "state.validation-error";
  return (
    <Shell>
      <Breadcrumbs id="crumbs.book" items={[{ id: "crumb.desk", label: "Front desk", to: "screen.front-desk" }, { id: "crumb.book", label: "Book for patient" }]} />
      <Heading id="heading.book" text="Book for patient" />
      <FailedAlert />
      {state === "state.conflict" && <Alert id="alert.taken" tone="error" title="Slot already taken" text="That slot was booked by someone else. Choose another." />}
      {invalid && <ValidationSummary id="summary.book" issues={["Enter the patient's username", "Enter the patient's name", "Choose a slot"]} />}
      <Section id="section.slots" title="Available slots" count={available.length} subtitle="Filter, then choose a slot in the form below.">
        <Filters id="filters.book">
          <Field id="field.doctor" label="Doctor" type="select" options={doctors} value={doctor} onChange={setDoctor} />
          <Field id="field.date" label="Date" type="date" value={date} onChange={setDate} />
        </Filters>
        <Table
          id="table.slots"
          columns={["Doctor", "Date", "Time"]}
          rows={available.map((s) => ({
            id: `slot.${s.id}`,
            cells: [s.doctorName, s.date, s.time],
            actions: [{ id: `slot.${s.id}.choose`, label: "Choose", onPress: () => setChosen(label(s)) }],
          }))}
          empty={<EmptyState id="empty.slots" title="No slots available" text="Try another doctor or date." />}
        />
      </Section>
      <Form
        id="form.book"
        title="Patient"
        onSubmit={() => {
          const s = available.find((o) => label(o) === chosen);
          if (!s || state === "state.conflict") return;
          all.update(s.id, { status: "Booked" });
          appts.create({ doctorName: s.doctorName, patientName: name, date: s.date, time: s.time, status: "Booked", within2h: false, note: "" });
          navigate.go("screen.front-desk");
        }}
        actions={
          <>
            <Button id="btn.back" label="Back" to="screen.front-desk" />
            <Button id="btn.book-slot" label="Book slot" emphasis="primary" submit />
          </>
        }
      >
        <Field id="field.username" label="Patient username" required value={username} onChange={setUsername} error={invalid ? "Required" : undefined} />
        <Field id="field.name" label="Patient name" required value={name} onChange={setName} error={invalid ? "Required" : undefined} />
        <Field id="field.slot" label="Chosen slot" type="select" options={available.map(label)} value={chosen} onChange={setChosen} required error={invalid ? "Choose a slot" : undefined} />
      </Form>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const user = users[role] ?? users.Patient!;
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail id="detail.account" fields={[
        { label: "Name", value: user.name },
        { label: "Email", value: user.email },
        { label: "Role", value: role },
      ]} />
      <Button id="btn.home" label="Go to my work" emphasis="primary" to={homes[role] ?? "screen.account"} />
    </Shell>
  );
}

function Settings() {
  const navigate = useNav();
  const role = useRole();
  return (
    <Shell>
      <Heading id="heading.settings" text="Settings" />
      <Text id="text.assumed" text="Assumed: the clinic sends no notifications, so settings are display preferences only." />
      <Form
        id="form.settings"
        onSubmit={() => navigate.go("screen.account")}
        actions={<Button id="btn.save-settings" label="Save settings" emphasis="primary" submit />}
      >
        <Field id="field.compact" label="Compact tables" type="switch" defaultValue="off" />
        <Field id="field.role" label="Signed in as" value={role} />
      </Form>
    </Shell>
  );
}

function SignedOut() {
  const navigate = useNav();
  const role = useRole();
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Text id="text.signed-out" text="Sign in again through your organisation's single sign-on." />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" onPress={() => navigate.go(homes[role] ?? "screen.account")} />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.my-appointments": MyAppointments,
    "screen.browse-slots": BrowseSlots,
    "screen.reschedule": Reschedule,
    "screen.schedule": Schedule,
    "screen.my-slots": MySlots,
    "screen.publish-slots": PublishSlots,
    "screen.visit-note": VisitNote,
    "screen.front-desk": FrontDesk,
    "screen.book-for-patient": BookForPatient,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { appointments, slots },
});
