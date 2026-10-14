import { useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { doc, getDocs, limit, orderBy, query, serverTimestamp, writeBatch, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { slugify } from '../Onboarding.jsx';
import { updateDoc } from 'firebase/firestore';
import { useAuth } from '../../AuthContext.jsx';
import { col, useLive, addAudit, addNotify } from '../../lib/db.js';
import { ROLES, isAdmin, can } from '../../lib/roles.js';
import { fmtDateTime, toDate, toInputDate } from '../../lib/dates.js';
import { download } from '../../lib/csv.js';
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader, Tabs, useAction } from '../../components/ui.jsx';
import { bcol, bdoc } from '../../lib/db.js';

export default function Admin() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'users';
  if (!isAdmin(profile)) return <Navigate to="/" replace />;
  return (
    <>
      <PageHeader title="Administration" subtitle={`${profile.branchName} — people, roles, ministries, audit history and backups.`} />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { value: 'users', label: 'People & roles' }, { value: 'ministries', label: 'Ministries' },
        { value: 'audit', label: 'Audit history' }, { value: 'backup', label: 'Backup' },
        { value: 'branches', label: profile.isSuperAdmin ? 'Branches' : 'Branch details' },
      ]} />
      {tab === 'users' && <Users />}
      {tab === 'ministries' && <Ministries />}
      {tab === 'audit' && <Audit />}
      {tab === 'backup' && <Backup />}
      {tab === 'branches' && <Branches />}
    </>
  );
}

function Users() {
  const users = useLive(() => col('members'), []);
  const ministries = useLive(() => col('ministries'), []);
  const [editing, setEditing] = useState(null);
  const rows = useMemo(() => [...users.data].sort((a, b) => Number(a.active) - Number(b.active) || a.name.localeCompare(b.name)), [users.data]);
  const pending = rows.filter((u) => !u.active);
  return (
    <>
      {pending.length > 0 && <div className="warn-note" style={{ marginBottom: 12 }}>{pending.length} account{pending.length > 1 ? 's' : ''} waiting for a role. People can't see anything until you activate them.</div>}
      <ErrorNote error={users.error} />
      <Card pad={false}>
        {users.loading ? <Loading /> : (
          <ul className="list">{rows.map((u) => (
            <li key={u.id} className="list-item clickable" onClick={() => setEditing(u)}>
              <div className="list-main">
                <div className="list-title">{u.name}</div>
                <div className="list-meta">{u.email}{u.ministryName ? ` · ${u.ministryName}` : ''}</div>
              </div>
              <div className="list-side row" style={{ gap: 4 }}>
                {!u.active ? <Badge tone="amber">{(u.roles || []).length ? 'deactivated' : 'awaiting role'}</Badge>
                  : (u.roles || []).map((r) => <Badge key={r} tone={r === 'admin' ? 'violet' : r === 'pastor' ? 'blue' : r === 'finance' ? 'green' : 'grey'}>{ROLES[r]}</Badge>)}
              </div>
            </li>
          ))}</ul>
        )}
      </Card>
      <UserModal u={editing} onClose={() => setEditing(null)} ministries={ministries.data} />
    </>
  );
}

function UserModal({ u, onClose, ministries }) {
  const { profile } = useAuth();
  const { busy, error, setError, run } = useAction();
  const [f, setF] = useState({});
  useEffect(() => { if (u) { setError(null); setF({ roles: u.roles?.length ? u.roles : ['member'], active: u.roles?.length ? u.active : true, ministryId: u.ministryId || '' }); } }, [u, setError]);
  if (!u) return null;
  const self = u.id === profile.uid;
  const toggle = (r) => setF({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] });

  async function save() {
    if (!f.roles.length) return setError('Give at least one role.');
    if (self && !f.roles.includes('admin')) return setError('You cannot remove your own administrator role.');
    const m = ministries.find((x) => x.id === f.ministryId);
    const ok = await run(async () => {
      const batch = writeBatch(db);
      batch.update(bdoc('members', u.id), { roles: f.roles, active: f.active, ministryId: f.ministryId, ministryName: m?.name || '', updatedAt: serverTimestamp() });
      addAudit(batch, profile, 'user.updated', 'user', u.id, `${u.name}: ${f.active ? 'active' : 'inactive'} — ${f.roles.join(', ')}`);
      if (!u.active && f.active) addNotify(batch, profile, u.id, 'Welcome to Pastor\'s Desk', `Your account is active as: ${f.roles.map((r) => ROLES[r]).join(', ')}`, '/');
      await batch.commit();
    }, 'Saved');
    if (ok) onClose();
  }

  return (
    <Modal open title={u.name} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>{u.active ? 'Save' : f.active ? 'Activate' : 'Save'}</Button></>}>
      <p className="muted">{u.email}</p>
      <div className="stack">
        <div>
          <span className="field-label">Roles</span>
          <div className="stack" style={{ gap: 6, marginTop: 6 }}>
            {Object.entries(ROLES).map(([k, v]) => (
              <label key={k} className="check"><input type="checkbox" checked={f.roles?.includes(k) || false} onChange={() => toggle(k)} disabled={self && k === 'admin'} />
                <span><strong>{v}</strong> <span className="muted small">— {{
                  admin: 'manages people, roles, ministries and backups',
                  pastor: 'approves finances, sees everything pastoral, private notes',
                  assistant: 'manages the diary, reviews reports, follow-ups',
                  finance: 'records payments, income and reconciliations',
                  leader: 'submits ministry reports and requests',
                  member: 'books appointments, submits requests and prayer requests',
                }[k]}</span></span></label>
            ))}
          </div>
        </div>
        <Field label="Ministry / department">
          <select value={f.ministryId || ''} onChange={(e) => setF({ ...f, ministryId: e.target.value })}>
            <option value="">None</option>{ministries.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        {!self && <label className="check"><input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Account active</label>}
        {f.roles?.includes('pastor') && <div className="info-note">Only the pastor role can approve financial requests and read private pastoral notes.</div>}
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

function Ministries() {
  const { profile } = useAuth();
  const ministries = useLive(() => col('ministries'), []);
  const users = useLive(() => col('members'), []);
  const { busy, error, run } = useAction();
  const [name, setName] = useState('');
  const active = users.data.filter((u) => u.active).sort((a, b) => a.name.localeCompare(b.name));
  const rows = [...ministries.data].sort((a, b) => a.name.localeCompare(b.name));
  async function add() {
    if (!name.trim()) return;
    if (await run(() => writeBatch(db).set(doc(bcol('ministries')), { name: name.trim(), leaderUid: '', createdAt: serverTimestamp() }).commit(), 'Ministry added')) setName('');
  }
  async function setLeader(m, uid) {
    await run(async () => {
      const b = writeBatch(db);
      b.update(bdoc('ministries', m.id), { leaderUid: uid, updatedAt: serverTimestamp() });
      addAudit(b, profile, 'ministry.leader', 'ministry', m.id, `${m.name} → ${active.find((u) => u.id === uid)?.name || 'none'}`);
      await b.commit();
    }, 'Leader updated');
  }
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder="New ministry, e.g. Youth Ministry" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} style={{ maxWidth: 320 }} />
        <Button busy={busy} onClick={add}>Add ministry</Button>
      </div>
      <p className="muted small">Each ministry's leader receives its report requests. Give leaders the "Ministry Leader" role in People & roles.</p>
      <ErrorNote error={error || ministries.error} />
      <Card pad={false}>
        {ministries.loading ? <Loading /> : !rows.length ? <Empty title="No ministries yet" /> : (
          <ul className="list">{rows.map((m) => (
            <li key={m.id} className="list-item">
              <div className="list-main"><div className="list-title">{m.name}</div></div>
              <select value={m.leaderUid || ''} onChange={(e) => setLeader(m, e.target.value)} style={{ width: 'auto', maxWidth: 220 }} aria-label={`Leader of ${m.name}`}>
                <option value="">No leader</option>{active.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <button className="icon-btn" onClick={() => window.confirm(`Remove ${m.name}?`) && run(() => deleteDoc(bdoc('ministries', m.id)))} aria-label="Remove ministry">🗑</button>
            </li>
          ))}</ul>
        )}
      </Card>
    </>
  );
}

function Audit() {
  const [n, setN] = useState(200);
  const logs = useLive(() => query(col('audit'), orderBy('at', 'desc'), limit(n)), [n]);
  const [q, setQ] = useState('');
  const rows = logs.data.filter((l) => !q || `${l.action} ${l.details} ${l.actorName}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder="Search history" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <span className="muted small">The audit history is permanent — entries can't be edited or deleted by anyone.</span>
      </div>
      <ErrorNote error={logs.error} />
      <Card pad={false}>
        {logs.loading ? <Loading /> : !rows.length ? <Empty title="No history yet" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
            <tbody>{rows.map((l) => <tr key={l.id}><td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(l.at)}</td><td>{l.actorName}</td><td><code>{l.action}</code></td><td>{l.details}</td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
      {logs.data.length >= n && <div style={{ marginTop: 12 }}><Button variant="secondary" onClick={() => setN(n + 300)}>Load more</Button></div>}
    </>
  );
}

const BACKUP_COLLECTIONS = ['members', 'ministries', 'funds', 'requests', 'transactions', 'reconciliations', 'slots', 'appointments', 'reportTemplates', 'reports', 'tasks', 'audit'];

function serialize(v) {
  if (v && typeof v.toDate === 'function') return { __ts: toDate(v).toISOString() };
  if (Array.isArray(v)) return v.map(serialize);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, serialize(x)]));
  return v;
}

function Backup() {
  const { profile } = useAuth();
  const { busy, error, run } = useAction();
  const [result, setResult] = useState(null);
  async function exportAll() {
    await run(async () => {
      const out = { exportedAt: new Date().toISOString(), exportedBy: profile.email, branch: profile.branchId, collections: {} };
      const counts = {};
      for (const name of BACKUP_COLLECTIONS) {
        const snap = await getDocs(bcol(name));
        out.collections[`branches/${profile.branchId}/${name}`] = snap.docs.map((d) => ({ id: d.id, ...serialize(d.data()) }));
        counts[name] = snap.size;
      }
      download(`pastors-desk-${profile.branchId}-backup-${toInputDate(new Date())}.json`, JSON.stringify(out, null, 1), 'application/json');
      setResult(counts);
    }, 'Backup downloaded');
  }
  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <Card title="Download a backup">
        <p>Downloads a JSON copy of all operational data (finance, meetings, reports, tasks, people and audit history). Store it somewhere safe, e.g. a private Google Drive folder. Do this at least monthly.</p>
        <p className="muted small">For privacy, pastoral follow-ups, prayer requests, meeting notes and private notes are not included here. They are covered by the full backup script described in the README.</p>
        <Button busy={busy} onClick={exportAll}>Download backup</Button>
        <ErrorNote error={error} />
        {result && <p className="small" style={{ marginTop: 10 }}>{Object.entries(result).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>}
      </Card>
      <Card title="Recovery">
        <p className="small">Full backups and restores use the scripts in the project's <code>scripts/</code> folder with a Firebase service-account key. Step-by-step instructions are in <strong>docs/BACKUP_AND_RECOVERY.md</strong>.</p>
        {can(profile, 'pastor') ? null : <p className="small muted">Ask the developer to run the full backup each month.</p>}
      </Card>
    </div>
  );
}

function Branches() {
  const { profile, branches, switchBranch } = useAuth();
  const { busy, error, setError, run } = useAction();
  const [f, setF] = useState({ name: '', location: '', id: '' });
  const [edit, setEdit] = useState(null);
  const id = f.id || slugify(f.name.replace(/^the elevation church\W*/i, ''));
  const origin = window.location.origin;

  async function create() {
    if (f.name.trim().length < 2) return setError('Give the branch a name.');
    if (branches.some((b) => b.id === id)) return setError('That short code is already used. Choose another.');
    const ok = await run(async () => {
      const batch = writeBatch(db);
      batch.set(doc(db, 'branches', id), { name: f.name.trim(), location: f.location.trim(), createdBy: profile.uid, createdAt: serverTimestamp() });
      batch.set(doc(db, 'branches', id, 'members', profile.uid), {
        name: profile.name, email: profile.email, phone: profile.phone || '', roles: ['admin'], active: true, ministryId: '', ministryName: '', createdAt: serverTimestamp(),
      });
      await batch.commit();
    }, 'Branch created');
    if (ok) setF({ name: '', location: '', id: '' });
  }

  return (
    <div className="grid detail-grid">
      <Card title={profile.isSuperAdmin ? 'Branches' : 'This branch'} pad={false}>
        <ul className="list">{branches.filter((b) => profile.isSuperAdmin || b.id === profile.branchId).map((b) => (
          <li key={b.id} className="list-item">
            <div className="list-main">
              <div className="list-title">{b.name} {b.id === profile.branchId && <Badge tone="blue">current</Badge>}</div>
              <div className="list-meta">{b.location ? `${b.location} · ` : ''}Public page: <a href={`${origin}/connect/${b.id}`} target="_blank" rel="noreferrer">{origin.replace(/^https?:\/\//, '')}/connect/{b.id}</a></div>
            </div>
            <div className="list-side row">
              {b.id !== profile.branchId && <Button size="sm" variant="secondary" onClick={() => switchBranch(b.id)}>Switch to</Button>}
              <Button size="sm" variant="ghost" onClick={() => setEdit({ ...b })}>Edit</Button>
            </div>
          </li>
        ))}</ul>
      </Card>
      {profile.isSuperAdmin && (
        <Card title="Add a branch">
          <div className="stack">
            <Field label="Branch name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. The Elevation Church · Abeokuta" /></Field>
            <Field label="Location (optional)"><input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
            <Field label="Short code" hint={`Public link: ${origin.replace(/^https?:\/\//, '')}/connect/${id || '…'}. Can't be changed later.`}>
              <input value={id} onChange={(e) => setF({ ...f, id: slugify(e.target.value) })} />
            </Field>
            <Button busy={busy} onClick={create}>Create branch</Button>
            <ErrorNote error={error} />
            <p className="muted small">Each branch is completely separate: its own funds, diary, reports, people and roles. You'll be its administrator; invite its pastor, assistant and finance officer to sign up and choose the branch, then give them roles in People &amp; roles.</p>
          </div>
        </Card>
      )}
      {edit && (
        <Modal open title="Edit branch" onClose={() => setEdit(null)}
          footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            <Button busy={busy} onClick={async () => { if (await run(() => updateDoc(doc(db, 'branches', edit.id), { name: edit.name.trim(), location: (edit.location || '').trim(), updatedAt: serverTimestamp() }), 'Saved')) setEdit(null); }}>Save</Button></>}>
          <div className="stack">
            <Field label="Branch name"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Location"><input value={edit.location || ''} onChange={(e) => setEdit({ ...edit, location: e.target.value })} /></Field>
            <p className="muted small">Short code: {edit.id}</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
