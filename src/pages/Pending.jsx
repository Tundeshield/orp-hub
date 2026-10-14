import { useState } from 'react';
import { useAuth } from '../AuthContext.jsx';
import { Button, ErrorNote } from '../components/ui.jsx';

export default function Pending() {
  const { user, profile, signOut, retryProfile } = useAuth();
  const [error, setError] = useState(null);
  return (
    <div className="auth-panel" style={{ minHeight: '100vh' }}>
      <div className="auth-card">
        <h1>{profile ? 'Waiting for activation' : 'Finishing setup'}</h1>
        {profile ? (
          <p className="muted">Thanks, {profile.name}. The administrator has been notified on their dashboard and will assign your role shortly. This page updates automatically.</p>
        ) : (
          <>
            <p className="muted">Setting up your account for {user.email}… If this doesn't finish in a few seconds, tap Try again.</p>
            <Button onClick={() => retryProfile().catch(setError)}>Try again</Button>
            <ErrorNote error={error} />
          </>
        )}
        <div style={{ marginTop: 18 }}><Button variant="secondary" onClick={signOut}>Sign out</Button></div>
      </div>
    </div>
  );
}
