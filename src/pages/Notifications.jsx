import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, updateDoc, writeBatch, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useAuth } from '../AuthContext.jsx';
import { col, query, where, useLive } from '../lib/db.js';
import { fmtDateTime, toDate } from '../lib/dates.js';
import { Button, Card, Empty, ErrorNote, Loading, PageHeader } from '../components/ui.jsx';

export default function Notifications() {
  const { profile } = useAuth();
  const nav = useNavigate();
  const all = useLive(() => query(col('notifications'), where('toUid', '==', profile.uid)), [profile.uid]);
  const rows = useMemo(() => [...all.data].sort((a, b) => (toDate(b.createdAt) || new Date()) - (toDate(a.createdAt) || new Date())).slice(0, 100), [all.data]);
  const unread = rows.filter((n) => !n.read);

  async function open(n) {
    if (!n.read) await updateDoc(doc(db, 'notifications', n.id), { read: true }).catch(console.error);
    if (n.link) nav(n.link);
  }
  async function markAll() {
    const b = writeBatch(db);
    unread.slice(0, 450).forEach((n) => b.update(doc(db, 'notifications', n.id), { read: true }));
    await b.commit();
  }
  async function clearRead() {
    await Promise.all(rows.filter((n) => n.read).map((n) => deleteDoc(doc(db, 'notifications', n.id))));
  }

  return (
    <>
      <PageHeader title="Notifications" subtitle="Approvals, appointments, reports and tasks that involve you."
        actions={<>
          <Button variant="secondary" onClick={markAll} disabled={!unread.length}>Mark all read</Button>
          <Button variant="ghost" onClick={clearRead} disabled={rows.length === unread.length}>Clear read</Button>
        </>} />
      <Card pad={false}>
        <ErrorNote error={all.error} />
        {all.loading ? <Loading /> : !rows.length ? <Empty title="You're all caught up" /> : (
          <ul className="list">{rows.map((n) => (
            <li key={n.id} className="list-item clickable" onClick={() => open(n)} style={n.read ? {} : { background: '#fffaf0' }}>
              <div className="list-main">
                <div className="list-title">{!n.read && <span style={{ color: 'var(--gold)' }}>● </span>}{n.title}</div>
                {n.body && <div className="list-meta">{n.body}</div>}
                <div className="list-meta">{n.fromName} · {fmtDateTime(n.createdAt)}</div>
              </div>
            </li>
          ))}</ul>
        )}
      </Card>
    </>
  );
}
