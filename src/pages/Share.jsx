import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { doc, serverTimestamp } from 'firebase/firestore';
import { db, churchName } from '../firebase.js';
import { useAuth } from '../AuthContext.jsx';
import { useDoc, addAudit } from '../lib/db.js';
import { isDiaryManager } from '../lib/roles.js';
import { writeBatch } from 'firebase/firestore';
import { Button, Card, ErrorNote, Field, Loading, PageHeader, useAction } from '../components/ui.jsx';

const ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';

const POSTERS = [
  { key: 'connect', path: '/connect', title: 'Connect with the Pastor', line: 'Scan to book time with the Pastor, send a prayer request or share a testimony.' },
  { key: 'prayer', path: '/connect/prayer?kind=prayer', title: 'Send us your prayer points', line: 'Scan with your phone camera. You can send it confidentially.' },
  { key: 'book', path: '/connect/book', title: 'Book time with the Pastor', line: 'Scan to choose an available appointment time.' },
];

function useQR(url) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 720, errorCorrectionLevel: 'M', color: { dark: '#1f2a44', light: '#ffffff' } })
      .then(setSrc).catch(console.error);
  }, [url]);
  return src;
}

function Poster({ p }) {
  const url = `${ORIGIN}${p.path}`;
  const src = useQR(url);
  const [copied, setCopied] = useState(false);
  return (
    <Card className="poster-card">
      <div className="poster" id={`poster-${p.key}`}>
        <div className="poster-church">{churchName}</div>
        <div className="poster-title">{p.title}</div>
        {src ? <img src={src} alt={`QR code for ${url}`} className="poster-qr" /> : <Loading />}
        <div className="poster-line">{p.line}</div>
        <div className="poster-url">{url.replace(/^https?:\/\//, '')}</div>
      </div>
      <div className="row no-print" style={{ marginTop: 12 }}>
        <Button size="sm" onClick={() => { const a = document.createElement('a'); a.href = src; a.download = `qr-${p.key}.png`; a.click(); }} disabled={!src}>Download QR (PNG)</Button>
        <Button size="sm" variant="secondary" onClick={() => printPoster(p.key)}>Print poster</Button>
        <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? 'Copied ✓' : 'Copy link'}</Button>
      </div>
    </Card>
  );
}

function printPoster(key) {
  document.body.dataset.printPoster = key;
  window.print();
  setTimeout(() => { delete document.body.dataset.printPoster; }, 500);
}

export default function Share() {
  const { profile } = useAuth();
  const { data, loading } = useDoc('settings', 'public');
  const { busy, error, run } = useAction();
  const [f, setF] = useState(null);
  useEffect(() => {
    if (!loading && !f) setF({ bookingEnabled: false, prayerEnabled: false, officePhone: '', welcomeNote: '', bookingNote: '', prayerNote: '', bookingDays: 21, ...(data || {}) });
  }, [loading, data, f]);
  if (!isDiaryManager(profile)) return <Navigate to="/" replace />;
  if (!f) return <Loading />;

  async function save() {
    await run(async () => {
      const batch = writeBatch(db);
      batch.set(doc(db, 'settings', 'public'), {
        bookingEnabled: !!f.bookingEnabled, prayerEnabled: !!f.prayerEnabled, officePhone: f.officePhone.trim(),
        welcomeNote: f.welcomeNote.trim(), bookingNote: f.bookingNote.trim(), prayerNote: f.prayerNote.trim(),
        bookingDays: Math.min(90, Math.max(1, Number(f.bookingDays) || 21)), updatedBy: profile.name, updatedAt: serverTimestamp(),
      });
      addAudit(batch, profile, 'public.settings', 'settings', 'public', `booking ${f.bookingEnabled ? 'on' : 'off'}, prayer ${f.prayerEnabled ? 'on' : 'off'}`);
      await batch.commit();
    }, 'Public page updated');
  }

  return (
    <>
      <PageHeader title="Public page & QR codes" subtitle="Let anyone book time with the Pastor or send prayer points — no account needed."
        actions={<Button variant="secondary" onClick={() => window.open('/connect', '_blank')}>Open public page ↗</Button>} />
      <div className="grid detail-grid">
        <div className="stack">
          {POSTERS.map((p) => <Poster key={p.key} p={p} />)}
        </div>
        <Card title="Settings">
          <div className="stack">
            <label className="check"><input type="checkbox" checked={!!f.bookingEnabled} onChange={(e) => setF({ ...f, bookingEnabled: e.target.checked })} /> <strong>Public booking is open</strong></label>
            <label className="check"><input type="checkbox" checked={!!f.prayerEnabled} onChange={(e) => setF({ ...f, prayerEnabled: e.target.checked })} /> <strong>Prayer requests & testimonies are open</strong></label>
            <Field label="Church office phone" hint="Shown to visitors for changes or cancellations."><input value={f.officePhone} onChange={(e) => setF({ ...f, officePhone: e.target.value })} /></Field>
            <Field label="How far ahead can people book?">
              <select value={f.bookingDays} onChange={(e) => setF({ ...f, bookingDays: Number(e.target.value) })}>
                {[7, 14, 21, 30, 60].map((n) => <option key={n} value={n}>{n} days</option>)}
              </select>
            </Field>
            <Field label="Welcome message (optional)"><textarea value={f.welcomeNote} onChange={(e) => setF({ ...f, welcomeNote: e.target.value })} /></Field>
            <Field label="Note after booking (optional)"><textarea value={f.bookingNote} onChange={(e) => setF({ ...f, bookingNote: e.target.value })} placeholder="e.g. Please arrive 10 minutes early and report at the church office." /></Field>
            <Field label="Note after a prayer request (optional)"><textarea value={f.prayerNote} onChange={(e) => setF({ ...f, prayerNote: e.target.value })} /></Field>
            <Button busy={busy} onClick={save}>Save</Button>
            <ErrorNote error={error} />
            <p className="muted small">Public bookings appear in the Pastor's diary marked "Online booking", using the open slots you publish under Meetings → Availability. Prayer requests appear under Pastor → Prayer & testimonies. Each visitor can submit at most once a minute.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
