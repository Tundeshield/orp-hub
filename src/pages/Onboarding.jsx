import { useState } from 'react';
import { collection, doc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, churchName } from '../firebase.js';
import { useAuth } from '../AuthContext.jsx';
import { Button, ErrorNote, Field } from '../components/ui.jsx';

export function slugify(s) {
  return (s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function Frame({ title, children }) {
  const { signOut, account } = useAuth();
  return (
    <div className="auth-panel" style={{ minHeight: '100vh' }}>
      <div className="auth-card" style={{ maxWidth: 460 }}>
        <div className="brand" style={{ padding: '0 0 16px' }}><div className="brand-mark">✝</div><div><div className="brand-name" style={{ color: 'var(--ink)' }}>Pastor&rsquo;s Desk</div><div className="small muted">{churchName}</div></div></div>
        <h1>{title}</h1>
        {children}
        <p className="small muted" style={{ marginTop: 24 }}>Signed in as {account?.email}. <button className="linkish" onClick={signOut}>Sign out</button></p>
      </div>
    </div>
  );
}

// Legacy data created before branches existed (root collections) is copied into the first branch.
const SIMPLE_LEGACY = ['ministries', 'reportTemplates', 'settings'];

async function migrateLegacy(batchList, branchId, profileUid) {
  const notes = [];
  // people → branch members
  const users = await getDocs(collection(db, 'users'));
  const memberIds = [];
  for (const u of users.docs) {
    const d = u.data();
    if (u.id === profileUid) continue;
    if (!Array.isArray(d.roles)) continue;
    batchList.push((b) => {
      b.set(doc(db, 'branches', branchId, 'members', u.id), {
        name: d.name || '', email: d.email || '', phone: d.phone || '', roles: d.roles, active: !!d.active && d.roles.length > 0,
        ministryId: d.ministryId || '', ministryName: d.ministryName || '', createdAt: serverTimestamp(),
      });
      b.update(doc(db, 'users', u.id), { branchIds: [...new Set([...(d.branchIds || []), branchId])], updatedAt: serverTimestamp() });
    });
    memberIds.push(u.id);
  }
  if (memberIds.length) notes.push(`${memberIds.length} people`);
  for (const name of SIMPLE_LEGACY) {
    const snap = await getDocs(collection(db, name)).catch(() => null);
    if (!snap || snap.empty) continue;
    snap.docs.forEach((d) => batchList.push((b) => b.set(doc(db, 'branches', branchId, name, d.id), d.data())));
    notes.push(`${snap.size} ${name === 'reportTemplates' ? 'report templates' : name}`);
  }
  const slots = await getDocs(collection(db, 'slots')).catch(() => null);
  const open = slots ? slots.docs.filter((d) => d.data().status === 'open') : [];
  open.forEach((d) => batchList.push((b) => b.set(doc(db, 'branches', branchId, 'slots', d.id), { ...d.data(), appointmentId: null, bookedBy: null })));
  if (open.length) notes.push(`${open.length} open appointment slots`);
  return notes;
}

export function CreateFirstBranch() {
  const { profile, account, switchBranch } = useAuth();
  const [f, setF] = useState({ name: '', id: '', location: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const id = f.id || slugify(f.name.replace(/^the elevation church\W*/i, ''));

  async function create() {
    if (f.name.trim().length < 2) return setError('Give the branch a name.');
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) return setError('The short code can only use lowercase letters, numbers and dashes.');
    setBusy(true); setError(null);
    try {
      const first = writeBatch(db);
      first.set(doc(db, 'branches', id), { name: f.name.trim(), location: f.location.trim(), createdBy: account.uid, createdAt: serverTimestamp() });
      first.set(doc(db, 'branches', id, 'members', account.uid), {
        name: account.name, email: account.email, phone: account.phone || '', roles: ['admin'], active: true, ministryId: '', ministryName: '', createdAt: serverTimestamp(),
      });
      first.update(doc(db, 'users', account.uid), { branchIds: [id], currentBranch: id, updatedAt: serverTimestamp() });
      await first.commit();
      // Bring across anything set up before branches existed.
      const ops = [];
      await migrateLegacy(ops, id, account.uid);
      for (let i = 0; i < ops.length; i += 200) {
        const b = writeBatch(db);
        ops.slice(i, i + 200).forEach((fn) => fn(b));
        await b.commit();
      }
      switchBranch(id);
    } catch (e) {
      console.error(e);
      setError(e.code === 'permission-denied' ? 'That short code is already used by another branch, or the latest security rules have not been published yet.' : e.message);
    } finally { setBusy(false); }
  }

  if (!profile?.isSuperAdmin) {
    return <Frame title="Not set up yet"><p className="muted">No church branches have been created yet. Please ask the administrator to set up your branch.</p></Frame>;
  }
  return (
    <Frame title="Create your first branch">
      <p className="muted">Each branch has its own finances, diary, reports, people and public booking page. You can add more branches later under Admin → Branches.</p>
      <div className="stack" style={{ marginTop: 16 }}>
        <Field label="Branch name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. The Elevation Church · Ijebu Ode" /></Field>
        <Field label="Location (optional)"><input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="e.g. Ijebu Ode, Ogun State" /></Field>
        <Field label="Short code" hint={`Used in the public link: ${window.location.host}/connect/${id || '…'}`}>
          <input value={id} onChange={(e) => setF({ ...f, id: slugify(e.target.value) })} />
        </Field>
        <Button busy={busy} onClick={create}>Create branch</Button>
        <ErrorNote error={error} />
        <p className="muted small">People, ministries, report templates, public-page settings and open appointment slots you set up earlier are moved into this branch automatically.</p>
      </div>
    </Frame>
  );
}

export function JoinBranch() {
  const { branches, joinBranch, account } = useAuth();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const pending = new Set(account?.branchIds || []);
  return (
    <Frame title="Which branch are you in?">
      <p className="muted">Choose your branch. Its administrator will activate your account and give you a role.</p>
      <div className="public-cards">
        {branches.map((b) => (
          <button key={b.id} className="public-card" style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer' }} disabled={!!busy}
            onClick={async () => { setBusy(b.id); setError(null); try { await joinBranch(b.id); } catch (e) { console.error(e); setError(e); } finally { setBusy(null); } }}>
            <span className="public-card-icon">⌂</span>
            <span><strong>{b.name}</strong><span className="muted small">{pending.has(b.id) ? 'Request sent' : b.location || 'Ask to join'}</span></span>
          </button>
        ))}
      </div>
      <ErrorNote error={error} />
    </Frame>
  );
}

export function WaitingForActivation() {
  const { profile, accessibleBranches, switchBranch, branches, joinBranch } = useAuth();
  const [busy, setBusy] = useState(false);
  const others = branches.filter((b) => b.id !== profile.branchId);
  return (
    <Frame title="Waiting for activation">
      <p className="muted">Thanks, {profile.name}. The administrator of <strong>{profile.branchName}</strong> will assign your role shortly. This page updates automatically.</p>
      {accessibleBranches.length > 1 && (
        <Field label="Switch branch">
          <select value={profile.branchId} onChange={(e) => switchBranch(e.target.value)}>
            {accessibleBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
      )}
      {others.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary className="small">Wrong branch?</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            {others.filter((b) => !accessibleBranches.some((a) => a.id === b.id)).map((b) => (
              <Button key={b.id} variant="secondary" size="sm" busy={busy} onClick={async () => { setBusy(true); try { await joinBranch(b.id); } finally { setBusy(false); } }}>Join {b.name}</Button>
            ))}
          </div>
        </details>
      )}
    </Frame>
  );
}
