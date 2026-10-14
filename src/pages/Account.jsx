import { useState } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useAuth } from '../AuthContext.jsx';
import { ROLES } from '../lib/roles.js';
import { Button, Card, ErrorNote, Field, PageHeader, useAction } from '../components/ui.jsx';

export default function Account() {
  const { profile, resetPassword, signOut } = useAuth();
  const [f, setF] = useState({ name: profile.name, phone: profile.phone || '' });
  const { busy, error, run } = useAction();
  return (
    <>
      <PageHeader title="My account" />
      <Card>
        <div className="form">
          <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Phone"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Email"><input value={profile.email} disabled /></Field>
          <Field label="Roles"><input value={(profile.roles || []).map((r) => ROLES[r]).join(', ')} disabled /></Field>
          {profile.ministryName && <Field label="Ministry"><input value={profile.ministryName} disabled /></Field>}
        </div>
        <ErrorNote error={error} />
        <div className="row" style={{ marginTop: 16 }}>
          <Button busy={busy} onClick={() => run(() => updateDoc(doc(db, 'users', profile.uid), { name: f.name.trim() || profile.name, phone: f.phone.trim(), updatedAt: serverTimestamp() }), 'Saved')}>Save</Button>
          <Button variant="secondary" onClick={() => run(() => resetPassword(profile.email), 'Password reset email sent')}>Change password</Button>
          <Button variant="ghost" onClick={signOut}>Sign out</Button>
        </div>
      </Card>
    </>
  );
}
