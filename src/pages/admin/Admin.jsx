import { useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, writeBatch, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useAuth } from '../../AuthContext.jsx';
import { col, useLive, addAudit, addNotify } from '../../lib/db.js';
import { ROLES, isAdmin, can } from '../../lib/roles.js';
import { fmtDateTime, toDate, toInputDate } from '../../lib/dates.js';
import { download } from '../../lib/csv.js';
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader, Tabs, useAction } from '../../components/ui.jsx';

export default function Admin() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'users';
  if (!isAdmin(profile)) return <Navigate to="/" replace />;
  return (
    <>
      <PageHeader title="Administration" subtitle="People, roles, ministries, audit history and backups." />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { value: 'users', label: 'People & roles' }, { value: 'ministries', label: 'Ministries' },
        { value: 'audit', label: 'Audit history' }, { value: 'backup', label: 'Backup' },
      ]} />
      {tab === 'users' && <Users />}
      {tab === 'ministries' && <Ministries />}
      {tab === 'audit' && <Audit />}
      {tab === 'backup' && <Backup />}
    </>
  );
}

function Users() {
  const users = useLive(() => col('users'), []);
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
      batch.update(doc(db, 'users', u.id), { roles: f.roles, active: f.active, ministryId: f.ministryId, ministryName: m?.name || '', updatedAt: serverTimestamp() });
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
  const users = useLive(() => col('users'), []);
  const { busy, error, run } = useAction();
  const [name, setName] = useState('');
  const active = users.data.filter((u) => u.active).sort((a, b) => a.name.localeCompare(b.name));
  const rows = [...ministries.data].sort((a, b) => a.name.localeCompare(b.name));
  async function add() {
    if (!name.trim()) return;
    if (await run(() => writeBatch(db).set(doc(collection(db, 'ministries')), { name: name.trim(), leaderUid: '', createdAt: serverTimestamp() }).commit(), 'Ministry added')) setName('');
  }
  async function setLeader(m, uid) {
    await run(async () => {
      const b = writeBatch(db);
      b.update(doc(db, 'ministries', m.id), { leaderUid: uid, updatedAt: serverTimestamp() });
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
              <button className="icon-btn" onClick={() => window.confirm(`Remove ${m.name}?`) && run(() => deleteDoc(doc(db, 'ministries', m.id)))} aria-label="Remove ministry">🗑</button>
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

const BACKUP_COLLECTIONS = ['users', 'ministries', 'funds', 'requests', 'transactions', 'reconciliations', 'slots', 'appointments', 'reportTemplates', 'reports', 'tasks', 'audit'];

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
      const out = { exportedAt: new Date().toISOString(), exportedBy: profile.email, collections: {} };
      const counts = {};
      for (const name of BACKUP_COLLECTIONS) {
        const snap = await getDocs(collection(db, name));
        out.collections[name] = snap.docs.map((d) => ({ id: d.id, ...serialize(d.data()) }));
        counts[name] = snap.size;
      }
      download(`orp-hub-backup-${toInputDate(new Date())}.json`, JSON.stringify(out, null, 1), 'application/json');
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
