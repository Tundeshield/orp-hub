import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { useWork } from '../WorkContext.jsx';
import { can, isAdmin, isReviewer } from '../lib/roles.js';
import { formatNGN } from '../lib/money.js';
import { REQUEST_STATUS, requestOutstanding } from '../lib/finance.js';
import { addDays, fmtDate, fmtTime, isOverdue, relative, toDate } from '../lib/dates.js';
import { Badge, Card, Empty, Loading, PageHeader, Stat } from '../components/ui.jsx';
import { downloadICS } from './meetings/Meetings.jsx';

const TITLES = /^(pastor|pst\.?|rev\.?|reverend|bro\.?|brother|sis\.?|sister|dcn\.?|deacon|deaconess|dr\.?|mr\.?|mrs\.?|miss|ms\.?|elder)$/i;
function firstName(name) {
  const parts = (name || '').trim().split(/\s+/);
  if (parts.length > 1 && /^(pastor|pst\.?|rev\.?|reverend)$/i.test(parts[0])) return name;
  return parts.find((p) => !TITLES.test(p)) || parts[0];
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Item({ to, title, meta, side, tone }) {
  return (
    <li className="list-item">
      <div className="list-main">
        <Link to={to} className="list-title" style={{ color: 'inherit' }}>{title}</Link>
        {meta && <div className="list-meta">{meta}</div>}
      </div>
      {side && <div className="list-side">{tone ? <Badge status={tone}>{side}</Badge> : side}</div>}
    </li>
  );
}

export default function Dashboard() {
  const { profile } = useAuth();
  const w = useWork();
  const pastor = can(profile, 'pastor');
  const finance = can(profile, 'finance');
  const reviewer = isReviewer(profile);
  const care = can(profile, 'pastor', 'assistant');
  const now = new Date();
  const soon = w.upcoming.filter((a) => toDate(a.start) < addDays(now, 1));
  const overdueTasks = w.openTasks.filter((t) => isOverdue(t.dueDate));
  const unpaidTotal = w.toPay.reduce((s, r) => s + requestOutstanding(r), 0);
  const myOpenRequests = w.myRequests.filter((r) => ['pending', 'approved', 'partly_paid'].includes(r.status));

  // The inbox: everything that needs this person to act, most urgent first.
  const inbox = [];
  if (pastor) w.approvals.forEach((r) => inbox.push({ key: `a${r.id}`, to: `/finance/requests/${r.id}`, title: `Approve: ${r.title}`, meta: `${formatNGN(r.amount)} · ${r.requestedByName} · ${r.fundName}`, side: 'approval', tone: 'pending', rank: 1 }));
  w.clarifications.forEach((r) => inbox.push({ key: `c${r.id}`, to: `/finance/requests/${r.id}`, title: `Clarify your request: ${r.title}`, meta: r.decisionNote, side: 'clarify', tone: 'clarification', rank: 1 }));
  if (finance) w.toPay.forEach((r) => inbox.push({ key: `p${r.id}`, to: `/finance/requests/${r.id}`, title: `Pay: ${r.title}`, meta: `${formatNGN(requestOutstanding(r))} owed · ${r.requestedByName}`, side: REQUEST_STATUS[r.status], tone: r.status, rank: 2 }));
  w.myOpenReports.forEach((r) => {
    const od = isOverdue(r.dueDate);
    inbox.push({ key: `r${r.id}`, to: `/reports/${r.id}`, title: `${r.status === 'revision' ? 'Revise' : 'Submit'}: ${r.templateName} — ${r.period}`, meta: `${r.ministryName} · due ${fmtDate(r.dueDate)} (${relative(r.dueDate)})`, side: od ? 'overdue' : r.status, tone: od ? 'overdue' : r.status, rank: od ? 0 : 2 });
  });
  if (reviewer) w.toReview.forEach((r) => inbox.push({ key: `v${r.id}`, to: `/reports/${r.id}`, title: `Review: ${r.ministryName} — ${r.period}`, meta: r.templateName, side: 'to review', tone: 'submitted', rank: 3 }));
  w.openTasks.forEach((t) => {
    const od = isOverdue(t.dueDate);
    inbox.push({ key: `t${t.id}`, to: '/tasks', title: t.title, meta: `Task${t.createdByName ? ` from ${t.createdByName}` : ''}${t.dueDate ? ` · due ${fmtDate(t.dueDate)}` : ''}`, side: od ? 'overdue' : t.priority, tone: od ? 'overdue' : t.priority, rank: od ? 0 : t.priority === 'high' ? 2 : 4 });
  });
  if (care) w.followupsDue.forEach((f) => inbox.push({ key: `f${f.id}`, to: '/pastor?tab=followups', title: `Follow up: ${f.person}`, meta: `${f.reason}${f.dueDate ? ` · ${relative(f.dueDate)}` : ''}`, side: 'follow-up', tone: isOverdue(f.dueDate) ? 'overdue' : 'pending', rank: 3 }));
  if (care) w.newPrayers.forEach((p) => inbox.push({ key: `y${p.id}`, to: '/pastor?tab=prayer', title: `New ${p.kind}: ${p.anonymous ? 'Anonymous' : p.name}`, meta: p.content.slice(0, 90), side: p.kind, tone: 'new', rank: 5 }));
  if (isAdmin(profile)) w.pendingUsers.forEach((u) => inbox.push({ key: `u${u.id}`, to: '/admin', title: `Activate account: ${u.name}`, meta: u.email, side: 'new user', tone: 'pending', rank: 1 }));
  inbox.sort((a, b) => a.rank - b.rank);

  return (
    <>
      <PageHeader title={`${greeting()}, ${firstName(profile.name)}`} subtitle={now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} />

      {soon.length > 0 && (
        <div className="info-note" style={{ marginBottom: 16 }}>
          <strong>Reminder:</strong> {soon.map((a) => `${a.attendeeName && care ? `${a.attendeeName} ` : 'Appointment '}at ${fmtTime(a.start)} (${relative(a.start)})`).join('; ')}.{' '}
          <Link to={care ? '/meetings?tab=diary' : '/meetings?tab=mine'}>View</Link>
        </div>
      )}

      <div className="grid grid-4">
        {pastor && <Stat label="Approvals waiting" value={w.approvals.length} tone={w.approvals.length ? 'amber' : ''} />}
        {finance && <Stat label="Approved, unpaid" value={w.toPay.length} sub={formatNGN(unpaidTotal)} tone={w.toPay.length ? 'amber' : ''} />}
        <Stat label="Upcoming appointments" value={w.upcoming.length} sub={w.upcoming[0] ? `Next: ${fmtDate(w.upcoming[0].start)} ${fmtTime(w.upcoming[0].start)}` : ''} />
        {reviewer ? <Stat label="Reports to review" value={w.toReview.length} sub={w.overdueReports.length ? `${w.overdueReports.length} overdue from leaders` : ''} tone={w.overdueReports.length ? 'red' : ''} />
          : <Stat label="My reports due" value={w.myOpenReports.length} tone={w.myOpenReports.some((r) => isOverdue(r.dueDate)) ? 'red' : ''} />}
        <Stat label="My open tasks" value={w.openTasks.length} sub={overdueTasks.length ? `${overdueTasks.length} overdue` : ''} tone={overdueTasks.length ? 'red' : ''} />
        {!pastor && !finance && <Stat label="My open requests" value={myOpenRequests.length} />}
      </div>

      <div className="grid grid-2 section-gap" style={{ alignItems: 'start' }}>
        <Card title={`Inbox · needs your attention${inbox.length ? ` (${inbox.length})` : ''}`} pad={false}>
          {w.loading ? <Loading /> : !inbox.length ? <Empty title="You're all caught up 🙌">Nothing needs your attention right now.</Empty> : (
            <ul className="list">{inbox.slice(0, 25).map(({ key, ...it }) => <Item key={key} {...it} />)}</ul>
          )}
        </Card>
        <div className="stack">
          <Card title="Upcoming appointments" pad={false} actions={<Link to="/meetings" className="small">Meetings →</Link>}>
            {!w.upcoming.length ? <Empty title="No upcoming appointments" action={<Link to="/meetings?tab=book">Book a time with the pastor</Link>} /> : (
              <ul className="list">{w.upcoming.slice(0, 6).map((a) => (
                <li key={a.id} className="list-item">
                  <div className="list-main">
                    <div className="list-title">{fmtDate(a.start, { weekday: 'short' })}, {fmtTime(a.start)}</div>
                    <div className="list-meta">{care ? `${a.attendeeName} · ${a.purpose}` : a.purpose}</div>
                  </div>
                  <button className="icon-btn" title="Add to calendar" onClick={() => downloadICS(a)}>📅</button>
                </li>
              ))}</ul>
            )}
          </Card>
          {myOpenRequests.length > 0 && (
            <Card title="My financial requests" pad={false} actions={<Link to="/finance?tab=requests" className="small">Finance →</Link>}>
              <ul className="list">{myOpenRequests.slice(0, 5).map((r) => (
                <Item key={r.id} to={`/finance/requests/${r.id}`} title={r.title} meta={formatNGN(r.amount)} side={REQUEST_STATUS[r.status]} tone={r.status} />
              ))}</ul>
            </Card>
          )}
          {reviewer && w.overdueReports.length > 0 && (
            <Card title="Overdue ministry reports" pad={false} actions={<Link to="/reports?tab=all" className="small">Reports →</Link>}>
              <ul className="list">{w.overdueReports.slice(0, 6).map((r) => (
                <Item key={r.id} to={`/reports/${r.id}`} title={r.ministryName} meta={`${r.templateName} · ${r.period} · ${r.leaderName}`} side={`due ${relative(r.dueDate)}`} tone="overdue" />
              ))}</ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
