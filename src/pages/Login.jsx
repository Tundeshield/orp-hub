import { useState } from 'react';
import { useAuth } from '../AuthContext.jsx';
import { churchName } from '../firebase.js';
import { Button, ErrorNote, Field } from '../components/ui.jsx';
import { friendlyError } from '../lib/db.js';

export default function Login() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo('');
    try {
      if (mode === 'signin') await signIn(form.email.trim(), form.password);
      else if (mode === 'signup') {
        if (form.password.length < 8) throw Object.assign(new Error(), { code: 'auth/weak-password' });
        await signUp(form.name.trim(), form.email.trim(), form.password);
      } else {
        await resetPassword(form.email.trim());
        setInfo('If that email has an account, a reset link is on its way.');
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-art">
        <div className="brand"><div className="brand-mark">✝</div><div><div className="brand-name">Pastor&rsquo;s Desk</div><div className="brand-sub">{churchName}</div></div></div>
        <div>
          <h2>Pastoral work, organised.</h2>
          <p>Approvals, appointments, reports and pastoral care for the Office of the Resident Pastor, {churchName}.</p>
        </div>
        <p className="small">Access is by invitation. New accounts are activated by the administrator.</p>
      </div>
      <div className="auth-panel">
        <div className="auth-card">
          <h1>{mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create your account' : 'Reset password'}</h1>
          <p className="muted">{mode === 'signup' ? 'Your account will be activated once the administrator assigns your role.' : churchName}</p>
          <form onSubmit={submit}>
            {mode === 'signup' && (
              <Field label="Full name"><input required value={form.name} onChange={set('name')} autoComplete="name" /></Field>
            )}
            <Field label="Email"><input required type="email" value={form.email} onChange={set('email')} autoComplete="email" /></Field>
            {mode !== 'reset' && (
              <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters' : ''}>
                <input required type="password" value={form.password} onChange={set('password')}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
              </Field>
            )}
            <Button type="submit" busy={busy}>{mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}</Button>
            <ErrorNote error={error} />
            {info && <div className="info-note">{info}</div>}
          </form>
          <div className="row between" style={{ marginTop: 18, fontSize: 14 }}>
            {mode === 'signin'
              ? <button className="linkish" onClick={() => setMode('signup')}>Create an account</button>
              : <button className="linkish" onClick={() => setMode('signin')}>Back to sign in</button>}
            {mode === 'signin' && <button className="linkish" onClick={() => setMode('reset')}>Forgot password?</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
