import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { collection, doc, serverTimestamp, Timestamp, updateDoc, writeBatch, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useAuth } from '../../AuthContext.jsx';
import { useWork } from '../../WorkContext.jsx';
import { col, query, where, useLive, addNotify } from '../../lib/db.js';
import { can } from '../../lib/roles.js';
import { useUsers, usersWithRole } from '../../lib/users.js';
import { formatNGN } from '../../lib/money.js';
import { addDays, fmtDate, fmtDateTime, fmtTime, fromInputDate, isOverdue, startOfDay, toDate, toInputDate, relative } from '../../lib/dates.js';
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader, Stat, Tabs, useAction } from '../../components/ui.jsx';
import { TaskForm } from '../Tasks.jsx';

export default function Pastor() {
  const { profile } = useAuth();
  const pastor = can(profile, 'pastor');
  const care = can(profile, 'pastor', 'assistant');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || (care ? 'overview' : 'prayer');
  const setTab = (t) => setParams({ tab: t });
  const work = useWork();
  const tabs = [
    ...(care ? [{ value: 'overview', label: 'Overview' }, { value: 'followups', label: 'Pastoral follow-ups', count: work.followupsDue.length }] : []),
    { value: 'prayer', label: 'Prayer & testimonies', count: care ? work.newPrayers.length : 0 },
    ...(pastor ? [{ value: 'notes', label: 'Private notes' }] : []),
  ];
  return (
    <>
      <PageHeader title={care ? 'Pastor' : 'Prayer & testimonies'} subtitle={care ? 'Commitments, pastoral care and confidential records.' : 'Share a prayer request or testimony with the Resident Pastor.'} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'overview' && care && <Overview />}
      {tab === 'followups' && care && <Followups />}
      {tab === 'prayer' && <Prayers />}
      {tab === 'notes' && pastor && <PrivateNotes />}
    </>
  );
}

function Overview() {
  const { profile } = useAuth();
  const work = useWork();
  const pastor = can(profile, 'pastor');
  const created = useLive(() => query(col('tasks'), where('createdBy', '==', profile.uid)), [profile.uid]);
  const today = startOfDay(new Date());
  const weekEnd = addDays(today, 7);
  const todays = work.upcoming.filter((a) => toDate(a.start) < addDays(today, 1));
  const week = work.upcoming.filter((a) => toDate(a.start) >= addDays(today, 1) && toDate(a.start) < weekEnd);
  const delegated = created.data.filter((t) => t.status !== 'done' && t.assigneeUid !== profile.uid);

  return (
    <>
      <div className="grid grid-4">
        <Stat label="Appointments today" value={todays.length} />
        <Stat label="Next 7 days" value={week.length} />
        {pastor ? <Stat label="Approvals waiting" value={work.approvals.length} tone={work.approvals.length ? 'amber' : ''} />
          : <Stat label="Reports to review" value={work.toReview.length} />}
        <Stat label="Follow-ups due" value={work.followupsDue.length} tone={work.followupsDue.length ? 'amber' : ''} />
      </div>
      <div className="grid grid-2 section-gap" style={{ alignItems: 'start' }}>
        <Card title="Today" pad={false} actions={<Link to="/meetings?tab=diary" className="small">Diary →</Link>}>
          {!todays.length ? <Empty title="No appointments today" /> : <ul className="list">{todays.map((a) => (
            <li key={a.id} className="list-item"><div className="list-main"><div className="list-title">{fmtTime(a.start)} — {a.attendeeName}</div><div className="list-meta">{a.purpose}</div></div></li>
          ))}</ul>}
        </Card>
        <Card title="This week" pad={false}>
          {!week.length ? <Empty title="Nothing else this week" /> : <ul className="list">{week.map((a) => (
            <li key={a.id} className="list-item"><div className="list-main"><div className="list-title">{fmtDate(a.start, { weekday: 'short' })} {fmtTime(a.start)} — {a.attendeeName}</div><div className="list-meta">{a.purpose}</div></div></li>
          ))}</ul>}
        </Card>
        {pastor && (
          <Card title="Waiting for your approval" pad={false} actions={<Link to="/finance?tab=requests" className="small">Finance →</Link>}>
            {!work.approvals.length ? <Empty title="No pending approvals" /> : <ul className="list">{work.approvals.map((r) => (
              <li key={r.id} className="list-item"><div className="list-main"><Link to={`/finance/requests/${r.id}`} className="list-title">{r.title}</Link><div className="list-meta">{r.requestedByName} · {r.fundName}</div></div><div className="list-side mono">{formatNGN(r.amount)}</div></li>
            ))}</ul>}
          </Card>
        )}
        <Card title="Work I've delegated" pad={false} actions={<Link to="/tasks" className="small">Tasks →</Link>}>
          {!delegated.length ? <Empty title="Nothing outstanding" /> : <ul className="list">{delegated.slice(0, 8).map((t) => (
            <li key={t.id} className="list-item"><div className="list-main"><div className="list-title">{t.title}</div>
              <div className="list-meta">{t.assigneeName}{t.dueDate ? ` · due ${fmtDate(t.dueDate)}` : ''}</div></div>
              {isOverdue(t.dueDate) ? <Badge status="overdue">overdue</Badge> : <Badge status={t.status}>{t.status.replace('_', ' ')}</Badge>}</li>
          ))}</ul>}
        </Card>
      </div>
    </>
  );
}

function Followups() {
  const all = useLive(() => col('followups'), []);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState(null);
  const [task, setTask] = useState(null);
  const done = useAction();
  const rows = useMemo(() => all.data.filter((f) => showDone || f.status === 'open')
    .sort((a, b) => (toDate(a.dueDate) || 8e15) - (toDate(b.dueDate) || 8e15)), [all.data, showDone]);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <Button onClick={() => setEditing({})}>New follow-up</Button>
        <label className="check"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed</label>
      </div>
      <ErrorNote error={all.error || done.error} />
      <Card pad={false}>
        {all.loading ? <Loading /> : !rows.length ? <Empty title="No follow-ups">Track people to visit, call or check on — bereavement, hospital visits, new converts, counselling.</Empty> : (
          <ul className="list">{rows.map((f) => (
            <li key={f.id} className="list-item">
              <div className="list-main">
                <div className="list-title">{f.person} <span className="muted small">— {f.reason}</span></div>
                <div className="list-meta">{f.contact}{f.dueDate ? ` · ${f.status === 'open' && isOverdue(f.dueDate) ? 'was due' : 'due'} ${fmtDate(f.dueDate)} (${relative(f.dueDate)})` : ''}{f.assignedTo ? ` · ${f.assignedTo}` : ''}</div>
                {f.notes && <div className="small pre">{f.notes}</div>}
              </div>
              <div className="list-side row">
                {f.status === 'open' && isOverdue(f.dueDate) && <Badge status="overdue">overdue</Badge>}
                {f.status === 'done' && <Badge status="done">done</Badge>}
                <Button size="sm" variant="ghost" onClick={() => setTask(f)}>Delegate</Button>
                <Button size="sm" variant="secondary" onClick={() => setEditing(f)}>Edit</Button>
                {f.status === 'open' && <Button size="sm" variant="success" busy={done.busy} onClick={() => done.run(() => updateDoc(doc(db, 'followups', f.id), { status: 'done', doneAt: serverTimestamp(), updatedAt: serverTimestamp() }), 'Marked done')}>Done</Button>}
              </div>
            </li>
          ))}</ul>
        )}
      </Card>
      <FollowupModal f={editing} onClose={() => setEditing(null)} />
      <TaskForm open={!!task} onClose={() => setTask(null)} preset={task ? { title: `Follow up with ${task.person}`, description: task.reason, source: { type: 'followup', id: task.id, label: task.person } } : {}} />
    </>
  );
}

function FollowupModal({ f: existing, onClose }) {
  const { profile } = useAuth();
  const { busy, error, setError, run } = useAction();
  const [f, setF] = useState({});
  useEffect(() => {
    if (!existing) return;
    setError(null);
    setF({ person: existing.person || '', contact: existing.contact || '', reason: existing.reason || '', dueDate: existing.dueDate ? toInputDate(existing.dueDate) : toInputDate(addDays(new Date(), 2)), notes: existing.notes || '', status: existing.status || 'open' });
     
  }, [existing?.id, !!existing]);
  if (!existing) return null;
  async function save() {
    if (!f.person.trim() || !f.reason.trim()) return setError('Who, and why?');
    const data = { person: f.person.trim(), contact: f.contact.trim(), reason: f.reason.trim(), notes: f.notes.trim(), status: f.status,
      dueDate: f.dueDate ? Timestamp.fromDate(fromInputDate(f.dueDate, true)) : null, updatedAt: serverTimestamp() };
    const ok = await run(() => (existing.id ? updateDoc(doc(db, 'followups', existing.id), data)
      : writeBatch(db).set(doc(collection(db, 'followups')), { ...data, createdBy: profile.uid, createdByName: profile.name, createdAt: serverTimestamp() }).commit()), 'Saved');
    if (ok) onClose();
  }
  return (
    <Modal open title={existing.id ? 'Edit follow-up' : 'New pastoral follow-up'} onClose={onClose}
      footer={<>{existing.id && <Button variant="ghost" onClick={() => run(() => deleteDoc(doc(db, 'followups', existing.id))).then((ok) => ok && onClose())}>Delete</Button>}
        <span className="spacer" /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
      <div className="form">
        <Field label="Person"><input value={f.person || ''} onChange={(e) => setF({ ...f, person: e.target.value })} /></Field>
        <Field label="Phone / contact"><input value={f.contact || ''} onChange={(e) => setF({ ...f, contact: e.target.value })} /></Field>
        <Field label="Reason" full><input value={f.reason || ''} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Hospital visit, bereavement, new convert" /></Field>
        <Field label="Remind me by"><input type="date" value={f.dueDate || ''} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        <Field label="Status"><select value={f.status || 'open'} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="open">Open</option><option value="done">Done</option></select></Field>
        <Field label="Notes" full hint="Visible to the pastor and assistant. Use Private notes for confidential matters."><textarea value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

function Prayers() {
  const { profile } = useAuth();
  const pastor = can(profile, 'pastor');
  const care = can(profile, 'pastor', 'assistant');
  const users = useUsers();
  const mine = useLive(() => query(col('prayers'), where('submittedBy', '==', profile.uid)), [profile.uid]);
  const inbox = useLive(() => pastor ? col('prayers') : care ? query(col('prayers'), where('confidential', '==', false)) : null, [pastor, care]);
  const shared = useLive(() => query(col('prayers'), where('kind', '==', 'testimony'), where('status', '==', 'shared')), []);
  const [view, setView] = useState(care ? 'inbox' : 'mine');
  const [form, setForm] = useState(false);
  const act = useAction();
  const [statusFilter, setStatusFilter] = useState('active');
  const sortNew = (a, b) => (toDate(b.createdAt) || new Date()) - (toDate(a.createdAt) || new Date());
  const src = view === 'inbox' ? inbox : view === 'shared' ? shared : mine;
  const rows = src.data.filter((p) => view !== 'inbox' || statusFilter === 'all' || (statusFilter === 'active' ? ['new', 'praying'].includes(p.status) : p.status === statusFilter)).sort(sortNew);

  async function setStatus(p, status) {
    await act.run(async () => {
      const batch = writeBatch(db);
      batch.update(doc(db, 'prayers', p.id), { status, updatedAt: serverTimestamp() });
      const msg = { praying: 'The pastor is praying with you', answered: 'Marked as answered', shared: 'Your testimony has been shared with the church team' }[status];
      if (msg) addNotify(batch, profile, p.submittedBy, msg, p.content.slice(0, 80), '/pastor?tab=prayer');
      await batch.commit();
    });
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <Button onClick={() => setForm(true)}>Share a prayer request or testimony</Button>
        <span className="spacer" />
        <select value={view} onChange={(e) => setView(e.target.value)} style={{ width: 'auto' }} aria-label="View">
          {care && <option value="inbox">All requests</option>}
          <option value="mine">My submissions</option>
          <option value="shared">Shared testimonies</option>
        </select>
        {view === 'inbox' && <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 'auto' }} aria-label="Status">
          <option value="active">New & praying</option><option value="answered">Answered</option><option value="shared">Shared</option><option value="all">All</option>
        </select>}
      </div>
      <ErrorNote error={src.error || act.error} />
      <Card pad={false}>
        {src.loading ? <Loading /> : !rows.length ? <Empty title="Nothing here yet" /> : (
          <ul className="list">{rows.map((p) => (
            <li key={p.id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <div className="list-main">
                <div className="row" style={{ gap: 6 }}>
                  <Badge tone={p.kind === 'testimony' ? 'green' : 'blue'}>{p.kind}</Badge>
                  {p.confidential && <Badge tone="red">confidential</Badge>}
                  <span className="list-meta">{p.anonymous && view !== 'mine' ? 'Anonymous' : p.name} · {fmtDateTime(p.createdAt)}</span>
                </div>
                <p className="pre" style={{ margin: '6px 0 0' }}>{p.content}</p>
              </div>
              <div className="list-side row">
                <Badge status={p.status}>{p.status}</Badge>
                {view === 'inbox' && p.status === 'new' && <Button size="sm" variant="secondary" onClick={() => setStatus(p, 'praying')}>Praying</Button>}
                {view === 'inbox' && ['new', 'praying'].includes(p.status) && p.kind === 'prayer' && <Button size="sm" variant="ghost" onClick={() => setStatus(p, 'answered')}>Answered</Button>}
                {view === 'inbox' && p.kind === 'testimony' && p.status !== 'shared' && !p.confidential && <Button size="sm" variant="success" onClick={() => setStatus(p, 'shared')}>Share with team</Button>}
                {view === 'mine' && p.status === 'new' && <button className="icon-btn" onClick={() => act.run(() => deleteDoc(doc(db, 'prayers', p.id)))} aria-label="Withdraw">🗑</button>}
              </div>
            </li>
          ))}</ul>
        )}
      </Card>
      <PrayerModal open={form} onClose={() => setForm(false)} careUids={[...usersWithRole(users, 'pastor'), ...usersWithRole(users, 'assistant')].map((u) => u.uid)} />
    </>
  );
}

function PrayerModal({ open, onClose, careUids }) {
  const { profile } = useAuth();
  const users = useUsers();
  const { busy, error, setError, run } = useAction();
  const [f, setF] = useState({});
  useEffect(() => { if (open) { setError(null); setF({ kind: 'prayer', content: '', name: profile.name, confidential: false, anonymous: false }); } }, [open, profile.name, setError]);
  async function save() {
    if (!f.content.trim()) return setError('Write your request or testimony.');
    const ok = await run(async () => {
      const batch = writeBatch(db);
      batch.set(doc(collection(db, 'prayers')), {
        kind: f.kind, content: f.content.trim(), name: f.name.trim() || profile.name, confidential: f.confidential, anonymous: f.anonymous,
        status: 'new', submittedBy: profile.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      const pastorUids = usersWithRole(users, 'pastor').map((u) => u.uid);
      for (const u of (f.confidential ? pastorUids : careUids)) addNotify(batch, profile, u, `New ${f.kind === 'testimony' ? 'testimony' : 'prayer request'}`, f.anonymous ? '' : f.name, '/pastor?tab=prayer');
      await batch.commit();
    }, 'Sent — thank you');
    if (ok) onClose();
  }
  return (
    <Modal open={open} title="Prayer request or testimony" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Send</Button></>}>
      <div className="form">
        <Field label="Type"><select value={f.kind || 'prayer'} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="prayer">Prayer request</option><option value="testimony">Testimony</option></select></Field>
        <Field label="On behalf of" hint="Your name, or the person you're submitting for"><input value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={f.kind === 'testimony' ? 'Testimony' : 'Prayer request'} full><textarea rows={5} value={f.content || ''} onChange={(e) => setF({ ...f, content: e.target.value })} /></Field>
        <label className="check full"><input type="checkbox" checked={!!f.confidential} onChange={(e) => setF({ ...f, confidential: e.target.checked })} /> Confidential — only the Resident Pastor can see this</label>
        <label className="check full"><input type="checkbox" checked={!!f.anonymous} onChange={(e) => setF({ ...f, anonymous: e.target.checked })} /> Hide my name if shared</label>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

function PrivateNotes() {
  const { profile } = useAuth();
  const notes = useLive(() => query(col('pastoralNotes'), where('createdBy', '==', profile.uid)), [profile.uid]);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const rows = notes.data.filter((n) => !q || `${n.title} ${n.person} ${n.content}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (toDate(b.date) || 0) - (toDate(a.date) || 0));
  return (
    <>
      <div className="info-note" style={{ marginBottom: 12 }}>🔒 Private notes are visible only to you. Not even the administrator can read them.</div>
      <div className="row" style={{ marginBottom: 12 }}>
        <Button onClick={() => setEditing({})}>New note</Button>
        <input placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
      </div>
      <ErrorNote error={notes.error} />
      {notes.loading ? <Loading /> : !rows.length ? <Card><Empty title="No private notes" /></Card> : (
        <div className="stack">{rows.map((n) => (
          <Card key={n.id} title={n.title} actions={<Button size="sm" variant="secondary" onClick={() => setEditing(n)}>Edit</Button>}>
            <p className="muted small">{fmtDate(n.date)}{n.person ? ` · ${n.person}` : ''}</p>
            <p className="pre">{n.content}</p>
          </Card>
        ))}</div>
      )}
      <NoteModal n={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function NoteModal({ n, onClose }) {
  const { profile } = useAuth();
  const { busy, error, setError, run } = useAction();
  const [f, setF] = useState({});
  useEffect(() => {
    if (n) { setError(null); setF({ title: n.title || '', person: n.person || '', content: n.content || '', date: toInputDate(n.date || new Date()) }); }
     
  }, [n?.id, !!n]);
  if (!n) return null;
  async function save() {
    if (!f.title.trim()) return setError('Add a title.');
    const data = { title: f.title.trim(), person: f.person.trim(), content: f.content, date: Timestamp.fromDate(fromInputDate(f.date)), updatedAt: serverTimestamp() };
    const ok = await run(() => (n.id ? updateDoc(doc(db, 'pastoralNotes', n.id), data)
      : writeBatch(db).set(doc(collection(db, 'pastoralNotes')), { ...data, createdBy: profile.uid, createdAt: serverTimestamp() }).commit()), 'Note saved');
    if (ok) onClose();
  }
  return (
    <Modal open title={n.id ? 'Edit private note' : 'New private note'} onClose={onClose} wide
      footer={<>{n.id && <Button variant="ghost" onClick={() => window.confirm('Delete this note permanently?') && run(() => deleteDoc(doc(db, 'pastoralNotes', n.id))).then((ok) => ok && onClose())}>Delete</Button>}
        <span className="spacer" /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
      <div className="form">
        <Field label="Title"><input value={f.title || ''} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Date"><input type="date" value={f.date || ''} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Person (optional)" full><input value={f.person || ''} onChange={(e) => setF({ ...f, person: e.target.value })} /></Field>
        <Field label="Note" full><textarea rows={10} value={f.content || ''} onChange={(e) => setF({ ...f, content: e.target.value })} /></Field>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}
