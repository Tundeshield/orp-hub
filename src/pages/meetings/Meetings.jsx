import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, doc, serverTimestamp, Timestamp, updateDoc, writeBatch, deleteDoc, orderBy } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useAuth } from '../../AuthContext.jsx';
import { col, query, where, useLive, addAudit } from '../../lib/db.js';
import { can, isDiaryManager } from '../../lib/roles.js';
import { useUsers, usersWithRole } from '../../lib/users.js';
import { addDays, fmtDate, fmtDateTime, fmtTime, fromInputDate, startOfDay, toDate, toInputDate, relative } from '../../lib/dates.js';
import { generateSlots, withoutConflicts } from '../../lib/slots.js';
import { appointmentICS } from '../../lib/ics.js';
import { download } from '../../lib/csv.js';
import { bookSlot, cancelAppointment, rescheduleAppointment } from '../../lib/meetingOps.js';
import { Badge, Button, Card, Confirm, Empty, ErrorNote, Field, Loading, Modal, PageHeader, Tabs, useAction } from '../../components/ui.jsx';
import { TaskForm } from '../Tasks.jsx';

function groupByDay(slots) {
  const map = new Map();
  for (const s of slots) {
    const key = toInputDate(s.start);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return [...map.entries()];
}

export function downloadICS(appt) {
  download(`appointment-${toInputDate(appt.start)}.ics`, appointmentICS({
    id: appt.id, title: `Appointment with the Resident Pastor${appt.attendeeName ? ` — ${appt.attendeeName}` : ''}`,
    description: appt.purpose, start: appt.start, end: appt.end, location: appt.location,
  }), 'text/calendar;charset=utf-8');
}

export default function Meetings() {
  const { profile } = useAuth();
  const manager = isDiaryManager(profile);
  const notesAccess = can(profile, 'pastor', 'assistant');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || (manager ? 'diary' : 'book');
  const setTab = (t) => setParams({ tab: t });
  const users = useUsers();
  const managerUids = [...usersWithRole(users, 'pastor'), ...usersWithRole(users, 'assistant')].map((u) => u.uid);

  const today = useMemo(() => startOfDay(new Date()), []);
  const slots = useLive(() => query(col('slots'), where('start', '>=', Timestamp.fromDate(today)), orderBy('start')), [today]);
  const mine = useLive(() => query(col('appointments'), where('attendeeUid', '==', profile.uid)), [profile.uid]);
  const diary = useLive(() => manager ? query(col('appointments'), where('start', '>=', Timestamp.fromDate(addDays(today, -60))), orderBy('start')) : null, [manager, today]);

  const [booking, setBooking] = useState(null); // { slot, reschedule? }
  const [cancelling, setCancelling] = useState(null);
  const [rescheduling, setRescheduling] = useState(null);

  const tabs = [
    { value: 'book', label: 'Book an appointment' },
    { value: 'mine', label: 'My appointments', count: mine.data.filter((a) => a.status === 'booked' && toDate(a.end) >= new Date()).length },
    ...(manager ? [{ value: 'diary', label: 'Pastor\'s diary' }, { value: 'availability', label: 'Availability' }] : []),
    ...(notesAccess ? [{ value: 'notes', label: 'Meeting notes' }] : []),
  ];

  return (
    <>
      <PageHeader title="Meetings & appointments" subtitle="Book time with the Resident Pastor. Each slot can only be booked once." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <ErrorNote error={slots.error || mine.error || diary.error} />

      {tab === 'book' && (
        <SlotPicker slots={slots} onPick={(slot) => setBooking({ slot })} />
      )}
      {tab === 'mine' && (
        <AppointmentList rows={mine.data} loading={mine.loading} mine onCancel={setCancelling} onReschedule={setRescheduling} />
      )}
      {tab === 'diary' && manager && (
        <AppointmentList rows={diary.data} loading={diary.loading} onCancel={setCancelling} onReschedule={setRescheduling} manager />
      )}
      {tab === 'availability' && manager && <Availability slots={slots} />}
      {tab === 'notes' && notesAccess && <MeetingNotes appts={diary.data} />}

      <BookModal open={!!booking} slot={booking?.slot} onClose={() => setBooking(null)} managerUids={managerUids} manager={manager} users={users}
        onBooked={() => setTab('mine')} />
      <Modal open={!!rescheduling} title="Choose a new time" wide onClose={() => setRescheduling(null)}>
        {rescheduling && <RescheduleBody appt={rescheduling} slots={slots} managerUids={managerUids} onDone={() => setRescheduling(null)} />}
      </Modal>
      <CancelModal appt={cancelling} onClose={() => setCancelling(null)} managerUids={managerUids} />
    </>
  );
}

function SlotPicker({ slots, onPick, excludeId }) {
  const now = new Date();
  const open = slots.data.filter((s) => s.status === 'open' && toDate(s.start) > now && s.id !== excludeId);
  if (slots.loading) return <Loading />;
  if (!open.length) return <Card><Empty title="No open slots right now">The pastor's office hasn't published availability yet, or everything is booked. Check back soon.</Empty></Card>;
  return (
    <Card>
      {groupByDay(open).map(([day, list]) => (
        <div key={day}>
          <div className="day-head">{fmtDate(fromInputDate(day), { weekday: 'long' })} <span className="muted small">({relative(fromInputDate(day))})</span></div>
          <div className="slot-grid">
            {list.map((s) => (
              <button key={s.id} className="slot" onClick={() => onPick(s)}>
                <div className="t">{fmtTime(s.start)} – {fmtTime(s.end)}</div>
                <div className="s">{s.label || 'Available'}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </Card>
  );
}

function BookModal({ open, slot, onClose, managerUids, manager, users, onBooked }) {
  const { profile } = useAuth();
  const { busy, error, setError, run } = useAction();
  const [f, setF] = useState({});
  useEffect(() => { if (open) { setError(null); setF({ who: 'self', attendeeUid: '', attendeeName: '', phone: profile.phone || '', purpose: '' }); } }, [open, profile.phone, setError]);
  if (!slot) return null;

  async function book() {
    if (!f.purpose.trim()) return setError('Briefly say what the meeting is about.');
    const details = { purpose: f.purpose.trim(), phone: f.phone.trim(), location: slot.location || '' };
    if (manager && f.who === 'member') {
      const u = users.find((x) => x.uid === f.attendeeUid);
      if (!u) return setError('Choose the person.');
      Object.assign(details, { attendeeUid: u.uid, attendeeName: u.name });
    } else if (manager && f.who === 'visitor') {
      if (!f.attendeeName.trim()) return setError('Enter the visitor\'s name.');
      Object.assign(details, { attendeeUid: null, attendeeName: f.attendeeName.trim() });
    }
    const ok = await run(() => bookSlot(profile, slot, details, managerUids), 'Appointment confirmed');
    if (ok) { onClose(); onBooked?.(); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Book appointment"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={book}>Confirm booking</Button></>}>
      <p><strong>{fmtDate(slot.start, { weekday: 'long' })}</strong>, {fmtTime(slot.start)} – {fmtTime(slot.end)}{slot.location ? ` · ${slot.location}` : ''}</p>
      <div className="form">
        {manager && (
          <Field label="Booking for" full>
            <select value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })}>
              <option value="self">Myself</option><option value="member">A staff member / leader</option><option value="visitor">A visitor (no account)</option>
            </select>
          </Field>
        )}
        {manager && f.who === 'member' && (
          <Field label="Person" full>
            <select value={f.attendeeUid} onChange={(e) => setF({ ...f, attendeeUid: e.target.value })}>
              <option value="">Choose…</option>{users.map((u) => <option key={u.uid} value={u.uid}>{u.name}</option>)}
            </select>
          </Field>
        )}
        {manager && f.who === 'visitor' && <Field label="Visitor's name" full><input value={f.attendeeName} onChange={(e) => setF({ ...f, attendeeName: e.target.value })} /></Field>}
        <Field label="Phone"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Purpose" full hint="Only you and the pastor's office can see this."><textarea value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

function RescheduleBody({ appt, slots, managerUids, onDone }) {
  const { profile } = useAuth();
  const { busy, error, run } = useAction();
  const [picked, setPicked] = useState(null);
  return (
    <>
      <p className="muted">Current: {fmtDateTime(appt.start)}. {picked ? <>New: <strong>{fmtDateTime(picked.start)}</strong></> : 'Pick a new slot below.'}</p>
      {picked ? (
        <div className="row">
          <Button busy={busy} onClick={async () => { if (await run(() => rescheduleAppointment(profile, appt, picked, managerUids), 'Appointment moved')) onDone(); }}>Confirm new time</Button>
          <Button variant="ghost" onClick={() => setPicked(null)}>Choose another</Button>
        </div>
      ) : <SlotPicker slots={slots} onPick={setPicked} excludeId={appt.slotId} />}
      <ErrorNote error={error} />
    </>
  );
}

function CancelModal({ appt, onClose, managerUids }) {
  const { profile } = useAuth();
  const [reason, setReason] = useState('');
  return (
    <Confirm open={!!appt} title="Cancel appointment" danger confirmLabel="Cancel appointment" onClose={() => { setReason(''); onClose(); }}
      onConfirm={() => cancelAppointment(profile, appt, reason.trim(), managerUids)}>
      {appt && <p>{appt.attendeeName} — {fmtDateTime(appt.start)}</p>}
      <Field label="Reason (shared with the other party)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Confirm>
  );
}

function AppointmentList({ rows, loading, mine, manager, onCancel, onReschedule }) {
  const [showPast, setShowPast] = useState(false);
  const now = new Date();
  const statusAction = useAction();
  const list = rows
    .filter((a) => showPast ? true : (a.status === 'booked' && toDate(a.end) >= new Date(now.getTime() - 12 * 3600000)))
    .sort((a, b) => showPast ? toDate(b.start) - toDate(a.start) : toDate(a.start) - toDate(b.start));
  if (loading) return <Loading />;
  return (
    <>
      <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Show past and cancelled</label>
      <ErrorNote error={statusAction.error} />
      <Card pad={false}>
        {!list.length ? <Empty title={mine ? 'No upcoming appointments' : 'Diary is clear'}>{mine ? 'Use "Book an appointment" to find a time.' : ''}</Empty> : (
          <ul className="list">{list.map((a) => {
            const past = toDate(a.end) < now;
            return (
              <li key={a.id} className="list-item">
                <div className="list-main">
                  <div className="list-title">{fmtDate(a.start, { weekday: 'short' })}, {fmtTime(a.start)}–{fmtTime(a.end)} {!past && a.status === 'booked' && <span className="muted small">({relative(a.start)})</span>}</div>
                  <div className="list-meta">{manager ? `${a.attendeeName}${a.phone ? ` · ${a.phone}` : ''}` : 'With the Resident Pastor'}{a.bookedByName && a.bookedByName !== a.attendeeName ? ` · booked by ${a.bookedByName}` : ''}</div>
                  {a.purpose && <div className="small pre">{a.purpose}</div>}
                  {a.cancelReason && <div className="small muted">Reason: {a.cancelReason}</div>}
                </div>
                <div className="list-side row">
                  <Badge status={a.status}>{a.status.replace('_', ' ')}</Badge>
                  {a.status === 'booked' && !past && <>
                    <Button size="sm" variant="ghost" onClick={() => downloadICS(a)} title="Add to your calendar with reminders">📅 Add to calendar</Button>
                    <Button size="sm" variant="secondary" onClick={() => onReschedule(a)}>Reschedule</Button>
                    <Button size="sm" variant="ghost" onClick={() => onCancel(a)}>Cancel</Button>
                  </>}
                  {manager && a.status === 'booked' && past && <>
                    <Button size="sm" variant="secondary" busy={statusAction.busy} onClick={() => statusAction.run(() => updateDoc(doc(db, 'appointments', a.id), { status: 'completed', updatedAt: serverTimestamp() }))}>Mark held</Button>
                    <Button size="sm" variant="ghost" onClick={() => statusAction.run(() => updateDoc(doc(db, 'appointments', a.id), { status: 'no_show', updatedAt: serverTimestamp() }))}>No-show</Button>
                  </>}
                </div>
              </li>
            );
          })}</ul>
        )}
      </Card>
    </>
  );
}

function Availability({ slots }) {
  const { profile } = useAuth();
  const { busy, error, setError, run } = useAction();
  const del = useAction();
  const [f, setF] = useState({ date: toInputDate(addDays(new Date(), 1)), from: '10:00', to: '13:00', length: '30', weeks: '1', location: 'Pastor\'s office' });
  const proposed = useMemo(() => {
    const out = [];
    const base = fromInputDate(f.date);
    if (!base || !/^\d\d:\d\d$/.test(f.from) || !/^\d\d:\d\d$/.test(f.to)) return out;
    for (let w = 0; w < Math.min(12, Number(f.weeks) || 1); w++) out.push(...generateSlots(addDays(base, 7 * w), f.from, f.to, Number(f.length) || 30));
    return out;
  }, [f]);
  const existing = slots.data.map((s) => ({ start: toDate(s.start), end: toDate(s.end) }));
  const fresh = withoutConflicts(proposed, existing).filter((p) => p.start > new Date());

  async function publish() {
    if (!fresh.length) return setError('No new slots to add — they overlap existing slots or are in the past.');
    await run(async () => {
      for (let i = 0; i < fresh.length; i += 400) {
        const batch = writeBatch(db);
        fresh.slice(i, i + 400).forEach((p) => batch.set(doc(collection(db, 'slots')), {
          start: Timestamp.fromDate(p.start), end: Timestamp.fromDate(p.end), status: 'open', appointmentId: null, bookedBy: null,
          location: f.location.trim(), createdBy: profile.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }));
        addAudit(batch, profile, 'slots.published', 'slots', '', `${fresh.length} slots from ${f.date}`);
        await batch.commit();
      }
    }, `${fresh.length} slots published`);
  }

  const upcoming = slots.data.filter((s) => toDate(s.end) >= new Date());
  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <Card title="Publish availability">
        <div className="form">
          <Field label="Starting date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Repeat weekly for"><select value={f.weeks} onChange={(e) => setF({ ...f, weeks: e.target.value })}>
            {[1, 2, 3, 4, 6, 8, 12].map((n) => <option key={n} value={n}>{n} week{n > 1 ? 's' : ''}</option>)}</select></Field>
          <Field label="From"><input type="time" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="To"><input type="time" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          <Field label="Slot length"><select value={f.length} onChange={(e) => setF({ ...f, length: e.target.value })}>
            {[15, 20, 30, 45, 60, 90].map((n) => <option key={n} value={n}>{n} minutes</option>)}</select></Field>
          <Field label="Location"><input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>{fresh.length} new slot{fresh.length === 1 ? '' : 's'} will be added{proposed.length !== fresh.length ? ` (${proposed.length - fresh.length} skipped: overlapping or past)` : ''}.</p>
        <Button busy={busy} onClick={publish} disabled={!fresh.length}>Publish slots</Button>
        <ErrorNote error={error} />
      </Card>
      <Card title="Upcoming slots" pad={false}>
        <ErrorNote error={del.error} />
        {slots.loading ? <Loading /> : !upcoming.length ? <Empty title="No slots published" /> : (
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            {groupByDay(upcoming).map(([day, list]) => (
              <div key={day} style={{ padding: '0 18px 10px' }}>
                <div className="day-head">{fmtDate(fromInputDate(day), { weekday: 'long' })}</div>
                <div className="slot-grid">
                  {list.map((s) => (
                    <div key={s.id} className={`slot ${s.status}`}>
                      <div className="t">{fmtTime(s.start)}–{fmtTime(s.end)}</div>
                      <div className="s">{s.status === 'booked' ? 'Booked' : s.status === 'blocked' ? 'Blocked' : 'Open'}</div>
                      {s.status !== 'booked' && (
                        <div className="row" style={{ gap: 4, marginTop: 6 }}>
                          <button className="linkish small" onClick={() => del.run(() => updateDoc(doc(db, 'slots', s.id), { status: s.status === 'open' ? 'blocked' : 'open', updatedAt: serverTimestamp() }))}>{s.status === 'open' ? 'Block' : 'Unblock'}</button>
                          <button className="linkish small" style={{ color: 'var(--red)' }} onClick={() => del.run(() => deleteDoc(doc(db, 'slots', s.id)))}>Remove</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function MeetingNotes({ appts }) {
  const { profile } = useAuth();
  const pastor = can(profile, 'pastor');
  const notes = useLive(() => pastor ? col('meetingNotes') : query(col('meetingNotes'), where('confidential', '==', false)), [pastor]);
  const [editing, setEditing] = useState(null);
  const [taskFor, setTaskFor] = useState(null);
  const rows = [...notes.data].sort((a, b) => toDate(b.date) - toDate(a.date));
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <Button onClick={() => setEditing({})}>New meeting note</Button>
        <span className="muted small">{pastor ? 'Notes marked confidential are visible only to you.' : 'You can see non-confidential notes.'}</span>
      </div>
      <ErrorNote error={notes.error} />
      {notes.loading ? <Loading /> : !rows.length ? <Card><Empty title="No meeting notes yet">Record what was discussed, decisions made, and turn follow-ups into tasks.</Empty></Card> : (
        <div className="stack">{rows.map((n) => (
          <Card key={n.id} title={<>{n.title} {n.confidential && <Badge tone="red">confidential</Badge>}</>}
            actions={<>
              <Button size="sm" variant="ghost" onClick={() => setTaskFor(n)}>Create follow-up task</Button>
              {(pastor || !n.confidential) && <Button size="sm" variant="secondary" onClick={() => setEditing(n)}>Edit</Button>}
            </>}>
            <p className="muted small">{fmtDate(n.date)}{n.attendees ? ` · ${n.attendees}` : ''} · recorded by {n.createdByName}</p>
            {n.notes && <p className="pre">{n.notes}</p>}
            {n.decisions && <><h3 style={{ margin: '10px 0 4px' }}>Decisions</h3><ul style={{ margin: 0, paddingLeft: 20 }}>{n.decisions.split('\n').filter(Boolean).map((d, i) => <li key={i}>{d}</li>)}</ul></>}
          </Card>
        ))}</div>
      )}
      <NoteModal open={!!editing} existing={editing?.id ? editing : null} onClose={() => setEditing(null)} appts={appts} />
      <TaskForm open={!!taskFor} onClose={() => setTaskFor(null)} preset={taskFor ? { title: `Follow-up: ${taskFor.title}`, source: { type: 'meeting', id: taskFor.id, label: taskFor.title } } : {}} />
    </>
  );
}

function NoteModal({ open, existing, onClose, appts }) {
  const { profile } = useAuth();
  const pastor = can(profile, 'pastor');
  const { busy, error, setError, run } = useAction();
  const [f, setF] = useState({});
  useEffect(() => {
    if (!open) return;
    setError(null);
    setF(existing ? { title: existing.title, date: toInputDate(existing.date), attendees: existing.attendees || '', notes: existing.notes || '', decisions: existing.decisions || '', confidential: !!existing.confidential, appointmentId: existing.appointmentId || '' }
      : { title: '', date: toInputDate(new Date()), attendees: '', notes: '', decisions: '', confidential: false, appointmentId: '' });
     
  }, [open, existing?.id]);
  const recent = appts.filter((a) => ['booked', 'completed'].includes(a.status) && toDate(a.start) <= addDays(new Date(), 1)).slice(-20).reverse();

  async function save() {
    if (!f.title.trim()) return setError('Add a title.');
    const data = {
      title: f.title.trim(), date: Timestamp.fromDate(fromInputDate(f.date)), attendees: f.attendees.trim(), notes: f.notes.trim(),
      decisions: f.decisions.trim(), confidential: pastor ? f.confidential : false, appointmentId: f.appointmentId || null, updatedAt: serverTimestamp(),
    };
    const ok = await run(async () => {
      const batch = writeBatch(db);
      if (existing) batch.update(doc(db, 'meetingNotes', existing.id), data);
      else batch.set(doc(collection(db, 'meetingNotes')), { ...data, createdBy: profile.uid, createdByName: profile.name, createdAt: serverTimestamp() });
      await batch.commit();
    }, 'Note saved');
    if (ok) onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit meeting note' : 'New meeting note'} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
      <div className="form">
        <Field label="Title"><input value={f.title || ''} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Meeting with Youth leaders" /></Field>
        <Field label="Date"><input type="date" value={f.date || ''} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Linked appointment (optional)">
          <select value={f.appointmentId || ''} onChange={(e) => {
            const a = appts.find((x) => x.id === e.target.value);
            setF({ ...f, appointmentId: e.target.value, ...(a && !f.title ? { title: `Meeting with ${a.attendeeName}`, attendees: a.attendeeName, date: toInputDate(a.start) } : {}) });
          }}>
            <option value="">None</option>{recent.map((a) => <option key={a.id} value={a.id}>{fmtDateTime(a.start)} — {a.attendeeName}</option>)}
          </select>
        </Field>
        <Field label="Attendees"><input value={f.attendees || ''} onChange={(e) => setF({ ...f, attendees: e.target.value })} /></Field>
        <Field label="Notes" full><textarea rows={5} value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <Field label="Decisions (one per line)" full><textarea value={f.decisions || ''} onChange={(e) => setF({ ...f, decisions: e.target.value })} /></Field>
        {pastor && <label className="check full"><input type="checkbox" checked={!!f.confidential} onChange={(e) => setF({ ...f, confidential: e.target.checked })} /> Confidential — only I can see this note</label>}
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}
