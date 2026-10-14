import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { signInAnonymously } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { auth, db, churchName } from '../../firebase.js';
import { useAuth } from '../../AuthContext.jsx';
import { fmtDate, fmtTime, fromInputDate, relative, toDate, toInputDate } from '../../lib/dates.js';
import { appointmentICS } from '../../lib/ics.js';
import { download } from '../../lib/csv.js';
import { Button, ErrorNote, Field, Loading } from '../../components/ui.jsx';
import { bcol, bdoc, setCurrentBranch } from '../../lib/db.js';

// Public "Connect" pages: no account needed. Visitors are signed in anonymously so
// the security rules can identify and throttle them; they can only book open slots
// and send prayer requests/testimonies when the pastor's office has switched that on.

function useVisitor() {
  const { user, loading } = useAuth();
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!loading && !user) signInAnonymously(auth).catch((e) => { console.error(e); setError(e); });
  }, [user, loading]);
  return { ready: !!user, error };
}

const BranchCtx = createContext({ id: '', name: churchName, base: '/connect' });
const useBranch = () => useContext(BranchCtx);

function useBranchInfo(ready, branchId) {
  const [s, setS] = useState({ loading: true, branch: null, settings: {} });
  useEffect(() => {
    if (!ready || !branchId) return;
    setS({ loading: true, branch: null, settings: {} });
    Promise.all([getDoc(doc(db, 'branches', branchId)), getDoc(doc(db, 'branches', branchId, 'settings', 'public')).catch(() => null)])
      .then(([b, st]) => setS({ loading: false, branch: b.exists() ? { id: b.id, ...b.data() } : null, settings: st?.exists() ? st.data() : {} }))
      .catch((e) => { console.error(e); setS({ loading: false, branch: null, settings: {} }); });
  }, [ready, branchId]);
  return s;
}

function Shell({ children, back }) {
  const b = useBranch();
  return (
    <div className="public">
      <header className="public-head">
        <div className="brand-mark">✝</div>
        <div>
          <div className="public-church">{b.name}</div>
          <div className="public-sub">Office of the Resident Pastor</div>
        </div>
      </header>
      <main className="public-main">
        {back && <p className="small"><Link to={b.base}>← Back</Link></p>}
        {children}
      </main>
      <footer className="public-foot">Pastor&rsquo;s Desk · {churchName}</footer>
    </div>
  );
}

function stampThrottle(batch, uid) {
  batch.set(doc(db, 'throttle', uid), { at: serverTimestamp() });
}

function friendly(e) {
  if (e?.code === 'permission-denied') return 'We couldn\'t send that. If you just sent something, please wait a minute and try again. Otherwise this service may be paused — please contact the church office.';
  if (e?.code === 'unavailable') return 'You seem to be offline. Check your connection and try again.';
  return e?.message || 'Something went wrong. Please try again.';
}

export default function Connect() {
  return (
    <Routes>
      <Route index element={<Chooser />} />
      <Route path=":branchId/*" element={<BranchConnect />} />
    </Routes>
  );
}

function Chooser() {
  const { ready, error } = useVisitor();
  const [branches, setBranches] = useState(null);
  useEffect(() => {
    if (!ready) return;
    getDocs(collection(db, 'branches')).then((snap) => setBranches(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name))))
      .catch((e) => { console.error(e); setBranches([]); });
  }, [ready]);
  if (error) return <Shell><div className="error-note">This page couldn't start. Please refresh, or contact the church office.</div></Shell>;
  if (!branches) return <Shell><Loading /></Shell>;
  return (
    <Shell>
      <h1 className="public-title">Choose your branch</h1>
      <div className="public-cards">
        {branches.map((b) => (
          <Link key={b.id} to={`/connect/${b.id}`} className="public-card">
            <span className="public-card-icon">⌂</span>
            <span><strong>{b.name}</strong>{b.location && <span className="muted small">{b.location}</span>}</span>
          </Link>
        ))}
        {!branches.length && <div className="info-note">Nothing here yet.</div>}
      </div>
    </Shell>
  );
}

function BranchConnect() {
  const { branchId } = useParams();
  const { ready, error } = useVisitor();
  setCurrentBranch(branchId);
  const info = useBranchInfo(ready, branchId);
  const ctx = useMemo(() => ({ id: branchId, name: info.branch?.name || churchName, base: `/connect/${branchId}` }), [branchId, info.branch]);
  let body;
  if (error) body = <Shell><div className="error-note">This page couldn't start. Please refresh, or contact the church office.</div></Shell>;
  else if (!ready || info.loading) body = <Shell><Loading /></Shell>;
  else if (!info.branch) body = <Shell><div className="info-note">We couldn't find that branch. <Link to="/connect">See all branches</Link></div></Shell>;
  else {
    const s = info.settings;
    body = (
      <Routes>
        <Route index element={<Home s={s} />} />
        <Route path="book" element={<Book s={s} />} />
        <Route path="prayer" element={<Prayer s={s} />} />
        <Route path="*" element={<Home s={s} />} />
      </Routes>
    );
  }
  return <BranchCtx.Provider value={ctx}>{body}</BranchCtx.Provider>;
}

function Home({ s }) {
  const b = useBranch();
  const nothing = !s.bookingEnabled && !s.prayerEnabled;
  return (
    <Shell>
      <h1 className="public-title">Welcome</h1>
      <p className="muted">{s.welcomeNote || 'We would love to hear from you and pray with you.'}</p>
      {nothing && <div className="info-note" style={{ marginTop: 16 }}>Online booking and prayer requests are not open right now. Please contact the church office{s.officePhone ? ` on ${s.officePhone}` : ''}.</div>}
      <div className="public-cards">
        {s.bookingEnabled && (
          <Link to={`${b.base}/book`} className="public-card">
            <span className="public-card-icon">◷</span>
            <span><strong>Book time with the Pastor</strong><span className="muted small">Choose an available time for counselling, prayer or a meeting.</span></span>
          </Link>
        )}
        {s.prayerEnabled && (
          <Link to={`${b.base}/prayer?kind=prayer`} className="public-card">
            <span className="public-card-icon">✚</span>
            <span><strong>Send a prayer request</strong><span className="muted small">The Pastor and the prayer team will pray with you.</span></span>
          </Link>
        )}
        {s.prayerEnabled && (
          <Link to={`${b.base}/prayer?kind=testimony`} className="public-card">
            <span className="public-card-icon">★</span>
            <span><strong>Share a testimony</strong><span className="muted small">Tell us what God has done.</span></span>
          </Link>
        )}
      </div>
      {s.officePhone && <p className="muted small" style={{ marginTop: 20 }}>Church office: <a href={`tel:${s.officePhone.replace(/\s/g, '')}`}>{s.officePhone}</a></p>}
    </Shell>
  );
}

function Book({ s }) {
  const b = useBranch();
  const { user } = useAuth();
  const nav = useNavigate();
  const [slots, setSlots] = useState({ loading: true, data: [], error: null });
  const [picked, setPicked] = useState(null);
  const [f, setF] = useState({ name: '', phone: '', email: '', purpose: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function load() {
    setSlots((x) => ({ ...x, loading: true }));
    try {
      const snap = await getDocs(query(bcol('slots'), where('status', '==', 'open')));
      const now = new Date(Date.now() + 30 * 60000); // at least 30 minutes' notice
      const horizon = new Date(Date.now() + (Number(s.bookingDays) || 21) * 86400000);
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((x) => toDate(x.start) > now && toDate(x.start) < horizon)
        .sort((a, b) => toDate(a.start) - toDate(b.start));
      setSlots({ loading: false, data, error: null });
    } catch (e) { console.error(e); setSlots({ loading: false, data: [], error: e }); }
  }
   
  useEffect(() => { if (s.bookingEnabled) load(); }, [s.bookingEnabled]);

  const days = useMemo(() => {
    const m = new Map();
    for (const x of slots.data) { const k = toInputDate(x.start); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return [...m.entries()];
  }, [slots.data]);

  if (!s.bookingEnabled) return <Shell back><div className="info-note">Online booking is not open right now. Please contact the church office{s.officePhone ? ` on ${s.officePhone}` : ''}.</div></Shell>;

  async function book(e) {
    e.preventDefault();
    if (f.website) return; // honeypot: bots fill hidden fields
    if (f.name.trim().length < 2) return setError('Please enter your name.');
    if (f.phone.replace(/\D/g, '').length < 7) return setError('Please enter a phone number we can reach you on.');
    if (!f.purpose.trim()) return setError('Briefly tell us what the meeting is about.');
    setBusy(true); setError(null);
    try {
      const batch = writeBatch(db);
      const appt = doc(bcol('appointments'));
      batch.set(appt, {
        slotId: picked.id, start: picked.start, end: picked.end, location: picked.location || '',
        bookedBy: user.uid, bookedByName: 'Online booking', attendeeUid: user.uid,
        attendeeName: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(), purpose: f.purpose.trim(),
        status: 'booked', source: 'public', rescheduledFrom: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      batch.update(bdoc('slots', picked.id), { status: 'booked', appointmentId: appt.id, bookedBy: user.uid, updatedAt: serverTimestamp() });
      stampThrottle(batch, user.uid);
      await batch.commit();
      setDone({ id: appt.id, ...picked, name: f.name.trim() });
    } catch (err) {
      console.error(err);
      setError(err.code === 'permission-denied' ? 'Sorry — that time was just taken, or you booked very recently. Please choose another time or wait a minute.' : friendly(err));
      load();
      setPicked(null);
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <Shell>
        <div className="public-done">
          <div className="public-tick">✓</div>
          <h1 className="public-title">You're booked</h1>
          <p className="muted" style={{ margin: 0 }}>{done.name}</p>
          <p className="public-when">{fmtDate(done.start, { weekday: 'long' })}<br />{fmtTime(done.start)} – {fmtTime(done.end)}</p>
          {done.location && <p>{done.location}</p>}
          <p className="muted small">Reference: {done.id.slice(0, 6).toUpperCase()}</p>
          <p className="muted">{s.bookingNote || 'Please arrive a few minutes early. If you can no longer make it, kindly call the church office so someone else can have the time.'}</p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
            <Button onClick={() => download(`appointment-${toInputDate(done.start)}.ics`, appointmentICS({
              id: done.id, title: `Appointment with the Resident Pastor — ${b.name}`, description: 'Booked via Pastor\'s Desk', start: done.start, end: done.end, location: done.location,
            }), 'text/calendar;charset=utf-8')}>📅 Add to my calendar</Button>
            <Button variant="secondary" onClick={() => nav(b.base)}>Done</Button>
          </div>
          {s.officePhone && <p className="small" style={{ marginTop: 16 }}>Church office: <a href={`tel:${s.officePhone.replace(/\s/g, '')}`}>{s.officePhone}</a></p>}
        </div>
      </Shell>
    );
  }

  return (
    <Shell back>
      <h1 className="public-title">Book time with the Pastor</h1>
      {!picked ? (
        <>
          <p className="muted">Choose a time that works for you.</p>
          <ErrorNote error={error} />
          {slots.loading ? <Loading /> : slots.error ? <div className="error-note">{friendly(slots.error)}</div> : !days.length ? (
            <div className="info-note" style={{ marginTop: 12 }}>There are no open times right now. Please check back soon{s.officePhone ? ` or call ${s.officePhone}` : ''}.</div>
          ) : days.map(([day, list]) => (
            <div key={day}>
              <div className="day-head">{fmtDate(fromInputDate(day), { weekday: 'long' })} <span className="muted small">({relative(fromInputDate(day))})</span></div>
              <div className="slot-grid">
                {list.map((x) => (
                  <button key={x.id} className="slot" onClick={() => { setPicked(x); setError(null); }}>
                    <div className="t">{fmtTime(x.start)}</div><div className="s">{Math.round((toDate(x.end) - toDate(x.start)) / 60000)} minutes</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      ) : (
        <form onSubmit={book} className="stack" style={{ marginTop: 12 }}>
          <div className="info-note"><strong>{fmtDate(picked.start, { weekday: 'long' })}, {fmtTime(picked.start)}</strong>{picked.location ? ` · ${picked.location}` : ''} <button type="button" className="linkish small" onClick={() => setPicked(null)}>Change</button></div>
          <Field label="Your full name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" maxLength={120} required /></Field>
          <Field label="Phone number" hint="We'll call this number if anything changes."><input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" maxLength={30} required /></Field>
          <Field label="Email (optional)"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" maxLength={120} /></Field>
          <Field label="What would you like to talk about?" hint="Only the Pastor's office will see this."><textarea value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} maxLength={1000} required /></Field>
          <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} name="website" />
          <Button type="submit" busy={busy}>Confirm booking</Button>
          <ErrorNote error={error} />
        </form>
      )}
    </Shell>
  );
}

function Prayer({ s }) {
  const b = useBranch();
  const { user } = useAuth();
  const nav = useNavigate();
  const initialKind = new URLSearchParams(window.location.search).get('kind') === 'testimony' ? 'testimony' : 'prayer';
  const [f, setF] = useState({ kind: initialKind, name: '', phone: '', content: '', confidential: false, anonymous: false, website: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  if (!s.prayerEnabled) return <Shell back><div className="info-note">Online prayer requests are not open right now. Please contact the church office.</div></Shell>;

  async function send(e) {
    e.preventDefault();
    if (f.website) return;
    if (f.content.trim().length < 3) return setError(f.kind === 'testimony' ? 'Please write your testimony.' : 'Please write your prayer request.');
    setBusy(true); setError(null);
    try {
      const batch = writeBatch(db);
      batch.set(doc(bcol('prayers')), {
        kind: f.kind, content: f.content.trim(), name: f.anonymous ? '' : f.name.trim(), phone: f.phone.trim(),
        confidential: f.confidential, anonymous: f.anonymous || !f.name.trim(), status: 'new', source: 'public',
        submittedBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      stampThrottle(batch, user.uid);
      await batch.commit();
      setDone(true);
    } catch (err) { console.error(err); setError(friendly(err)); } finally { setBusy(false); }
  }

  if (done) {
    return (
      <Shell>
        <div className="public-done">
          <div className="public-tick">✓</div>
          <h1 className="public-title">{f.kind === 'testimony' ? 'Thank you for sharing!' : 'We are praying with you'}</h1>
          <p className="muted">{s.prayerNote || (f.kind === 'testimony' ? 'Your testimony has been received by the Pastor\'s office. God is faithful!' : 'Your request has been received by the Pastor\'s office. "The prayer of a righteous person is powerful and effective." — James 5:16')}</p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
            <Button variant="secondary" onClick={() => { setDone(false); setF({ ...f, content: '' }); }}>Send another</Button>
            <Button onClick={() => nav(b.base)}>Done</Button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell back>
      <h1 className="public-title">{f.kind === 'testimony' ? 'Share a testimony' : 'Send a prayer request'}</h1>
      <form onSubmit={send} className="stack" style={{ marginTop: 12 }}>
        <div className="seg" role="radiogroup" aria-label="Type">
          {[['prayer', 'Prayer request'], ['testimony', 'Testimony']].map(([k, l]) => (
            <button type="button" key={k} role="radio" aria-checked={f.kind === k} className={f.kind === k ? 'on' : ''} onClick={() => setF({ ...f, kind: k })}>{l}</button>
          ))}
        </div>
        <Field label={f.kind === 'testimony' ? 'Your testimony' : 'Your prayer request'}>
          <textarea rows={6} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} maxLength={4000} required />
        </Field>
        {!f.anonymous && <Field label="Your name (optional)"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} autoComplete="name" /></Field>}
        <Field label="Phone (optional)" hint="If you'd like someone to call you."><input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={30} autoComplete="tel" /></Field>
        <label className="check"><input type="checkbox" checked={f.confidential} onChange={(e) => setF({ ...f, confidential: e.target.checked })} /> Confidential — only the Resident Pastor will see this</label>
        <label className="check"><input type="checkbox" checked={f.anonymous} onChange={(e) => setF({ ...f, anonymous: e.target.checked })} /> Send without my name</label>
        <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} name="website" />
        <Button type="submit" busy={busy}>Send</Button>
        <ErrorNote error={error} />
      </form>
    </Shell>
  );
}
