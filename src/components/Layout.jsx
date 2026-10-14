import { NavLink, Link, Outlet } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { useWork } from '../WorkContext.jsx';
import { churchName } from '../firebase.js';
import { ROLES, isAdmin, can, isDiaryManager } from '../lib/roles.js';

export default function Layout() {
  const { profile, signOut, accessibleBranches, switchBranch } = useAuth();
  const work = useWork();
  const financeCount = (can(profile, 'pastor') ? work.approvals.length : 0) + (can(profile, 'finance') ? work.toPay.length : 0) + work.clarifications.length;
  const reportCount = work.toReview.length + work.myOpenReports.length;
  const items = [
    { to: '/', label: 'Dashboard', icon: '⌂', end: true },
    { to: '/finance', label: 'Finance', icon: '₦', count: financeCount },
    { to: '/meetings', label: 'Meetings', icon: '◷' },
    { to: '/reports', label: 'Reports', icon: '▤', count: reportCount },
    { to: '/pastor', label: 'Pastor', icon: '✚', count: work.followupsDue.length + work.newPrayers.length },
    { to: '/tasks', label: 'Tasks', icon: '✓', count: work.openTasks.length },
  ];
  if (isDiaryManager(profile)) items.push({ to: '/share', label: 'Public & QR', icon: '▣' });
  if (isAdmin(profile)) items.push({ to: '/admin', label: 'Admin', icon: '⚙', count: work.pendingUsers.length });

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">✝</div>
          <div>
            <div className="brand-name">Pastor&rsquo;s Desk</div>
            <div className="brand-sub">{churchName}</div>
          </div>
        </div>
        <nav className="nav">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end}>
              <span className="nav-icon">{i.icon}</span>{i.label}
              {i.count > 0 && <span className="nav-count">{i.count}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who">{profile.name}</div>
          <div className="roles">{(profile.roles || []).map((r) => ROLES[r] || r).join(', ')}</div>
          <Link to="/account" style={{ color: '#c9d1e4', display: 'block', marginTop: 8 }}>My account</Link>
          <button onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          {accessibleBranches.length > 1 ? (
            <select className="branch-switch" value={profile.branchId} onChange={(e) => switchBranch(e.target.value)} aria-label="Branch">
              {accessibleBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : <span className="church">{profile.branchName}</span>}
          <span className="spacer" />
          <Link to="/tasks" className="bell hide-desktop" aria-label="Tasks" title="Tasks">✓</Link>
          {isAdmin(profile) && <Link to="/admin" className="bell hide-desktop" aria-label="Admin" title="Admin">⚙</Link>}
          <Link to="/account" className="bell hide-desktop" aria-label="My account" title="My account">☺</Link>
          <Link to="/notifications" className="bell" aria-label="Notifications" title="Notifications">
            🔔{work.unread.length > 0 && <span className="bell-dot">{work.unread.length}</span>}
          </Link>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      <nav className="mobile-nav">
        {items.slice(0, 5).map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end}>
            <span className="nav-icon">{i.icon}</span>{i.label}
            {i.count > 0 && <span className="nav-count">{i.count}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
