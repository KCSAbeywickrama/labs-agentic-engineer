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
  Alert, AppShell, Breadcrumbs, Button, Detail, Dialog, EmptyState, Field, Filters, Form, Heading, Screen,
  Section, Stat, StatGroup, Table, Text, Timeline, ValidationSummary, defineApp, useCollection,
  useDisplayState, useNav, useParams, useRole, useToday,
} from "@wso2/prototype-kit";

interface Slot { id: string; doctor: string; date: string; start: string; end: string; status: string }
interface Appt {
  id: string; slotId: string; doctor: string; patient: string; date: string; start: string; end: string;
  status: string; lateCancel: boolean;
}
interface Patient { id: string; name: string; phone: string }
interface Note { id: string; appointmentId: string; patient: string; author: string; date: string; text: string }

const slots: Slot[] = [
  { id: "s1", doctor: "Dr. Rao", date: "2026-01-15", start: "09:00", end: "09:30", status: "booked" },
  { id: "s2", doctor: "Dr. Rao", date: "2026-01-15", start: "10:00", end: "10:30", status: "booked" },
  { id: "s3", doctor: "Dr. Rao", date: "2026-01-15", start: "14:00", end: "14:30", status: "open" },
  { id: "s4", doctor: "Dr. Lee", date: "2026-01-15", start: "11:00", end: "11:30", status: "booked" },
  { id: "s5", doctor: "Dr. Lee", date: "2026-01-15", start: "15:30", end: "16:00", status: "booked" },
  { id: "s6", doctor: "Dr. Rao", date: "2026-01-16", start: "10:00", end: "10:30", status: "booked" },
  { id: "s7", doctor: "Dr. Rao", date: "2026-01-16", start: "11:00", end: "11:30", status: "open" },
  { id: "s8", doctor: "Dr. Rao", date: "2026-01-17", start: "09:00", end: "09:30", status: "open" },
  { id: "s9", doctor: "Dr. Lee", date: "2026-01-16", start: "09:30", end: "10:00", status: "open" },
  { id: "s10", doctor: "Dr. Lee", date: "2026-01-17", start: "13:00", end: "13:30", status: "open" },
  { id: "s11", doctor: "Dr. Rao", date: "2026-01-08", start: "09:00", end: "09:30", status: "booked" },
  { id: "s12", doctor: "Dr. Lee", date: "2025-12-18", start: "10:00", end: "10:30", status: "booked" },
];

const appointments: Appt[] = [
  { id: "a1", slotId: "s1", doctor: "Dr. Rao", patient: "Maya Fernando", date: "2026-01-15", start: "09:00", end: "09:30", status: "checked-in", lateCancel: true },
  { id: "a2", slotId: "s2", doctor: "Dr. Rao", patient: "Sam Perera", date: "2026-01-15", start: "10:00", end: "10:30", status: "booked", lateCancel: false },
  { id: "a3", slotId: "s4", doctor: "Dr. Lee", patient: "Ravi Perera", date: "2026-01-15", start: "11:00", end: "11:30", status: "booked", lateCancel: false },
  { id: "a4", slotId: "s5", doctor: "Dr. Lee", patient: "Pat Jones", date: "2026-01-15", start: "15:30", end: "16:00", status: "booked", lateCancel: true },
  { id: "a5", slotId: "s6", doctor: "Dr. Rao", patient: "Pat Jones", date: "2026-01-16", start: "10:00", end: "10:30", status: "booked", lateCancel: false },
  { id: "a6", slotId: "s11", doctor: "Dr. Rao", patient: "Pat Jones", date: "2026-01-08", start: "09:00", end: "09:30", status: "checked-in", lateCancel: true },
  { id: "a7", slotId: "s12", doctor: "Dr. Lee", patient: "Pat Jones", date: "2025-12-18", start: "10:00", end: "10:30", status: "checked-in", lateCancel: true },
];

const patients: Patient[] = [
  { id: "p1", name: "Pat Jones", phone: "555-0101" },
  { id: "p2", name: "Maya Fernando", phone: "555-0102" },
  { id: "p3", name: "Sam Perera", phone: "555-0103" },
  { id: "p4", name: "Ravi Perera", phone: "555-0104" },
];

const notes: Note[] = [
  { id: "n1", appointmentId: "a6", patient: "Pat Jones", author: "Dr. Rao", date: "2026-01-08", text: "Mild fever, rest advised." },
  { id: "n2", appointmentId: "a7", patient: "Pat Jones", author: "Dr. Lee", date: "2025-12-18", text: "Allergic to penicillin." },
  { id: "n3", appointmentId: "a1", patient: "Maya Fernando", author: "Dr. Rao", date: "2026-01-15", text: "Follow-up in two weeks." },
];

const DOCTOR = "Dr. Rao";
const PATIENT = "Pat Jones";
const DOCTORS = ["All doctors", "Dr. Rao", "Dr. Lee"];
const TIME_PATTERN = "^([01][0-9]|2[0-3]):[0-5][0-9]$";

const people: Record<string, { name: string; email: string }> = {
  Patient: { name: PATIENT, email: "pat.jones@example.com" },
  Doctor: { name: DOCTOR, email: "rao@clinic.example" },
  Receptionist: { name: "Rita Gomez", email: "rita.gomez@clinic.example" },
};

const toMin = (t: string) => {
  const parts = t.split(":");
  return Number(parts[0]) * 60 + Number(parts[1]);
};
const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const byTime = (a: { date: string; start: string }, b: { date: string; start: string }) =>
  (a.date + a.start).localeCompare(b.date + b.start);

const apptChip = (s: string) =>
  s === "checked-in"
    ? { text: "Checked in", tone: "success" as const }
    : s === "cancelled"
      ? { text: "Cancelled", tone: "default" as const }
      : { text: "Booked", tone: "info" as const };

const slotChip = (s: string) =>
  s === "open" ? { text: "Open", tone: "success" as const } : { text: "Booked", tone: "info" as const };

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  const user = people[role] ?? people["Patient"]!;
  return (
    <AppShell
      id="shell"
      user={user}
      nav={[
        { id: "nav.home", label: "Home", to: "screen.home" },
        { id: "nav.slots", label: "Open slots", to: "screen.slots" },
        { id: "nav.my-appointments", label: "My appointments", to: "screen.my-appointments" },
        { id: "nav.my-slots", label: "My availability", to: "screen.my-slots" },
        { id: "nav.my-day", label: "My day", to: "screen.my-day" },
        { id: "nav.front-desk", label: "Front desk", to: "screen.front-desk" },
        { id: "nav.patients", label: "Patients", to: "screen.patients" },
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
  if (state !== "state.failed") return null;
  return (
    <Alert
      id="alert.failed"
      tone="error"
      title="Clinic service unavailable"
      text="We could not load the latest data. Try again in a few minutes."
    />
  );
}

function useAppointmentActions() {
  const appts = useCollection<Appt>("appointments");
  const slotsC = useCollection<Slot>("slots");
  const [notice, setNotice] = useState<string | null>(null);
  const cancel = (a: Appt) => {
    if (a.lateCancel) {
      setNotice("This appointment starts in less than 2 hours and can no longer be cancelled.");
      return;
    }
    appts.update(a.id, { status: "cancelled" });
    slotsC.update(a.slotId, { status: "open" });
    setNotice(null);
  };
  return { appts, notice, setNotice, cancel };
}

function RescheduleDialog({ appt, onClose }: { appt: Appt | null; onClose: () => void }) {
  const slotsC = useCollection<Slot>("slots");
  const appts = useCollection<Appt>("appointments");
  const state = useDisplayState();
  const options = appt
    ? slotsC.items.filter((s) => s.doctor === appt.doctor && s.status === "open").map((s) => `${s.date} ${s.start}`)
    : [];
  return (
    <Dialog id="dialog.reschedule" title="Reschedule appointment" open={appt !== null} onClose={onClose}>
      {appt && appt.lateCancel && (
        <Alert
          id="alert.reschedule-late"
          tone="warning"
          text="This appointment starts in less than 2 hours and can no longer be rescheduled."
        />
      )}
      {appt && !appt.lateCancel && (
        <Form
          id="form.reschedule"
          onSubmit={(v) => {
            const target = slotsC.items.find(
              (s) => s.doctor === appt.doctor && s.status === "open" && `${s.date} ${s.start}` === v["slot"],
            );
            if (!target) return;
            slotsC.update(appt.slotId, { status: "open" });
            slotsC.update(target.id, { status: "booked" });
            appts.update(appt.id, { slotId: target.id, date: target.date, start: target.start, end: target.end });
            onClose();
          }}
          actions={<Button id="btn.reschedule.confirm" label="Reschedule" emphasis="primary" submit />}
        >
          <Field
            id="field.slot"
            name="slot"
            label={`New slot with ${appt.doctor}`}
            type="select"
            options={options.length > 0 ? options : ["No open slots"]}
            required
            error={state === "state.validation-error" ? "Choose an open slot" : undefined}
          />
        </Form>
      )}
    </Dialog>
  );
}

function Home() {
  const role = useRole();
  const today = useToday();
  const appts = useCollection<Appt>("appointments");
  const slotsC = useCollection<Slot>("slots");
  const mineUpcoming = appts.items.filter((a) => a.patient === PATIENT && a.status === "booked").length;
  const doctorToday = appts.items.filter((a) => a.doctor === DOCTOR && a.date === today && a.status !== "cancelled").length;
  const clinicToday = appts.items.filter((a) => a.date === today && a.status !== "cancelled").length;
  const openCount = slotsC.items.filter((s) => s.status === "open").length;
  return (
    <Shell>
      <Heading id="heading.home" text={`Welcome, ${(people[role] ?? people["Patient"]!).name}`} />
      {role === "Patient" && (
        <>
          <StatGroup>
            <Stat id="stat.upcoming" label="Upcoming" value={String(mineUpcoming)} hint="appointments booked" icon="CalendarCheck" />
            <Stat id="stat.open" label="Open slots" value={String(openCount)} hint="across all doctors" icon="CalendarClock" tone="success" />
          </StatGroup>
          <Button id="btn.home.book" label="Book an appointment" emphasis="primary" to="screen.slots" />
        </>
      )}
      {role === "Doctor" && (
        <>
          <StatGroup>
            <Stat id="stat.today" label="Today" value={String(doctorToday)} hint="appointments on your day" icon="CalendarDays" />
          </StatGroup>
          <Button id="btn.home.day" label="Open my day" emphasis="primary" to="screen.my-day" />
        </>
      )}
      {role === "Receptionist" && (
        <>
          <StatGroup>
            <Stat id="stat.clinic-today" label="Clinic today" value={String(clinicToday)} hint="appointments" icon="Users" />
          </StatGroup>
          <Button id="btn.home.desk" label="Open the front desk" emphasis="primary" to="screen.front-desk" />
        </>
      )}
    </Shell>
  );
}

function Slots() {
  const role = useRole();
  const state = useDisplayState();
  const navigate = useNav();
  const params = useParams();
  const slotsC = useCollection<Slot>("slots");
  const appts = useCollection<Appt>("appointments");
  const patientsC = useCollection<Patient>("patients");
  const [doctor, setDoctor] = useState("All doctors");
  const [date, setDate] = useState("");
  const [booking, setBooking] = useState<string | null>(null);
  const isPatient = role === "Patient";
  const open =
    state === "state.empty"
      ? []
      : slotsC.items
          .filter((s) => s.status === "open" && (doctor === "All doctors" || s.doctor === doctor) && (date === "" || s.date === date))
          .sort(byTime);
  const book = (slot: Slot, patient: string) => {
    if (state === "state.conflict") return;
    appts.create({
      slotId: slot.id, doctor: slot.doctor, patient, date: slot.date, start: slot.start, end: slot.end,
      status: "booked", lateCancel: false,
    });
    slotsC.update(slot.id, { status: "booked" });
    navigate.go(isPatient ? "screen.my-appointments" : "screen.front-desk");
  };
  const target = slotsC.get(booking ?? "");
  return (
    <Shell>
      <Heading id="heading.slots" text={isPatient ? "Book an appointment" : "Open slots"} />
      <FailedAlert />
      {state === "state.conflict" && (
        <Alert
          id="alert.slot-taken"
          tone="error"
          title="Slot just taken"
          text="Someone else booked that slot a moment ago. Pick another open slot."
        />
      )}
      <Section id="section.slots" title="Open slots" count={open.length} subtitle="Future slots that nobody has booked yet.">
        <Filters id="filters.slots">
          <Field id="field.filter-doctor" label="Doctor" type="select" options={DOCTORS} value={doctor} onChange={setDoctor} />
          <Field id="field.filter-date" label="Date" type="date" value={date} onChange={setDate} />
        </Filters>
        <Table
          id="table.slots"
          columns={["Doctor", "Date", "Start", "End", { label: "Status", kind: "status" }]}
          rows={open.map((s) => ({
            id: `slot.${s.id}`,
            cells: [s.doctor, s.date, s.start, s.end],
            status: slotChip(s.status),
            actions: [
              isPatient
                ? { id: `slot.${s.id}.book`, label: "Book", onPress: () => book(s, PATIENT) }
                : { id: `slot.${s.id}.book`, label: "Book for patient", onPress: () => setBooking(s.id) },
            ],
          }))}
          empty={<EmptyState id="empty.slots" title="No open slots" text="Try another doctor or date." />}
        />
      </Section>
      {!isPatient && (
        <Dialog id="dialog.book-for" title={target ? `Book ${target.doctor}, ${target.date} ${target.start}` : "Book"} open={booking !== null} onClose={() => setBooking(null)}>
          <Form
            id="form.book-for"
            onSubmit={(v) => {
              if (target) book(target, v["patient"] ?? "");
              setBooking(null);
            }}
            actions={<Button id="btn.book-for.confirm" label="Book appointment" emphasis="primary" submit />}
          >
            <Field
              id="field.patient"
              name="patient"
              label="Patient"
              type="select"
              options={patientsC.items.map((p) => p.name)}
              defaultValue={params["patient"]}
              required
              error={state === "state.validation-error" ? "Choose a patient" : undefined}
            />
          </Form>
        </Dialog>
      )}
    </Shell>
  );
}

function MyAppointments() {
  const state = useDisplayState();
  const { appts, notice, cancel } = useAppointmentActions();
  const [moving, setMoving] = useState<Appt | null>(null);
  const mine =
    state === "state.empty"
      ? []
      : appts.items.filter((a) => a.patient === PATIENT).sort((a, b) => byTime(b, a));
  return (
    <Shell>
      <Heading id="heading.my-appointments" text="My appointments" actions={<Button id="btn.book-new" label="Book an appointment" emphasis="primary" to="screen.slots" />} />
      <FailedAlert />
      {state === "state.conflict" && (
        <Alert id="alert.too-late" tone="error" title="Too late to change" text="Appointments cannot be cancelled or rescheduled within 2 hours of the start." />
      )}
      {notice && <Alert id="alert.notice" tone="warning" text={notice} />}
      <Section id="section.mine" title="Appointments" count={mine.length} subtitle="Upcoming and past, newest first.">
        <Table
          id="table.mine"
          columns={["Doctor", "Date", "Time", { label: "Status", kind: "status" }]}
          rows={mine.map((a) => ({
            id: `appt.${a.id}`,
            cells: [a.doctor, a.date, `${a.start}–${a.end}`],
            status: apptChip(a.status),
            actions:
              a.status === "booked"
                ? [
                    { id: `appt.${a.id}.reschedule`, label: "Reschedule", onPress: () => setMoving(a) },
                    { id: `appt.${a.id}.cancel`, label: "Cancel", emphasis: "danger" as const, onPress: () => cancel(a) },
                  ]
                : undefined,
          }))}
          empty={<EmptyState id="empty.mine" title="No appointments yet" text="Book your first appointment from the open slots." actions={<Button id="btn.empty-book" label="Browse open slots" to="screen.slots" />} />}
        />
      </Section>
      <RescheduleDialog appt={moving} onClose={() => setMoving(null)} />
    </Shell>
  );
}

function MySlots() {
  const state = useDisplayState();
  const today = useToday();
  const slotsC = useCollection<Slot>("slots");
  const [mode, setMode] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const mine =
    state === "state.empty"
      ? []
      : slotsC.items.filter((s) => s.doctor === DOCTOR && s.date >= today).sort(byTime);
  const clash = (date: string, start: number, end: number) =>
    slotsC.items.some((s) => s.doctor === DOCTOR && s.date === date && start < toMin(s.end) && end > toMin(s.start));
  const close = () => {
    setMode(null);
    setProblem(undefined);
  };
  const issues = state === "state.validation-error" ? ["Date is required", "End time must be after the start time"] : [];
  return (
    <Shell>
      <Heading id="heading.my-slots" text="My availability" />
      <FailedAlert />
      <Section
        id="section.my-slots"
        title="Published slots"
        count={mine.length}
        subtitle="Open slots can be removed; a booked slot stays until its appointment is cancelled."
        actions={
          <>
            <Button id="btn.publish-several" label="Publish several" onPress={() => setMode("batch")} />
            <Button id="btn.publish-one" label="Publish slot" emphasis="primary" onPress={() => setMode("single")} />
          </>
        }
      >
        <Table
          id="table.my-slots"
          columns={["Date", "Start", "End", { label: "Status", kind: "status" }]}
          rows={mine.map((s) => ({
            id: `slot.${s.id}`,
            cells: [s.date, s.start, s.end],
            status: slotChip(s.status),
            actions:
              s.status === "open"
                ? [{ id: `slot.${s.id}.remove`, label: "Remove", emphasis: "danger" as const, onPress: () => slotsC.remove(s.id) }]
                : undefined,
          }))}
          empty={<EmptyState id="empty.my-slots" title="No slots published" text="Publish the times you are available." />}
        />
      </Section>
      <Dialog id="dialog.publish-one" title="Publish a slot" open={mode === "single"} onClose={close}>
        <Form
          id="form.publish-one"
          onSubmit={(v) => {
            const date = v["date"] ?? "";
            const start = v["start"] ?? "";
            const end = v["end"] ?? "";
            if (date < today) return setProblem("Slots can only be published in the future");
            if (toMin(end) <= toMin(start)) return setProblem("End time must be after the start time");
            if (clash(date, toMin(start), toMin(end))) return setProblem("This overlaps one of your slots");
            slotsC.create({ doctor: DOCTOR, date, start, end, status: "open" });
            close();
          }}
          actions={<Button id="btn.publish-one.confirm" label="Publish" emphasis="primary" submit />}
        >
          {issues.length > 0 && <ValidationSummary id="summary.publish-one" issues={issues} />}
          <Field id="field.date" name="date" label="Date" type="date" required error={problem} />
          <Field id="field.start" name="start" label="Start time" required pattern={TIME_PATTERN} patternMessage="Use HH:MM" placeholder="09:00" />
          <Field id="field.end" name="end" label="End time" required pattern={TIME_PATTERN} patternMessage="Use HH:MM" placeholder="09:30" />
        </Form>
      </Dialog>
      <Dialog id="dialog.publish-several" title="Publish several slots" open={mode === "batch"} onClose={close}>
        <Form
          id="form.publish-several"
          onSubmit={(v) => {
            const date = v["date"] ?? "";
            const first = toMin(v["start"] ?? "09:00");
            const length = Number(v["length"] ?? "30");
            const count = Number(v["count"] ?? "1");
            if (date < today) return setProblem("Slots can only be published in the future");
            for (let i = 0; i < count; i++) {
              if (clash(date, first + i * length, first + (i + 1) * length)) return setProblem("One of these overlaps an existing slot");
            }
            for (let i = 0; i < count; i++) {
              slotsC.create({ doctor: DOCTOR, date, start: fromMin(first + i * length), end: fromMin(first + (i + 1) * length), status: "open" });
            }
            close();
          }}
          actions={<Button id="btn.publish-several.confirm" label="Publish slots" emphasis="primary" submit />}
        >
          <Field id="field.batch-date" name="date" label="Date" type="date" required error={problem} />
          <Field id="field.batch-start" name="start" label="First start time" required pattern={TIME_PATTERN} patternMessage="Use HH:MM" placeholder="09:00" />
          <Field id="field.batch-length" name="length" label="Minutes per slot" type="number" required defaultValue="30" />
          <Field id="field.batch-count" name="count" label="Number of slots" type="number" required defaultValue="4" />
        </Form>
      </Dialog>
    </Shell>
  );
}

function MyDay() {
  const state = useDisplayState();
  const today = useToday();
  const appts = useCollection<Appt>("appointments");
  const [date, setDate] = useState(today);
  const rows =
    state === "state.empty"
      ? []
      : appts.items.filter((a) => a.doctor === DOCTOR && a.date === date && a.status !== "cancelled").sort(byTime);
  const arrived = rows.filter((a) => a.status === "checked-in").length;
  return (
    <Shell>
      <Heading id="heading.my-day" text="My day" />
      <FailedAlert />
      <StatGroup>
        <Stat id="stat.day-total" label="Appointments" value={String(rows.length)} hint="on the chosen day" icon="CalendarDays" />
        <Stat id="stat.day-arrived" label="Arrived" value={String(arrived)} hint="checked in at reception" icon="UserCheck" tone="success" />
      </StatGroup>
      <Section id="section.day" title="Appointments" count={rows.length} subtitle="In time order. Open one to write visit notes.">
        <Filters id="filters.day">
          <Field id="field.day" label="Day" type="date" value={date} onChange={setDate} />
        </Filters>
        <Table
          id="table.day"
          columns={["Time", "Patient", { label: "Status", kind: "status" }]}
          rows={rows.map((a) => ({
            id: `appt.${a.id}`,
            cells: [`${a.start}–${a.end}`, a.patient],
            status: a.status === "checked-in" ? { text: "Checked in", tone: "success" as const } : { text: "Not yet arrived", tone: "info" as const },
            to: "screen.consultation",
            params: { appointment: a.id },
          }))}
          empty={<EmptyState id="empty.day" title="No appointments" text="Nothing is booked for this day." />}
        />
      </Section>
    </Shell>
  );
}

function Consultation() {
  const state = useDisplayState();
  const today = useToday();
  const { appointment } = useParams();
  const appts = useCollection<Appt>("appointments");
  const notesC = useCollection<Note>("notes");
  const [writing, setWriting] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const appt = (appointment ? appts.get(appointment) : undefined) ?? appts.items.find((a) => a.doctor === DOCTOR)!;
  const canWrite = appt.status === "checked-in" || appt.date < today;
  const own = state === "state.empty" ? [] : notesC.items.filter((n) => n.appointmentId === appt.id);
  const earlier =
    state === "state.empty" ? [] : notesC.items.filter((n) => n.patient === appt.patient && n.appointmentId !== appt.id);
  const error = state === "state.validation-error" ? "Write something before saving" : undefined;
  return (
    <Shell>
      <Breadcrumbs
        id="crumbs.consultation"
        items={[
          { id: "crumb.day", label: "My day", to: "screen.my-day" },
          { id: "crumb.appointment", label: appt.patient },
        ]}
      />
      <Heading id="heading.consultation" text={`${appt.patient}, ${appt.start}`} />
      <FailedAlert />
      <Detail
        id="detail.appointment"
        fields={[
          { label: "Patient", value: appt.patient },
          { label: "Date", value: appt.date },
          { label: "Time", value: `${appt.start}–${appt.end}` },
          { label: "Status", value: apptChip(appt.status).text },
        ]}
      />
      {!canWrite && (
        <Alert id="alert.cannot-write" tone="info" text="Notes can be written once the patient has checked in or the appointment has started." />
      )}
      <Section
        id="section.notes"
        title="Visit notes"
        count={own.length}
        subtitle="Only doctors can read these."
        actions={<Button id="btn.write-note" label="Write note" emphasis="primary" disabled={!canWrite} onPress={() => setWriting(true)} />}
      >
        <Table
          id="table.notes"
          columns={["Written", "Author", "Note"]}
          rows={own.map((n) => ({
            id: `note.${n.id}`,
            cells: [n.date, n.author, n.text],
            actions: n.author === DOCTOR ? [{ id: `note.${n.id}.edit`, label: "Edit", onPress: () => setEditing(n) }] : undefined,
          }))}
          empty={<EmptyState id="empty.notes" title="No notes yet" text="Notes you write appear here." />}
        />
      </Section>
      <Section id="section.earlier" title="Earlier notes for this patient" count={earlier.length} subtitle="From the patient's previous visits, newest first.">
        {earlier.length > 0 ? (
          <Timeline id="timeline.earlier" entries={earlier.map((n) => ({ when: n.date, who: n.author, text: n.text }))} />
        ) : (
          <Text id="text.no-earlier" text="No earlier notes." />
        )}
      </Section>
      <Dialog id="dialog.write-note" title="Write a visit note" open={writing} onClose={() => setWriting(false)}>
        <Form
          id="form.write-note"
          onSubmit={(v) => {
            notesC.create({ appointmentId: appt.id, patient: appt.patient, author: DOCTOR, date: today, text: v["text"] ?? "" });
            setWriting(false);
          }}
          actions={<Button id="btn.write-note.save" label="Save note" emphasis="primary" submit />}
        >
          <Field id="field.note" name="text" label="Note" type="textarea" required error={error} />
        </Form>
      </Dialog>
      <Dialog id="dialog.edit-note" title="Edit visit note" open={editing !== null} onClose={() => setEditing(null)}>
        {editing && (
          <Form
            id="form.edit-note"
            onSubmit={(v) => {
              notesC.update(editing.id, { text: v["text"] ?? editing.text });
              setEditing(null);
            }}
            actions={<Button id="btn.edit-note.save" label="Save changes" emphasis="primary" submit />}
          >
            <Field id="field.edit-note" name="text" label="Note" type="textarea" required defaultValue={editing.text} error={error} />
          </Form>
        )}
      </Dialog>
    </Shell>
  );
}

function FrontDesk() {
  const state = useDisplayState();
  const today = useToday();
  const { appts, notice, cancel } = useAppointmentActions();
  const [date, setDate] = useState(today);
  const [doctor, setDoctor] = useState("All doctors");
  const [moving, setMoving] = useState<Appt | null>(null);
  const rows =
    state === "state.empty"
      ? []
      : appts.items
          .filter((a) => a.date === date && (doctor === "All doctors" || a.doctor === doctor))
          .sort(byTime);
  return (
    <Shell>
      <Heading id="heading.front-desk" text="Front desk" actions={<Button id="btn.desk-book" label="Book for a patient" emphasis="primary" to="screen.slots" />} />
      <FailedAlert />
      {state === "state.conflict" && (
        <Alert id="alert.desk-refused" tone="warning" title="Action refused" text="Check-in is only possible on the day of a booked appointment, and nothing can be cancelled within 2 hours of the start." />
      )}
      {notice && <Alert id="alert.notice" tone="warning" text={notice} />}
      <Section id="section.desk" title="Appointments" count={rows.length} subtitle="One day, one doctor or the whole clinic.">
        <Filters id="filters.desk">
          <Field id="field.desk-date" label="Day" type="date" value={date} onChange={setDate} />
          <Field id="field.desk-doctor" label="Doctor" type="select" options={DOCTORS} value={doctor} onChange={setDoctor} />
        </Filters>
        <Table
          id="table.desk"
          columns={["Time", "Patient", "Doctor", { label: "Status", kind: "status" }]}
          rows={rows.map((a) => ({
            id: `appt.${a.id}`,
            cells: [`${a.start}–${a.end}`, a.patient, a.doctor],
            status: apptChip(a.status),
            actions:
              a.status === "booked"
                ? [
                    ...(a.date === today
                      ? [{ id: `appt.${a.id}.check-in`, label: "Check in", onPress: () => appts.update(a.id, { status: "checked-in" }) }]
                      : []),
                    { id: `appt.${a.id}.reschedule`, label: "Reschedule", onPress: () => setMoving(a) },
                    { id: `appt.${a.id}.cancel`, label: "Cancel", emphasis: "danger" as const, onPress: () => cancel(a) },
                  ]
                : a.status === "checked-in"
                  ? [{ id: `appt.${a.id}.undo`, label: "Undo check-in", onPress: () => appts.update(a.id, { status: "booked" }) }]
                  : undefined,
          }))}
          empty={<EmptyState id="empty.desk" title="No appointments" text="Nothing is booked for this selection." />}
        />
      </Section>
      <RescheduleDialog appt={moving} onClose={() => setMoving(null)} />
    </Shell>
  );
}

function Patients() {
  const state = useDisplayState();
  const patientsC = useCollection<Patient>("patients");
  const [query, setQuery] = useState("");
  const [registering, setRegistering] = useState(false);
  const q = query.toLowerCase();
  const rows =
    state === "state.empty"
      ? []
      : patientsC.items.filter((p) => q === "" || p.name.toLowerCase().includes(q) || p.phone.includes(query));
  return (
    <Shell>
      <Heading id="heading.patients" text="Patients" />
      <FailedAlert />
      <Section
        id="section.patients"
        title="Patient records"
        count={rows.length}
        subtitle="Find a patient by name or phone number."
        actions={<Button id="btn.register" label="Register patient" emphasis="primary" onPress={() => setRegistering(true)} />}
      >
        <Filters id="filters.patients">
          <Field id="field.search" label="Name or phone" value={query} onChange={setQuery} placeholder="Pat or 555-0101" />
        </Filters>
        <Table
          id="table.patients"
          columns={["Name", "Phone"]}
          rows={rows.map((p) => ({
            id: `patient.${p.id}`,
            cells: [p.name, p.phone],
            actions: [{ id: `patient.${p.id}.book`, label: "Book appointment", to: "screen.slots", params: { patient: p.name } }],
          }))}
          empty={<EmptyState id="empty.patients" title="No patient found" text="Register the patient to book for them." />}
        />
      </Section>
      <Dialog id="dialog.register" title="Register a patient" open={registering} onClose={() => setRegistering(false)}>
        <Form
          id="form.register"
          onSubmit={(v) => {
            patientsC.create({ name: v["name"] ?? "", phone: v["phone"] ?? "" });
            setRegistering(false);
          }}
          actions={<Button id="btn.register.confirm" label="Register" emphasis="primary" submit />}
        >
          <Field id="field.name" name="name" label="Full name" required error={state === "state.validation-error" ? "Enter the patient's name" : undefined} />
          <Field id="field.phone" name="phone" label="Phone number" required pattern="^[0-9-]{7,15}$" patternMessage="Digits and dashes only" />
        </Form>
      </Dialog>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const user = people[role] ?? people["Patient"]!;
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
    "screen.slots": Slots,
    "screen.my-appointments": MyAppointments,
    "screen.my-slots": MySlots,
    "screen.my-day": MyDay,
    "screen.consultation": Consultation,
    "screen.front-desk": FrontDesk,
    "screen.patients": Patients,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { slots, appointments, patients, notes },
});
