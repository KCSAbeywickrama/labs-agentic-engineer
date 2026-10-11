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
  Screen, Section, Stat, StatGroup, Table, defineApp, useCollection, useDisplayState, useNav,
  useParams, useRole, useToday,
} from "@wso2/prototype-kit";

interface Slot {
  id: string;
  doctorId: string;
  doctorName: string;
  startTime: string;
  endTime: string;
  status: "AVAILABLE" | "BOOKED";
}

interface Appointment {
  id: string;
  slotId: string;
  doctorId: string;
  doctorName: string;
  patientId: string;
  patientName: string;
  bookedBy: string;
  startTime: string;
  endTime: string;
  status: "BOOKED" | "CHECKED_IN" | "CANCELLED";
  checkedInAt: string | null;
}

interface VisitNote {
  id: string;
  appointmentId: string;
  doctorId: string;
  text: string;
  updatedAt: string;
}

const slots: Slot[] = [
  { id: "slot-1", doctorId: "doc-rivera", doctorName: "Dr. Maya Rivera", startTime: "2026-01-16T09:00:00", endTime: "2026-01-16T09:30:00", status: "AVAILABLE" },
  { id: "slot-2", doctorId: "doc-rivera", doctorName: "Dr. Maya Rivera", startTime: "2026-01-16T09:30:00", endTime: "2026-01-16T10:00:00", status: "BOOKED" },
  { id: "slot-3", doctorId: "doc-rivera", doctorName: "Dr. Maya Rivera", startTime: "2026-01-16T11:00:00", endTime: "2026-01-16T11:30:00", status: "AVAILABLE" },
  { id: "slot-4", doctorId: "doc-chen", doctorName: "Dr. Wei Chen", startTime: "2026-01-15T09:00:00", endTime: "2026-01-15T09:30:00", status: "BOOKED" },
  { id: "slot-5", doctorId: "doc-rivera", doctorName: "Dr. Maya Rivera", startTime: "2026-01-15T14:00:00", endTime: "2026-01-15T14:30:00", status: "BOOKED" },
  { id: "slot-6", doctorId: "doc-chen", doctorName: "Dr. Wei Chen", startTime: "2026-01-17T10:00:00", endTime: "2026-01-17T10:30:00", status: "AVAILABLE" },
  { id: "slot-7", doctorId: "doc-rivera", doctorName: "Dr. Maya Rivera", startTime: "2026-01-10T09:00:00", endTime: "2026-01-10T09:30:00", status: "BOOKED" },
];

const appointments: Appointment[] = [
  { id: "appt-1", slotId: "slot-2", doctorId: "doc-rivera", doctorName: "Dr. Maya Rivera", patientId: "pat-fernando", patientName: "Pat Fernando", bookedBy: "pat-fernando", startTime: "2026-01-16T09:30:00", endTime: "2026-01-16T10:00:00", status: "BOOKED", checkedInAt: null },
  { id: "appt-2", slotId: "slot-4", doctorId: "doc-chen", doctorName: "Dr. Wei Chen", patientId: "sam-perera", patientName: "Sam Perera", bookedBy: "sam-perera", startTime: "2026-01-15T09:00:00", endTime: "2026-01-15T09:30:00", status: "CHECKED_IN", checkedInAt: "2026-01-15T09:05:00" },
  { id: "appt-3", slotId: "slot-5", doctorId: "doc-rivera", doctorName: "Dr. Maya Rivera", patientId: "pat-fernando", patientName: "Pat Fernando", bookedBy: "pat-fernando", startTime: "2026-01-15T14:00:00", endTime: "2026-01-15T14:30:00", status: "BOOKED", checkedInAt: null },
  { id: "appt-4", slotId: "slot-7", doctorId: "doc-rivera", doctorName: "Dr. Maya Rivera", patientId: "pat-fernando", patientName: "Pat Fernando", bookedBy: "pat-fernando", startTime: "2026-01-10T09:00:00", endTime: "2026-01-10T09:30:00", status: "CHECKED_IN", checkedInAt: "2026-01-10T09:05:00" },
];

const visitNotes: VisitNote[] = [
  { id: "note-1", appointmentId: "appt-2", doctorId: "doc-chen", text: "Mild fever; advised rest and fluids. Review in a week if symptoms persist.", updatedAt: "2026-01-15T09:20:00" },
];

function formatTime(iso: string): string {
  return iso.slice(11, 16);
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

function formatRange(start: string, end: string): string {
  return `${formatDate(start)} ${formatTime(start)}–${formatTime(end)}`;
}

function statusBadge(status: Appointment["status"]): { text: string; tone: "warning" | "success" | "default" } {
  if (status === "BOOKED") return { text: "Booked", tone: "warning" };
  if (status === "CHECKED_IN") return { text: "Checked in", tone: "success" };
  return { text: "Cancelled", tone: "default" };
}

function roleUser(role: string): { name: string; email: string } {
  if (role === "Doctor") return { name: "Dr. Maya Rivera", email: "maya.rivera@clinic.example" };
  if (role === "Receptionist") return { name: "Rita Alvarez", email: "rita.alvarez@clinic.example" };
  return { name: "Pat Fernando", email: "pat.fernando@example.com" };
}

function Shell({ children }: { children: ReactNode }) {
  const role = useRole();
  const user = roleUser(role);
  const nav =
    role === "Doctor"
      ? [
          { id: "nav.my-slots", label: "My availability", to: "screen.my-slots" },
          { id: "nav.schedule", label: "My day", to: "screen.schedule" },
        ]
      : role === "Receptionist"
      ? [{ id: "nav.front-desk", label: "Front desk", to: "screen.front-desk" }]
      : [
          { id: "nav.slots", label: "Browse slots", to: "screen.slots" },
          { id: "nav.appointments", label: "My appointments", to: "screen.appointments" },
        ];
  return (
    <AppShell id="shell" user={user} nav={nav} account="screen.account" settings="screen.settings" signOut="screen.signed-out">
      {children}
    </AppShell>
  );
}

function Slots() {
  const state = useDisplayState();
  const slotsCol = useCollection<Slot>("slots");
  const appointmentsCol = useCollection<Appointment>("appointments");
  const [doctor, setDoctor] = useState("all");
  const available =
    state === "state.empty"
      ? []
      : slotsCol.items.filter((s) => s.status === "AVAILABLE" && (doctor === "all" || s.doctorId === doctor));
  const book = (slot: Slot) => {
    appointmentsCol.create({
      slotId: slot.id,
      doctorId: slot.doctorId,
      doctorName: slot.doctorName,
      patientId: "pat-fernando",
      patientName: "Pat Fernando",
      bookedBy: "pat-fernando",
      startTime: slot.startTime,
      endTime: slot.endTime,
      status: "BOOKED",
      checkedInAt: null,
    });
    slotsCol.update(slot.id, { status: "BOOKED" });
  };
  return (
    <Shell>
      <Heading id="heading.slots" text="Browse available slots" />
      {state === "state.conflict" && (
        <Alert id="alert.slot-taken" tone="error" title="Slot no longer available" text="That slot was just booked by someone else. Choose another." />
      )}
      <Section id="section.slots" title="Available slots" count={available.length} subtitle="Pick a doctor to find a time that suits you.">
        <Filters id="filters.slots">
          <Field
            id="field.doctor"
            label="Doctor"
            type="select"
            options={["all", "doc-rivera", "doc-chen"]}
            value={doctor}
            onChange={setDoctor}
          />
        </Filters>
        <Table
          id="table.slots"
          columns={["Doctor", "Date & time", { label: "Status", kind: "status" }]}
          rows={available.map((s) => ({
            id: `slot.${s.id}`,
            cells: [s.doctorName, formatRange(s.startTime, s.endTime)],
            status: { text: "Available", tone: "success" },
            actions: [{ id: `slot.${s.id}.book`, label: "Book", onPress: () => book(s) }],
          }))}
          empty={<EmptyState id="empty.slots" title="No available slots" text="Try another doctor." />}
        />
      </Section>
    </Shell>
  );
}

function Appointments() {
  const state = useDisplayState();
  const appointmentsCol = useCollection<Appointment>("appointments");
  const mine = state === "state.empty" ? [] : appointmentsCol.items.filter((a) => a.patientId === "pat-fernando");
  return (
    <Shell>
      <Heading id="heading.appointments" text="My appointments" />
      <Section id="section.appointments" title="Appointments" count={mine.length} subtitle="Upcoming and past. Open one to reschedule or cancel.">
        <Table
          id="table.appointments"
          columns={["Doctor", "Date & time", { label: "Status", kind: "status" }]}
          rows={mine.map((a) => ({
            id: `appointment.${a.id}`,
            cells: [a.doctorName, formatRange(a.startTime, a.endTime)],
            status: statusBadge(a.status),
            to: "screen.appointment-detail",
            params: { appointment: a.id },
          }))}
          empty={<EmptyState id="empty.appointments" title="No appointments yet" text="Book a slot to see it here." />}
        />
      </Section>
    </Shell>
  );
}

function AppointmentDetail() {
  const { appointment: id } = useParams();
  const state = useDisplayState();
  const navigate = useNav();
  const appointmentsCol = useCollection<Appointment>("appointments");
  const slotsCol = useCollection<Slot>("slots");
  const [rescheduling, setRescheduling] = useState(false);
  const appt = (id ? appointmentsCol.get(id) : undefined) ?? appointmentsCol.items[0]!;
  const alternatives = slotsCol.items.filter((s) => s.status === "AVAILABLE" && s.doctorId === appt.doctorId);
  const reschedule = (values: Record<string, string>) => {
    const target = alternatives.find((s) => formatRange(s.startTime, s.endTime) === values.slot);
    if (!target) return;
    slotsCol.update(appt.slotId, { status: "AVAILABLE" });
    slotsCol.update(target.id, { status: "BOOKED" });
    appointmentsCol.update(appt.id, { slotId: target.id, startTime: target.startTime, endTime: target.endTime });
    setRescheduling(false);
  };
  const cancel = () => {
    appointmentsCol.update(appt.id, { status: "CANCELLED" });
    slotsCol.update(appt.slotId, { status: "AVAILABLE" });
    navigate.go("screen.appointments");
  };
  return (
    <Shell>
      <Breadcrumbs
        id="breadcrumbs.detail"
        items={[
          { id: "crumb.appointments", label: "My appointments", to: "screen.appointments" },
          { id: "crumb.current", label: `Appointment ${appt.id}` },
        ]}
      />
      <Heading id="heading.detail" text={`Appointment with ${appt.doctorName}`} />
      {state === "state.conflict" && (
        <Alert id="alert.too-late" tone="error" title="Too close to the appointment" text="This appointment cannot be changed within 2 hours of its start." />
      )}
      <Detail
        id="detail.appointment"
        fields={[
          { label: "Doctor", value: appt.doctorName },
          { label: "When", value: formatRange(appt.startTime, appt.endTime) },
          { label: "Status", value: statusBadge(appt.status).text },
        ]}
      />
      {appt.status === "BOOKED" && (
        <>
          <Button id="btn.reschedule" label="Reschedule" emphasis="primary" onPress={() => setRescheduling(true)} />
          <Button id="btn.cancel" label="Cancel appointment" emphasis="danger" onPress={cancel} />
        </>
      )}
      <Dialog id="dialog.reschedule" title="Choose a new slot" open={rescheduling} onClose={() => setRescheduling(false)}>
        <Form
          id="form.reschedule"
          onSubmit={reschedule}
          actions={<Button id="btn.reschedule.confirm" label="Reschedule" emphasis="primary" submit />}
        >
          <Field
            id="field.new-slot"
            name="slot"
            label="New slot"
            type="select"
            required
            options={alternatives.map((s) => formatRange(s.startTime, s.endTime))}
          />
        </Form>
      </Dialog>
    </Shell>
  );
}

function MySlots() {
  const state = useDisplayState();
  const slotsCol = useCollection<Slot>("slots");
  const [publishing, setPublishing] = useState(false);
  const mine = state === "state.empty" ? [] : slotsCol.items.filter((s) => s.doctorId === "doc-rivera");
  const publish = (values: Record<string, string>) => {
    slotsCol.create({ doctorId: "doc-rivera", doctorName: "Dr. Maya Rivera", startTime: values.start!, endTime: values.end!, status: "AVAILABLE" });
    setPublishing(false);
  };
  const remove = (s: Slot) => slotsCol.remove(s.id);
  return (
    <Shell>
      <Heading
        id="heading.my-slots"
        text="My availability"
        actions={<Button id="btn.publish" label="Publish slots" emphasis="primary" onPress={() => setPublishing(true)} />}
      />
      {state === "state.conflict" && (
        <Alert id="alert.slot-booked" tone="error" title="Cannot remove a booked slot" text="This slot has a patient booked; cancel the appointment first." />
      )}
      <Section id="section.my-slots" title="My slots" count={mine.length} subtitle="Slots patients can book, and the ones already taken.">
        <Table
          id="table.my-slots"
          columns={["Date & time", { label: "Status", kind: "status" }]}
          rows={mine.map((s) => ({
            id: `slot.${s.id}`,
            cells: [formatRange(s.startTime, s.endTime)],
            status: s.status === "AVAILABLE" ? { text: "Available", tone: "success" } : { text: "Booked", tone: "warning" },
            actions:
              s.status === "AVAILABLE"
                ? [{ id: `slot.${s.id}.remove`, label: "Remove", emphasis: "danger", onPress: () => remove(s) }]
                : [],
          }))}
          empty={<EmptyState id="empty.my-slots" title="No slots published" text="Publish availability so patients can book." />}
        />
      </Section>
      <Dialog id="dialog.publish" title="Publish availability" open={publishing} onClose={() => setPublishing(false)}>
        <Form
          id="form.publish"
          onSubmit={publish}
          actions={<Button id="btn.publish.confirm" label="Publish" emphasis="primary" submit />}
        >
          <Field id="field.start" name="start" label="Start (e.g. 2026-01-20T09:00:00)" required />
          <Field id="field.end" name="end" label="End (e.g. 2026-01-20T09:30:00)" required />
        </Form>
      </Dialog>
    </Shell>
  );
}

function Schedule() {
  const state = useDisplayState();
  const today = useToday();
  const appointmentsCol = useCollection<Appointment>("appointments");
  const mine =
    state === "state.empty"
      ? []
      : appointmentsCol.items.filter((a) => a.doctorId === "doc-rivera" && a.startTime.slice(0, 10) === today && a.status !== "CANCELLED");
  return (
    <Shell>
      <Heading id="heading.schedule" text="My day" />
      <StatGroup>
        <Stat id="stat.today" label="Today" value={String(mine.length)} hint="appointments" icon="CalendarDays" />
      </StatGroup>
      <Section id="section.schedule" title="Today's appointments" count={mine.length} subtitle="Open a visit to write or read the note.">
        <Table
          id="table.schedule"
          columns={["Patient", "Time", { label: "Status", kind: "status" }]}
          rows={mine.map((a) => ({
            id: `appt.${a.id}`,
            cells: [a.patientName, formatTime(a.startTime)],
            status: statusBadge(a.status),
            to: "screen.visit-note",
            params: { appointment: a.id },
          }))}
          empty={<EmptyState id="empty.schedule" title="No appointments today" text="Enjoy the quiet." />}
        />
      </Section>
    </Shell>
  );
}

function VisitNoteScreen() {
  const { appointment: id } = useParams();
  const state = useDisplayState();
  const appointmentsCol = useCollection<Appointment>("appointments");
  const notesCol = useCollection<VisitNote>("visitNotes");
  const appt = (id ? appointmentsCol.get(id) : undefined) ?? appointmentsCol.items[0]!;
  const existing = notesCol.items.find((n) => n.appointmentId === appt.id);
  const [text, setText] = useState(existing?.text ?? "");
  const save = () => {
    if (!text) return;
    if (existing) notesCol.update(existing.id, { text, updatedAt: "2026-01-15T16:00:00" });
    else notesCol.create({ appointmentId: appt.id, doctorId: appt.doctorId, text, updatedAt: "2026-01-15T16:00:00" });
  };
  return (
    <Shell>
      <Breadcrumbs
        id="breadcrumbs.note"
        items={[
          { id: "crumb.schedule", label: "My day", to: "screen.schedule" },
          { id: "crumb.current", label: `Visit ${appt.id}` },
        ]}
      />
      <Heading id="heading.note" text={`Visit with ${appt.patientName}`} />
      <Detail
        id="detail.visit"
        fields={[
          { label: "Patient", value: appt.patientName },
          { label: "Time", value: formatRange(appt.startTime, appt.endTime) },
        ]}
      />
      <Form id="form.note" onSubmit={save} actions={<Button id="btn.save-note" label="Save note" emphasis="primary" submit />}>
        <Field
          id="field.note"
          name="text"
          label="Visit note"
          type="textarea"
          required
          value={text}
          onChange={setText}
          error={state === "state.validation-error" ? "Write a note before saving" : undefined}
        />
      </Form>
    </Shell>
  );
}

function FrontDesk() {
  const state = useDisplayState();
  const appointmentsCol = useCollection<Appointment>("appointments");
  const slotsCol = useCollection<Slot>("slots");
  const today = useToday();
  const [booking, setBooking] = useState(false);
  const all = state === "state.empty" ? [] : appointmentsCol.items.filter((a) => a.status !== "CANCELLED");
  const availableSlots = slotsCol.items.filter((s) => s.status === "AVAILABLE");
  const book = (values: Record<string, string>) => {
    const target = availableSlots.find((s) => formatRange(s.startTime, s.endTime) === values.slot);
    if (!target || !values.patient) return;
    appointmentsCol.create({
      slotId: target.id,
      doctorId: target.doctorId,
      doctorName: target.doctorName,
      patientId: values.patient.toLowerCase().replace(/\s+/g, "-"),
      patientName: values.patient,
      bookedBy: "rita-alvarez",
      startTime: target.startTime,
      endTime: target.endTime,
      status: "BOOKED",
      checkedInAt: null,
    });
    slotsCol.update(target.id, { status: "BOOKED" });
    setBooking(false);
  };
  const checkIn = (a: Appointment) => {
    appointmentsCol.update(a.id, { status: "CHECKED_IN", checkedInAt: `${today}T09:05:00` });
  };
  const cancel = (a: Appointment) => {
    appointmentsCol.update(a.id, { status: "CANCELLED" });
    slotsCol.update(a.slotId, { status: "AVAILABLE" });
  };
  return (
    <Shell>
      <Heading
        id="heading.front-desk"
        text="Front desk"
        actions={<Button id="btn.book" label="Book for patient" emphasis="primary" onPress={() => setBooking(true)} />}
      />
      {state === "state.conflict" && (
        <Alert id="alert.front-desk-conflict" tone="error" title="Cannot complete that action" text="The slot was already taken, or the appointment is within 2 hours of its start." />
      )}
      <Section id="section.front-desk" title="Appointments" count={all.length} subtitle="Book for a patient, check them in on arrival, or cancel.">
        <Table
          id="table.front-desk"
          columns={["Patient", "Doctor", "Time", { label: "Status", kind: "status" }]}
          rows={all.map((a) => ({
            id: `fd.${a.id}`,
            cells: [a.patientName, a.doctorName, formatRange(a.startTime, a.endTime)],
            status: statusBadge(a.status),
            actions:
              a.status === "BOOKED"
                ? [
                    { id: `fd.${a.id}.check-in`, label: "Check in", onPress: () => checkIn(a) },
                    { id: `fd.${a.id}.cancel`, label: "Cancel", emphasis: "danger", onPress: () => cancel(a) },
                  ]
                : [],
          }))}
          empty={<EmptyState id="empty.front-desk" title="No appointments" text="Book one for a patient to get started." />}
        />
      </Section>
      <Dialog id="dialog.book" title="Book for a patient" open={booking} onClose={() => setBooking(false)}>
        <Form id="form.book" onSubmit={book} actions={<Button id="btn.book.confirm" label="Book" emphasis="primary" submit />}>
          <Field id="field.patient-name" name="patient" label="Patient name" required />
          <Field
            id="field.slot"
            name="slot"
            label="Slot"
            type="select"
            required
            options={availableSlots.map((s) => formatRange(s.startTime, s.endTime))}
          />
        </Form>
      </Dialog>
    </Shell>
  );
}

function Account() {
  const role = useRole();
  const user = roleUser(role);
  return (
    <Shell>
      <Heading id="heading.account" text="Account" />
      <Detail
        id="detail.account"
        fields={[
          { label: "Name", value: user.name },
          { label: "Email", value: user.email },
          { label: "Role", value: role },
        ]}
      />
    </Shell>
  );
}

function Settings() {
  const navigate = useNav();
  const role = useRole();
  const entry = role === "Doctor" ? "screen.schedule" : role === "Receptionist" ? "screen.front-desk" : "screen.slots";
  return (
    <Shell>
      <Heading id="heading.settings" text="Settings" />
      <Form id="form.settings" onSubmit={() => navigate.go(entry)} actions={<Button id="btn.save-settings" label="Save settings" emphasis="primary" submit />}>
        <Field id="field.reminders" label="Email me appointment reminders" type="switch" defaultValue="on" />
      </Form>
    </Shell>
  );
}

function SignedOut() {
  const role = useRole();
  const target = role === "Doctor" ? "screen.schedule" : role === "Receptionist" ? "screen.front-desk" : "screen.slots";
  return (
    <Screen>
      <Heading id="heading.signed-out" text="You are signed out" />
      <Button id="btn.sign-in" label="Sign in" emphasis="primary" to={target} />
    </Screen>
  );
}

export default defineApp({
  screens: {
    "screen.slots": Slots,
    "screen.appointments": Appointments,
    "screen.appointment-detail": AppointmentDetail,
    "screen.my-slots": MySlots,
    "screen.schedule": Schedule,
    "screen.visit-note": VisitNoteScreen,
    "screen.front-desk": FrontDesk,
    "screen.account": Account,
    "screen.settings": Settings,
    "screen.signed-out": SignedOut,
  },
  data: { slots, appointments, visitNotes },
});
