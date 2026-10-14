import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, serverTimestamp, Timestamp, writeBatch, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useAuth } from '../AuthContext.jsx';
import { col, query, where, useLive, addNotify, addAudit } from '../lib/db.js';
import { can } from '../lib/roles.js';
import { useUsers } from '../lib/users.js';
import { fmtDate, fromInputDate, isOverdue, toDate, toInputDate, relative } from '../lib/dates.js';
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader, Tabs, useAction } from '../components/ui.jsx';
import { bcol, bdoc } from '../lib/db.js';

const SOURCE_LINK = {
  request: (id) => `/finance/requests/${id}`,
  report: (id) => `/reports/${id}`,
  meeting: () => '/meetings?tab=notes',
  followup: () => '/pastor?tab=followups',
};

export function TaskForm({ open, onClose, preset = {}, existing }) {
  const { profile } = useAuth();
  const users = useUsers();
  const { busy, error, setError, run } = useAction();
  const [f, setF] = useState({});
  useEffect(() => {
    if (!open) return;
    setError(null);
    setF(existing ? {
      title: existing.title, description: existing.description || '', assigneeUid: existing.assigneeUid,
      priority: existing.priority, dueDate: toInputDate(existing.dueDate),
    } : { title: preset.title || '', description: preset.description || '', assigneeUid: preset.assigneeUid || '', priority: 'medium', dueDate: '' });
     
  }, [open, existing?.id]);

  async function save() {
    if (!f.title.trim()) return setError('Give the task a title.');
    if (!f.assigneeUid) return setError('Choose who it is assigned to.');
    const assignee = users.find((u) => u.uid === f.assigneeUid);
    const ok = await run(async () => {
      const batch = writeBatch(db);
      const ref = existing ? bdoc('tasks', existing.id) : doc(bcol('tasks'));
      const data = {
        title: f.title.trim(), description: f.description.trim(), assigneeUid: f.assigneeUid, assigneeName: assignee?.name || '',
        priority: f.priority, dueDate: f.dueDate ? Timestamp.fromDate(fromInputDate(f.dueDate, true)) : null, updatedAt: serverTimestamp(),
      };
      if (existing) batch.update(ref, data);
      else batch.set(ref, { ...data, status: 'todo', source: preset.source || null, createdBy: profile.uid, createdByName: profile.name, createdAt: serverTimestamp(), completedAt: null, progressNote: '' });
      if (!existing || existing.assigneeUid !== f.assigneeUid) {
        addNotify(batch, profile, f.assigneeUid, `New task: ${data.title}`, f.dueDate ? `Due ${fmtDate(fromInputDate(f.dueDate))}` : '', '/tasks');
      }
      addAudit(batch, profile, existing ? 'task.updated' : 'task.created', 'task', ref.id, `${data.title} → ${data.assigneeName}`);
      await batch.commit();
    }, existing ? 'Task updated' : 'Task assigned');
    if (ok) onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit task' : 'Assign a task'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>{existing ? 'Save' : 'Assign task'}</Button></>}>
      {preset.source && <p className="muted small">Linked to: {preset.source.label}</p>}
      <div className="form">
        <Field label="Task" full><input value={f.title || ''} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Assign to">
          <select value={f.assigneeUid || ''} onChange={(e) => setF({ ...f, assigneeUid: e.target.value })}>
            <option value="">Choose…</option>
            {users.map((u) => <option key={u.uid} value={u.uid}>{u.name}{u.uid === profile.uid ? ' (me)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select value={f.priority || 'medium'} onChange={(e) => setF({ ...f, priority: e.target.value })}>
            <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>
        </Field>
        <Field label="Due date"><input type="date" value={f.dueDate || ''} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        <Field label="Details" full><textarea value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

export function TaskRow({ t, onEdit }) {
  const { profile } = useAuth();
  const { busy, error, run } = useAction();
  const overdue = t.status !== 'done' && isOverdue(t.dueDate);
  const canEdit = t.createdBy === profile.uid || can(profile, 'pastor', 'admin');
  const canStatus = t.assigneeUid === profile.uid || canEdit;

  async function setStatus(status) {
    await run(async () => {
      const batch = writeBatch(db);
      batch.update(bdoc('tasks', t.id), { status, completedAt: status === 'done' ? serverTimestamp() : null, updatedAt: serverTimestamp() });
      if (status === 'done') addNotify(batch, profile, t.createdBy, `Task completed: ${t.title}`, `by ${profile.name}`, '/tasks');
      addAudit(batch, profile, `task.${status}`, 'task', t.id, t.title);
      await batch.commit();
    });
  }

  return (
    <li className="list-item">
      <div className="list-main">
        <div className="list-title" style={t.status === 'done' ? { textDecoration: 'line-through', color: 'var(--muted)' } : {}}>{t.title}</div>
        <div className="list-meta">
          {t.assigneeName}{t.createdByName && t.createdBy !== t.assigneeUid ? ` · from ${t.createdByName}` : ''}
          {t.dueDate && <> · <span style={overdue ? { color: 'var(--red)', fontWeight: 500 } : {}}>due {fmtDate(t.dueDate)} ({relative(t.dueDate)})</span></>}
          {t.source && SOURCE_LINK[t.source.type] && <> · <Link to={SOURCE_LINK[t.source.type](t.source.id)}>{t.source.label}</Link></>}
        </div>
        {t.description && <div className="small pre" style={{ marginTop: 4 }}>{t.description}</div>}
        <ErrorNote error={error} />
      </div>
      <div className="list-side row">
        <Badge status={t.priority}>{t.priority}</Badge>
        {overdue ? <Badge status="overdue">overdue</Badge> : <Badge status={t.status}>{t.status.replace('_', ' ')}</Badge>}
        {canStatus && (
          <select value={t.status} disabled={busy} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }} aria-label="Status">
            <option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option>
          </select>
        )}
        {canEdit && onEdit && <button className="icon-btn" onClick={() => onEdit(t)} aria-label="Edit task">✎</button>}
        {t.createdBy === profile.uid && <button className="icon-btn" onClick={() => window.confirm('Delete this task?') && deleteDoc(bdoc('tasks', t.id))} aria-label="Delete task">🗑</button>}
      </div>
    </li>
  );
}

export default function Tasks() {
  const { profile } = useAuth();
  const all = can(profile, 'pastor', 'admin');
  const [tab, setTab] = useState('mine');
  const [modal, setModal] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const mine = useLive(() => query(col('tasks'), where('assigneeUid', '==', profile.uid)), [profile.uid]);
  const created = useLive(() => query(col('tasks'), where('createdBy', '==', profile.uid)), [profile.uid]);
  const everyone = useLive(() => all ? col('tasks') : null, [all]);
  const src = tab === 'mine' ? mine : tab === 'created' ? created : everyone;
  const rows = useMemo(() => src.data.filter((t) => showDone || t.status !== 'done').sort((a, b) => {
    if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1;
    const pr = { high: 0, medium: 1, low: 2 };
    return (toDate(a.dueDate) || 8e15) - (toDate(b.dueDate) || 8e15) || pr[a.priority] - pr[b.priority];
  }), [src.data, showDone]);
  const openCount = (s) => s.data.filter((t) => t.status !== 'done').length;
  const overdueCount = src.data.filter((t) => t.status !== 'done' && isOverdue(t.dueDate)).length;

  return (
    <>
      <PageHeader title="Tasks" subtitle={overdueCount ? `${overdueCount} overdue` : 'Assigned work and follow-ups'}
        actions={<Button onClick={() => setModal({})}>Assign a task</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'mine', label: 'Assigned to me', count: openCount(mine) },
        { value: 'created', label: 'Assigned by me', count: openCount(created) },
        ...(all ? [{ value: 'all', label: 'All tasks', count: openCount(everyone) }] : []),
      ]} />
      <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed</label>
      <Card pad={false}>
        <ErrorNote error={src.error} />
        {src.loading ? <Loading /> : !rows.length ? <Empty title="Nothing here">No open tasks.</Empty> : (
          <ul className="list">{rows.map((t) => <TaskRow key={t.id} t={t} onEdit={(x) => setModal({ existing: x })} />)}</ul>
        )}
      </Card>
      <TaskForm open={!!modal} existing={modal?.existing} onClose={() => setModal(null)} />
    </>
  );
}
