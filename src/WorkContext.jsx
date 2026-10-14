import { createContext, useContext, useMemo } from 'react';
import { useAuth } from './AuthContext.jsx';
import { col, query, where, useLive } from './lib/db.js';
import { can, isDiaryManager, isReviewer, isAdmin } from './lib/roles.js';
import { toDate, isOverdue } from './lib/dates.js';

const Ctx = createContext(null);

// Central "work requiring attention" for the signed-in user, shared by the
// dashboard inbox and the navigation badges. Every query matches the security rules.
export function WorkProvider({ children }) {
  const { profile } = useAuth();
  const uid = profile.uid;
  const pastor = can(profile, 'pastor');
  const finance = can(profile, 'finance');
  const diary = isDiaryManager(profile);
  const reviewer = isReviewer(profile);
  const admin = isAdmin(profile);
  const careTeam = can(profile, 'pastor', 'assistant');

  const approvals = useLive(() => pastor ? query(col('requests'), where('status', '==', 'pending')) : null, [pastor]);
  const toPay = useLive(() => finance ? query(col('requests'), where('status', 'in', ['approved', 'partly_paid'])) : null, [finance]);
  const myRequests = useLive(() => query(col('requests'), where('requestedBy', '==', uid)), [uid]);
  const toReview = useLive(() => reviewer ? query(col('reports'), where('status', '==', 'submitted')) : null, [reviewer]);
  const allOpenReports = useLive(() => reviewer ? query(col('reports'), where('status', 'in', ['pending', 'revision'])) : null, [reviewer]);
  const myReports = useLive(() => query(col('reports'), where('leaderUid', '==', uid)), [uid]);
  const myTasks = useLive(() => query(col('tasks'), where('assigneeUid', '==', uid)), [uid]);
  const appts = useLive(() => diary
    ? query(col('appointments'), where('status', '==', 'booked'))
    : query(col('appointments'), where('attendeeUid', '==', uid)), [diary, uid]);
  const followups = useLive(() => careTeam ? query(col('followups'), where('status', '==', 'open')) : null, [careTeam]);
  const newPrayers = useLive(() => {
    if (pastor) return query(col('prayers'), where('status', '==', 'new'));
    if (careTeam) return query(col('prayers'), where('status', '==', 'new'), where('confidential', '==', false));
    return null;
  }, [pastor, careTeam]);
  const pendingUsers = useLive(() => admin ? query(col('members'), where('active', '==', false)) : null, [admin]);
  const unread = useLive(() => query(col('notifications'), where('toUid', '==', uid), where('read', '==', false)), [uid]);

  const value = useMemo(() => {
    const now = new Date();
    const upcoming = appts.data
      .filter((a) => a.status === 'booked' && toDate(a.end) >= now)
      .sort((a, b) => toDate(a.start) - toDate(b.start));
    const openTasks = myTasks.data.filter((t) => t.status !== 'done')
      .sort((a, b) => (toDate(a.dueDate) || 8e15) - (toDate(b.dueDate) || 8e15));
    const myOpenReports = myReports.data.filter((r) => ['pending', 'revision'].includes(r.status))
      .sort((a, b) => toDate(a.dueDate) - toDate(b.dueDate));
    const clarifications = myRequests.data.filter((r) => r.status === 'clarification');
    const overdueReports = allOpenReports.data.filter((r) => isOverdue(r.dueDate, now));
    const followupsDue = followups.data.filter((f) => !f.dueDate || toDate(f.dueDate) <= new Date(now.getTime() + 2 * 86400000))
      .sort((a, b) => (toDate(a.dueDate) || 0) - (toDate(b.dueDate) || 0));
    return {
      approvals: [...approvals.data].sort((a, b) => (toDate(a.createdAt) || 0) - (toDate(b.createdAt) || 0)),
      toPay: toPay.data,
      clarifications,
      myRequests: myRequests.data,
      toReview: toReview.data,
      overdueReports,
      myOpenReports,
      openTasks,
      upcoming,
      followupsDue,
      newPrayers: newPrayers.data,
      pendingUsers: pendingUsers.data,
      unread: unread.data,
      loading: [approvals, toPay, myRequests, toReview, myReports, myTasks, appts].some((s) => s.loading),
    };
  }, [approvals, toPay, myRequests, toReview, allOpenReports, myReports, myTasks, appts, followups, newPrayers, pendingUsers, unread]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useWork = () => useContext(Ctx);
