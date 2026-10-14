import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { isConfigured } from './firebase.js';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { WorkProvider } from './WorkContext.jsx';
import { ToastProvider, Loading } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Pending from './pages/Pending.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Finance from './pages/finance/Finance.jsx';
import RequestDetail from './pages/finance/RequestDetail.jsx';
import FundDetail from './pages/finance/FundDetail.jsx';
import Meetings from './pages/meetings/Meetings.jsx';
import Reports from './pages/reports/Reports.jsx';
import ReportDetail from './pages/reports/ReportDetail.jsx';
import Pastor from './pages/pastor/Pastor.jsx';
import Tasks from './pages/Tasks.jsx';
import Notifications from './pages/Notifications.jsx';
import Admin from './pages/admin/Admin.jsx';
import Account from './pages/Account.jsx';
import Share from './pages/Share.jsx';
import Connect from './pages/public/Connect.jsx';

function NotConfigured() {
  return (
    <div className="auth-panel" style={{ minHeight: '100vh' }}>
      <div className="auth-card">
        <h1>Almost there</h1>
        <p className="muted">Pastor's Desk isn't connected to Firebase yet. Add the <code>VITE_FIREBASE_*</code> environment variables (see README) and redeploy.</p>
      </div>
    </div>
  );
}

function Gate() {
  const { user, profile, loading } = useAuth();
  const { pathname } = useLocation();
  if (pathname === '/connect' || pathname.startsWith('/connect/')) return <Routes><Route path="/connect/*" element={<Connect />} /></Routes>;
  if (loading) return <Loading label="Opening Pastor's Desk…" />;
  if (!user || user.isAnonymous) return <Login />;
  if (!profile || !profile.active || !(profile.roles || []).length) return <Pending />;
  return (
    <WorkProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="finance" element={<Finance />} />
          <Route path="finance/requests/:id" element={<RequestDetail />} />
          <Route path="finance/funds/:id" element={<FundDetail />} />
          <Route path="meetings" element={<Meetings />} />
          <Route path="reports" element={<Reports />} />
          <Route path="reports/:id" element={<ReportDetail />} />
          <Route path="pastor" element={<Pastor />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="admin" element={<Admin />} />
          <Route path="account" element={<Account />} />
          <Route path="share" element={<Share />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </WorkProvider>
  );
}

export default function App() {
  if (!isConfigured) return <NotConfigured />;
  return (
    <ToastProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ToastProvider>
  );
}
